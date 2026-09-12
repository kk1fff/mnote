pub mod api;
pub mod auth;
pub mod context;
pub mod db;
pub mod error;
pub mod index;
pub mod live;
pub mod merge;
pub mod notes;
pub mod parked;
pub mod tags;

use crate::context::WeatherNow;
use crate::error::AppError;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub type WeatherFn = Arc<dyn Fn(f64, f64) -> Option<WeatherNow> + Send + Sync>;

#[derive(Clone, Default)]
pub struct LoginLimiter {
    inner: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
}

impl LoginLimiter {
    const MAX: usize = 5;
    const WINDOW_SECS: u64 = 15 * 60;

    pub fn allow(&self, key: &str) -> Result<(), AppError> {
        let mut map = self
            .inner
            .lock()
            .map_err(|_| AppError::Internal(anyhow::anyhow!("lock")))?;
        let now = Instant::now();
        let window = std::time::Duration::from_secs(Self::WINDOW_SECS);
        let times = map.entry(key.to_string()).or_default();
        times.retain(|t| now.saturating_duration_since(*t) < window);
        if times.len() >= Self::MAX {
            return Err(AppError::RateLimited);
        }
        Ok(())
    }

    pub fn fail(&self, key: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.entry(key.to_string()).or_default().push(Instant::now());
        }
    }

    pub fn success(&self, key: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(key);
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
    pub state_dir: PathBuf,
    pub single_vault: bool,
    pub db: Arc<Mutex<Connection>>,
    pub live: live::LiveHub,
    pub weather: WeatherFn,
    pub desktop_unlock: Option<String>,
    pub listen_loopback: bool,
    pub login_limiter: LoginLimiter,
}

pub fn weather_enabled() -> bool {
    std::env::var("MNOTE_WEATHER").ok().as_deref() == Some("1")
}

fn default_weather() -> WeatherFn {
    if weather_enabled() {
        Arc::new(context::fetch_open_meteo)
    } else {
        Arc::new(|_, _| None)
    }
}

impl AppState {
    pub fn open(data_dir: impl Into<PathBuf>) -> Result<Self, AppError> {
        let data_dir = data_dir.into();
        Self::open_inner(data_dir.clone(), data_dir, false)
    }

    pub fn open_single(
        vault: impl Into<PathBuf>,
        state_dir: impl Into<PathBuf>,
    ) -> Result<Self, AppError> {
        Self::open_inner(vault.into(), state_dir.into(), true)
    }

    fn open_inner(
        data_dir: PathBuf,
        state_dir: PathBuf,
        single_vault: bool,
    ) -> Result<Self, AppError> {
        ensure_layout(&data_dir, &state_dir, single_vault)?;
        if single_vault {
            migrate_legacy_desktop_vault(&data_dir)?;
        }
        let conn = Connection::open(db_file(&state_dir, single_vault))?;
        db::init(&conn)?;
        let state = Self {
            data_dir,
            state_dir,
            single_vault,
            db: Arc::new(Mutex::new(conn)),
            live: live::LiveHub::new(),
            weather: default_weather(),
            desktop_unlock: None,
            listen_loopback: true,
            login_limiter: LoginLimiter::default(),
        };
        migrate_on_open(&state)?;
        Ok(state)
    }

    pub fn with_desktop_unlock(mut self, secret: impl Into<String>) -> Self {
        let secret = secret.into();
        self.desktop_unlock = if secret.is_empty() {
            None
        } else {
            Some(secret)
        };
        self
    }

    pub fn with_listen_loopback(mut self, loopback: bool) -> Self {
        self.listen_loopback = loopback;
        self
    }

    pub fn vault_dir(&self, username: &str) -> PathBuf {
        if self.single_vault {
            self.data_dir.clone()
        } else {
            vaults_dir(&self.data_dir).join(username)
        }
    }

    pub fn logs_dir(&self) -> PathBuf {
        if self.single_vault {
            self.state_dir.join("logs")
        } else {
            logs_dir(&self.data_dir)
        }
    }

    pub fn each_vault(&self) -> Result<Vec<(String, PathBuf)>, AppError> {
        if self.single_vault {
            return Ok(vec![("me".into(), self.data_dir.clone())]);
        }
        let root = vaults_dir(&self.data_dir);
        let mut out = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        out.push((name.to_string(), entry.path()));
                    }
                }
            }
        }
        Ok(out)
    }
}

pub fn db_path(data_dir: &Path) -> PathBuf {
    db_file(data_dir, false)
}

fn db_file(state_dir: &Path, single_vault: bool) -> PathBuf {
    if single_vault {
        state_dir.join("mnote.db")
    } else {
        state_dir.join("db").join("mnote.db")
    }
}

pub fn vaults_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("vaults")
}

pub fn logs_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("logs")
}

pub fn ensure_data_layout(data_dir: &Path) -> Result<(), AppError> {
    ensure_layout(data_dir, data_dir, false)
}

fn ensure_layout(data_dir: &Path, state_dir: &Path, single_vault: bool) -> Result<(), AppError> {
    if single_vault {
        std::fs::create_dir_all(state_dir)?;
        std::fs::create_dir_all(state_dir.join("logs"))?;
        notes::ensure_vault(data_dir)?;
        return Ok(());
    }
    std::fs::create_dir_all(data_dir.join("db"))?;
    std::fs::create_dir_all(vaults_dir(data_dir))?;
    std::fs::create_dir_all(logs_dir(data_dir))?;
    let legacy = data_dir.join("mnote.db");
    let current = db_file(state_dir, false);
    if legacy.is_file() && !current.exists() {
        std::fs::rename(legacy, current)?;
    }
    Ok(())
}

fn migrate_legacy_desktop_vault(vault: &Path) -> Result<(), AppError> {
    let nested = vault.join("vaults");
    if !nested.is_dir() {
        return Ok(());
    }
    let mut users = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&nested) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                users.push(entry.path());
            }
        }
    }
    if users.len() != 1 {
        return Ok(());
    }
    let src = &users[0];
    for name in ["notes", "history", "assets", "parked", "context"] {
        let from = src.join(name);
        let to = vault.join(name);
        if from.exists() && !to.exists() {
            std::fs::rename(&from, &to)?;
        }
    }
    let _ = std::fs::remove_dir_all(src);
    let _ = std::fs::remove_dir(&nested);
    Ok(())
}

fn migrate_on_open(state: &AppState) -> Result<(), AppError> {
    for (username, vault) in state.each_vault()? {
        notes::ensure_vault(&vault)?;
        notes::migrate_wiki_paths(&vault)?;
        notes::migrate_assets_map(&vault)?;
        parked::migrate_from_db(state, &username, &vault)?;
        context::migrate_from_db(state, &username, &vault)?;
        notes::migrate_last_edit_files(state, &username, &vault)?;
    }
    if state.single_vault {
        let db_dir = state.data_dir.join("db");
        let logs = state.data_dir.join("logs");
        if db_dir.exists() {
            let _ = std::fs::remove_dir_all(&db_dir);
        }
        if logs.exists() {
            let _ = std::fs::remove_dir_all(&logs);
        }
    }
    Ok(())
}

pub fn web_dist() -> PathBuf {
    if let Ok(path) = std::env::var("MNOTE_WEB_DIST") {
        return PathBuf::from(path);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let next_to_exe = dir.join("web").join("dist");
            if next_to_exe.is_dir() {
                return next_to_exe;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("web")
        .join("dist")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn opens_and_creates_layout() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path()).unwrap();
        assert!(state.data_dir.join("vaults").is_dir());
        assert!(state.data_dir.join("logs").is_dir());
        assert!(state.data_dir.join("db").join("mnote.db").is_file());
        assert!(!state.data_dir.join("mnote.db").exists());
        assert_eq!(
            state.vault_dir("alice"),
            dir.path().join("vaults").join("alice")
        );
    }

    #[test]
    fn migrates_legacy_db() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("mnote.db"), b"legacy").unwrap();
        ensure_data_layout(dir.path()).unwrap();
        assert!(!dir.path().join("mnote.db").exists());
        assert_eq!(
            std::fs::read(dir.path().join("db").join("mnote.db")).unwrap(),
            b"legacy"
        );
    }

    #[test]
    fn open_single_keeps_db_out_of_vault() {
        let vault = tempdir().unwrap();
        let state_dir = tempdir().unwrap();
        let state = AppState::open_single(vault.path(), state_dir.path()).unwrap();
        assert!(vault.path().join("notes").is_dir());
        assert!(!vault.path().join("db").exists());
        assert!(state_dir.path().join("mnote.db").is_file());
        assert_eq!(state.vault_dir("me"), vault.path());
        assert_eq!(state.vault_dir("alice"), vault.path());
    }
}
