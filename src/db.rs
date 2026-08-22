use crate::auth::{self, generate_password, hash_password, hash_token, random_token};
use crate::error::AppError;
use crate::AppState;
use chrono::{Duration, Utc};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

pub const SESSION_COOKIE: &str = "mnote_session";
pub const SESSION_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub must_change_password: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserSummary {
    pub username: String,
    pub must_change_password: bool,
    pub created_at: String,
}

pub fn init(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            must_change_password INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_note_state (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            favorite INTEGER NOT NULL DEFAULT 0,
            last_opened_at TEXT,
            PRIMARY KEY (user_id, path)
        );
        CREATE INDEX IF NOT EXISTS user_note_state_recent_idx
            ON user_note_state (user_id, last_opened_at DESC);
        ",
    )?;
    Ok(())
}

pub fn create_user(
    state: &AppState,
    username: &str,
    password: Option<&str>,
) -> Result<String, AppError> {
    if !auth::valid_username(username) {
        return Err(AppError::BadRequest(
            "username must be 1-32 chars of [A-Za-z0-9_-]".into(),
        ));
    }
    let generated = generate_password();
    let plain = password.unwrap_or(generated.as_str());
    if plain.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let hash = hash_password(plain).map_err(|e| AppError::Internal(anyhow::anyhow!("{e}")))?;
    let now = Utc::now().to_rfc3339();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    match conn.execute(
        "INSERT INTO users (username, password_hash, must_change_password, created_at)
         VALUES (?1, ?2, 1, ?3)",
        params![username, hash, now],
    ) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            return Err(AppError::Conflict("username already exists".into()));
        }
        Err(err) => return Err(err.into()),
    }
    drop(conn);
    crate::notes::ensure_vault(&state.vault_dir(username))?;
    Ok(plain.to_string())
}

pub fn list_users(state: &AppState) -> Result<Vec<UserSummary>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let mut stmt = conn.prepare(
        "SELECT username, must_change_password, created_at FROM users ORDER BY username",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(UserSummary {
            username: row.get(0)?,
            must_change_password: row.get::<_, i64>(1)? != 0,
            created_at: row.get(2)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn reset_password(state: &AppState, username: &str) -> Result<String, AppError> {
    let password = generate_password();
    set_password(state, username, &password, true)?;
    delete_user_sessions(state, username)?;
    Ok(password)
}

pub fn replace_password(
    state: &AppState,
    username: &str,
    new_password: &str,
) -> Result<(), AppError> {
    if new_password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let hash: String = conn
        .query_row(
            "SELECT password_hash FROM users WHERE username = ?1",
            params![username],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    drop(conn);
    if auth::verify_password(new_password, &hash) {
        return Err(AppError::BadRequest("choose a different password".into()));
    }
    set_password(state, username, new_password, false)
}

pub fn set_password(
    state: &AppState,
    username: &str,
    password: &str,
    must_change: bool,
) -> Result<(), AppError> {
    if password.len() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let hash = hash_password(password).map_err(|e| AppError::Internal(anyhow::anyhow!("{e}")))?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let n = conn.execute(
        "UPDATE users SET password_hash = ?1, must_change_password = ?2 WHERE username = ?3",
        params![hash, must_change as i64, username],
    )?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn delete_user_sessions(state: &AppState, username: &str) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute(
        "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?1)",
        params![username],
    )?;
    Ok(())
}

pub fn authenticate(state: &AppState, username: &str, password: &str) -> Result<User, AppError> {
    let username = username.trim();
    let password = password.trim();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let row = conn
        .query_row(
            "SELECT id, username, password_hash, must_change_password FROM users WHERE username = ?1",
            params![username],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .optional()?;
    let Some((id, username, hash, must_change_password)) = row else {
        return Err(AppError::Unauthorized);
    };
    if !auth::verify_password(password, &hash) {
        return Err(AppError::Unauthorized);
    }
    Ok(User {
        id,
        username,
        must_change_password,
    })
}

pub fn create_session(state: &AppState, user_id: i64) -> Result<String, AppError> {
    let token = random_token();
    let token_hash = hash_token(&token);
    let expires = (Utc::now() + Duration::days(SESSION_DAYS)).to_rfc3339();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)",
        params![token_hash, user_id, expires],
    )?;
    Ok(token)
}

pub fn user_from_token(state: &AppState, token: &str) -> Result<User, AppError> {
    let token_hash = hash_token(token);
    let now = Utc::now().to_rfc3339();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute("DELETE FROM sessions WHERE expires_at < ?1", params![now])?;
    let row = conn
        .query_row(
            "SELECT u.id, u.username, u.must_change_password
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ?1 AND s.expires_at >= ?2",
            params![token_hash, now],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    must_change_password: row.get::<_, i64>(2)? != 0,
                })
            },
        )
        .optional()?;
    row.ok_or(AppError::Unauthorized)
}

pub fn delete_session(state: &AppState, token: &str) -> Result<(), AppError> {
    let token_hash = hash_token(token);
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute(
        "DELETE FROM sessions WHERE token_hash = ?1",
        params![token_hash],
    )?;
    Ok(())
}

pub fn keep_only_session(state: &AppState, user_id: i64, token: &str) -> Result<(), AppError> {
    let token_hash = hash_token(token);
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute(
        "DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2",
        params![user_id, token_hash],
    )?;
    Ok(())
}

pub fn record_note_open(state: &AppState, user_id: i64, path: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute(
        "INSERT INTO user_note_state (user_id, path, last_opened_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, path) DO UPDATE SET last_opened_at = excluded.last_opened_at",
        params![user_id, path, now],
    )?;
    Ok(())
}

pub fn set_favorite(
    state: &AppState,
    user_id: i64,
    path: &str,
    favorite: bool,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    if favorite {
        conn.execute(
            "INSERT INTO user_note_state (user_id, path, favorite) VALUES (?1, ?2, 1)
             ON CONFLICT(user_id, path) DO UPDATE SET favorite = 1",
            params![user_id, path],
        )?;
    } else {
        conn.execute(
            "UPDATE user_note_state SET favorite = 0 WHERE user_id = ?1 AND path = ?2",
            params![user_id, path],
        )?;
        conn.execute(
            "DELETE FROM user_note_state
             WHERE user_id = ?1 AND path = ?2 AND favorite = 0 AND last_opened_at IS NULL",
            params![user_id, path],
        )?;
    }
    Ok(())
}

pub fn favorite_paths(state: &AppState, user_id: i64) -> Result<Vec<String>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let mut stmt = conn.prepare(
        "SELECT path FROM user_note_state
         WHERE user_id = ?1 AND favorite = 1
         ORDER BY last_opened_at DESC, path",
    )?;
    let paths = stmt
        .query_map(params![user_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    Ok(paths)
}

pub fn recent_paths(state: &AppState, user_id: i64) -> Result<Vec<String>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let mut stmt = conn.prepare(
        "SELECT path FROM user_note_state
         WHERE user_id = ?1 AND last_opened_at IS NOT NULL
         ORDER BY last_opened_at DESC LIMIT 20",
    )?;
    let paths = stmt
        .query_map(params![user_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn setup() -> (tempfile::TempDir, AppState) {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path()).unwrap();
        (dir, state)
    }

    #[test]
    fn create_list_and_auth() {
        let (_dir, state) = setup();
        let pw = create_user(&state, "alice", None).unwrap();
        assert!(pw.len() >= 8);
        let users = list_users(&state).unwrap();
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].username, "alice");
        assert!(users[0].must_change_password);
        create_user(&state, "bob", Some("password1")).unwrap();
        let bob = authenticate(&state, "bob", "password1").unwrap();
        assert!(bob.must_change_password);
        replace_password(&state, "bob", "password1").unwrap_err();
        replace_password(&state, "bob", "newpass12").unwrap();
        let bob = authenticate(&state, "bob", "newpass12").unwrap();
        assert!(!bob.must_change_password);
        let user = authenticate(&state, "alice", &pw).unwrap();
        assert_eq!(user.username, "alice");
        assert!(authenticate(&state, "alice", "nope").is_err());
        assert!(authenticate(&state, "missing", &pw).is_err());
    }

    #[test]
    fn duplicate_and_bad_username() {
        let (_dir, state) = setup();
        create_user(&state, "alice", Some("password1")).unwrap();
        assert!(matches!(
            create_user(&state, "alice", Some("password1")),
            Err(AppError::Conflict(_))
        ));
        assert!(matches!(
            create_user(&state, "bad name", Some("password1")),
            Err(AppError::BadRequest(_))
        ));
        assert!(matches!(
            create_user(&state, "ok", Some("short")),
            Err(AppError::BadRequest(_))
        ));
    }

    #[test]
    fn session_lifecycle() {
        let (_dir, state) = setup();
        create_user(&state, "alice", Some("password1")).unwrap();
        let user = authenticate(&state, "alice", "password1").unwrap();
        let token = create_session(&state, user.id).unwrap();
        let loaded = user_from_token(&state, &token).unwrap();
        assert_eq!(loaded.username, "alice");
        delete_session(&state, &token).unwrap();
        assert!(user_from_token(&state, &token).is_err());
        let a = create_session(&state, user.id).unwrap();
        let b = create_session(&state, user.id).unwrap();
        keep_only_session(&state, user.id, &b).unwrap();
        assert!(user_from_token(&state, &a).is_err());
        assert!(user_from_token(&state, &b).is_ok());
    }

    #[test]
    fn reset_invalidates_sessions() {
        let (_dir, state) = setup();
        create_user(&state, "alice", Some("password1")).unwrap();
        let user = authenticate(&state, "alice", "password1").unwrap();
        let token = create_session(&state, user.id).unwrap();
        let next = reset_password(&state, "alice").unwrap();
        assert!(user_from_token(&state, &token).is_err());
        authenticate(&state, "alice", &next).unwrap();
        assert!(reset_password(&state, "nobody").is_err());
    }
}
