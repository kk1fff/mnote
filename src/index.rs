use crate::error::AppError;
use crate::notes;
use crate::parked;
use crate::AppState;
use rusqlite::{params, OptionalExtension};
use std::path::Path;

pub fn init(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS search_meta (
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            doc_id TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            PRIMARY KEY (user_id, kind, doc_id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
            user_id UNINDEXED,
            kind UNINDEXED,
            doc_id UNINDEXED,
            title,
            body,
            tags
        );
        CREATE TABLE IF NOT EXISTS note_edit_clock (
            user_id INTEGER NOT NULL,
            note_id TEXT NOT NULL,
            last_edit TEXT NOT NULL,
            PRIMARY KEY (user_id, note_id)
        );
        ",
    )?;
    Ok(())
}

fn mtime_secs(path: &Path) -> i64 {
    path.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[allow(clippy::too_many_arguments)]
fn upsert_doc(
    conn: &rusqlite::Connection,
    user_id: i64,
    kind: &str,
    doc_id: &str,
    mtime: i64,
    title: &str,
    body: &str,
    tags: &str,
) -> Result<(), AppError> {
    let current: Option<i64> = conn
        .query_row(
            "SELECT mtime FROM search_meta WHERE user_id = ?1 AND kind = ?2 AND doc_id = ?3",
            params![user_id, kind, doc_id],
            |row| row.get(0),
        )
        .optional()?;
    if current == Some(mtime) {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM search_fts WHERE user_id = ?1 AND kind = ?2 AND doc_id = ?3",
        params![user_id, kind, doc_id],
    )?;
    conn.execute(
        "INSERT INTO search_fts (user_id, kind, doc_id, title, body, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![user_id, kind, doc_id, title, body, tags],
    )?;
    conn.execute(
        "INSERT INTO search_meta (user_id, kind, doc_id, mtime) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id, kind, doc_id) DO UPDATE SET mtime = excluded.mtime",
        params![user_id, kind, doc_id, mtime],
    )?;
    Ok(())
}

fn remove_missing(
    conn: &rusqlite::Connection,
    user_id: i64,
    kind: &str,
    live: &[String],
) -> Result<(), AppError> {
    let mut stmt = conn.prepare("SELECT doc_id FROM search_meta WHERE user_id = ?1 AND kind = ?2")?;
    let ids = stmt
        .query_map(params![user_id, kind], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in ids {
        if !live.iter().any(|live_id| live_id == &id) {
            conn.execute(
                "DELETE FROM search_fts WHERE user_id = ?1 AND kind = ?2 AND doc_id = ?3",
                params![user_id, kind, id],
            )?;
            conn.execute(
                "DELETE FROM search_meta WHERE user_id = ?1 AND kind = ?2 AND doc_id = ?3",
                params![user_id, kind, id],
            )?;
        }
    }
    Ok(())
}

pub fn sync(state: &AppState, user_id: i64, vault: &Path) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let notes = notes::list_notes_internal(vault)?;
    let mut note_ids = Vec::new();
    for note in &notes {
        let path = vault.join("notes").join(format!("{}.md", note.file_path));
        let mtime = mtime_secs(&path);
        let tags = crate::tags::format_tags(&note.tags);
        upsert_doc(
            &conn,
            user_id,
            "note",
            &note.id,
            mtime,
            &note.title,
            &note.content,
            &tags,
        )?;
        note_ids.push(note.id.clone());
    }
    remove_missing(&conn, user_id, "note", &note_ids)?;

    let parked = parked::list_parked(vault)?;
    let mut parked_ids = Vec::new();
    for item in &parked {
        let path = vault.join("parked").join(format!("{}.md", item.id));
        let mtime = mtime_secs(&path);
        let title = item.body.lines().next().unwrap_or("Parked");
        let tags = crate::tags::format_tags(&item.tags);
        upsert_doc(
            &conn, user_id, "parked", &item.id, mtime, title, &item.body, &tags,
        )?;
        parked_ids.push(item.id.clone());
    }
    remove_missing(&conn, user_id, "parked", &parked_ids)?;

    let ctx_dir = vault.join("context");
    let mut ctx_ids = Vec::new();
    if ctx_dir.is_dir() {
        for entry in std::fs::read_dir(&ctx_dir)? {
            let path = entry?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let raw = std::fs::read_to_string(&path).unwrap_or_default();
            let mtime = mtime_secs(&path);
            upsert_doc(&conn, user_id, "context", id, mtime, "", &raw, "")?;
            ctx_ids.push(id.to_string());
        }
    }
    remove_missing(&conn, user_id, "context", &ctx_ids)?;
    Ok(())
}

pub fn session_ended(state: &AppState, user_id: i64, note_id: &str) -> Result<bool, AppError> {
    const IDLE: std::time::Duration = std::time::Duration::from_secs(5 * 60);
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT last_edit FROM note_edit_clock WHERE user_id = ?1 AND note_id = ?2",
            params![user_id, note_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(raw) = raw else {
        return Ok(true);
    };
    let Some(at) = chrono::DateTime::parse_from_rfc3339(raw.trim())
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
    else {
        return Ok(true);
    };
    let age = chrono::Utc::now()
        .signed_duration_since(at)
        .to_std()
        .unwrap_or(std::time::Duration::ZERO);
    Ok(age >= IDLE)
}

pub fn touch_edit(state: &AppState, user_id: i64, note_id: &str) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute(
        "INSERT INTO note_edit_clock (user_id, note_id, last_edit) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, note_id) DO UPDATE SET last_edit = excluded.last_edit",
        params![user_id, note_id, now],
    )?;
    Ok(())
}

pub fn set_last_edit(
    state: &AppState,
    user_id: i64,
    note_id: &str,
    at: &str,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute(
        "INSERT INTO note_edit_clock (user_id, note_id, last_edit) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, note_id) DO UPDATE SET last_edit = excluded.last_edit",
        params![user_id, note_id, at],
    )?;
    Ok(())
}

pub fn user_id_by_name(state: &AppState, username: &str) -> Result<Option<i64>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.query_row(
        "SELECT id FROM users WHERE username = ?1",
        params![username],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}
