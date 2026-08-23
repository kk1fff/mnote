pub mod api;
pub mod auth;
pub mod db;
pub mod error;
pub mod live;
pub mod merge;
pub mod notes;

use crate::error::AppError;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
    pub db: Arc<Mutex<Connection>>,
    pub live: live::LiveHub,
}

impl AppState {
    pub fn open(data_dir: impl Into<PathBuf>) -> Result<Self, AppError> {
        let data_dir = data_dir.into();
        ensure_data_layout(&data_dir)?;
        let conn = Connection::open(db_path(&data_dir))?;
        db::init(&conn)?;
        if let Ok(entries) = std::fs::read_dir(vaults_dir(&data_dir)) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    notes::migrate_wiki_paths(&entry.path())?;
                }
            }
        }
        Ok(Self {
            data_dir,
            db: Arc::new(Mutex::new(conn)),
            live: live::LiveHub::new(),
        })
    }

    pub fn vault_dir(&self, username: &str) -> PathBuf {
        vaults_dir(&self.data_dir).join(username)
    }

    pub fn logs_dir(&self) -> PathBuf {
        logs_dir(&self.data_dir)
    }
}

pub fn db_path(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("db").join("mnote.db")
}

pub fn vaults_dir(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("vaults")
}

pub fn logs_dir(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("logs")
}

pub fn ensure_data_layout(data_dir: &std::path::Path) -> Result<(), AppError> {
    std::fs::create_dir_all(data_dir.join("db"))?;
    std::fs::create_dir_all(vaults_dir(data_dir))?;
    std::fs::create_dir_all(logs_dir(data_dir))?;
    let legacy = data_dir.join("mnote.db");
    let current = db_path(data_dir);
    if legacy.is_file() && !current.exists() {
        std::fs::rename(legacy, current)?;
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
}
