use crate::error::AppError;
use crate::notes;
use crate::AppState;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Parked {
    pub id: String,
    pub body: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accuracy_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weather_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weather_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp_c: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

pub struct ParkedSource<'a> {
    pub source_id: Option<&'a str>,
    pub source_title: Option<&'a str>,
    pub source_folder: Option<&'a str>,
    pub excerpt: Option<&'a str>,
}

fn parked_dir(vault: &Path) -> std::path::PathBuf {
    vault.join("parked")
}

fn parked_path(vault: &Path, id: &str) -> std::path::PathBuf {
    parked_dir(vault).join(format!("{id}.md"))
}

fn encode_field(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\n', "\\n")
}

fn decode_field(value: &str) -> String {
    let mut out = String::new();
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn opt(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

fn parse_f64(s: &str) -> Option<f64> {
    s.trim().parse().ok()
}

fn parse_i64(s: &str) -> Option<i64> {
    s.trim().parse().ok()
}

fn render_parked(item: &Parked) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("id: {}\n", item.id));
    out.push_str(&format!("created_at: {}\n", item.created_at));
    if let Some(v) = &item.source_id {
        out.push_str(&format!("source_id: {}\n", encode_field(v)));
    }
    if let Some(v) = &item.source_title {
        out.push_str(&format!("source_title: {}\n", encode_field(v)));
    }
    if let Some(v) = &item.source_folder {
        out.push_str(&format!("source_folder: {}\n", encode_field(v)));
    }
    if let Some(v) = &item.excerpt {
        out.push_str(&format!("excerpt: {}\n", encode_field(v)));
    }
    if let Some(v) = &item.surface {
        out.push_str(&format!("surface: {}\n", encode_field(v)));
    }
    if let Some(v) = &item.device {
        out.push_str(&format!("device: {}\n", encode_field(v)));
    }
    if let Some(v) = &item.local_time {
        out.push_str(&format!("local_time: {}\n", encode_field(v)));
    }
    if let Some(v) = &item.timezone {
        out.push_str(&format!("timezone: {}\n", encode_field(v)));
    }
    if let Some(v) = item.lat {
        out.push_str(&format!("lat: {v}\n"));
    }
    if let Some(v) = item.lon {
        out.push_str(&format!("lon: {v}\n"));
    }
    if let Some(v) = item.accuracy_m {
        out.push_str(&format!("accuracy_m: {v}\n"));
    }
    if let Some(v) = item.weather_code {
        out.push_str(&format!("weather_code: {v}\n"));
    }
    if let Some(v) = &item.weather_label {
        out.push_str(&format!("weather_label: {}\n", encode_field(v)));
    }
    if let Some(v) = item.temp_c {
        out.push_str(&format!("temp_c: {v}\n"));
    }
    if !item.tags.is_empty() {
        out.push_str(&format!(
            "tags: {}\n",
            crate::tags::format_tags(&item.tags)
        ));
    }
    out.push_str("---\n\n");
    out.push_str(&item.body);
    if !item.body.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn load_parked_file(path: &Path) -> Result<Parked, AppError> {
    let raw = std::fs::read_to_string(path)?;
    let (fields, body) = notes::parse_frontmatter(&raw);
    let id = fields
        .get("id")
        .cloned()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .map(str::to_string)
        })
        .ok_or(AppError::NotFound)?;
    let tags = fields
        .get("tags")
        .map(|s| crate::tags::parse_tags_field(s))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| crate::tags::extract_hashtags(&body));
    Ok(Parked {
        id,
        body: body.trim_end_matches('\n').to_string(),
        created_at: fields
            .get("created_at")
            .cloned()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        source_id: fields.get("source_id").and_then(|s| opt(&decode_field(s))),
        source_title: fields
            .get("source_title")
            .and_then(|s| opt(&decode_field(s))),
        source_folder: fields
            .get("source_folder")
            .and_then(|s| opt(&decode_field(s))),
        excerpt: fields.get("excerpt").and_then(|s| opt(&decode_field(s))),
        surface: fields.get("surface").and_then(|s| opt(&decode_field(s))),
        device: fields.get("device").and_then(|s| opt(&decode_field(s))),
        local_time: fields.get("local_time").and_then(|s| opt(&decode_field(s))),
        timezone: fields.get("timezone").and_then(|s| opt(&decode_field(s))),
        lat: fields.get("lat").and_then(|s| parse_f64(s)),
        lon: fields.get("lon").and_then(|s| parse_f64(s)),
        accuracy_m: fields.get("accuracy_m").and_then(|s| parse_f64(s)),
        weather_code: fields.get("weather_code").and_then(|s| parse_i64(s)),
        weather_label: fields
            .get("weather_label")
            .and_then(|s| opt(&decode_field(s))),
        temp_c: fields.get("temp_c").and_then(|s| parse_f64(s)),
        tags,
    })
}

fn write_parked(vault: &Path, item: &Parked) -> Result<(), AppError> {
    let dir = parked_dir(vault);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(parked_path(vault, &item.id), render_parked(item))?;
    Ok(())
}

pub fn normalize_parked_id(raw: &str) -> Result<String, AppError> {
    notes::normalize_note_id(raw)
}

pub fn list_parked(vault: &Path) -> Result<Vec<Parked>, AppError> {
    notes::ensure_vault(vault)?;
    let dir = parked_dir(vault);
    let mut items = Vec::new();
    if !dir.is_dir() {
        return Ok(items);
    }
    for entry in std::fs::read_dir(&dir)? {
        let path = entry?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Ok(item) = load_parked_file(&path) {
            items.push(item);
        }
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    Ok(items)
}

pub fn get_parked(vault: &Path, id: &str) -> Result<Parked, AppError> {
    let id = normalize_parked_id(id)?;
    let path = parked_path(vault, &id);
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    load_parked_file(&path)
}

pub fn create_parked(
    state: &AppState,
    vault: &Path,
    body: &str,
    source: ParkedSource<'_>,
    stamp: &crate::context::ContextStamp,
) -> Result<Parked, AppError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("body is empty".into()));
    }
    if body.len() > 20_000 {
        return Err(AppError::BadRequest("body is too long".into()));
    }
    let weather = match (stamp.lat, stamp.lon) {
        (Some(lat), Some(lon)) => crate::context::lookup_weather(state, lat, lon).ok().flatten(),
        _ => None,
    };
    let item = Parked {
        id: Uuid::new_v4().to_string(),
        body: body.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        source_id: source.source_id.map(str::to_string).filter(|s| !s.is_empty()),
        source_title: source
            .source_title
            .map(str::to_string)
            .filter(|s| !s.is_empty()),
        source_folder: source
            .source_folder
            .map(str::to_string)
            .filter(|s| !s.is_empty()),
        excerpt: source.excerpt.map(str::to_string).filter(|s| !s.is_empty()),
        surface: stamp.surface.clone(),
        device: stamp.device.clone(),
        local_time: stamp.local_time.clone(),
        timezone: stamp.timezone.clone(),
        lat: stamp.lat,
        lon: stamp.lon,
        accuracy_m: stamp.accuracy_m,
        weather_code: weather.as_ref().map(|w| w.weather_code),
        weather_label: weather.as_ref().map(|w| w.weather_label.clone()),
        temp_c: weather.as_ref().map(|w| w.temp_c),
        tags: crate::tags::extract_hashtags(body),
    };
    write_parked(vault, &item)?;
    Ok(item)
}

pub fn delete_parked(vault: &Path, id: &str) -> Result<(), AppError> {
    let id = normalize_parked_id(id)?;
    let path = parked_path(vault, &id);
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    std::fs::remove_file(path)?;
    Ok(())
}

pub fn apply_weather(vault: &Path, id: &str, weather: &crate::context::WeatherNow) -> Result<(), AppError> {
    let mut item = get_parked(vault, id)?;
    item.weather_code = Some(weather.weather_code);
    item.weather_label = Some(weather.weather_label.clone());
    item.temp_c = Some(weather.temp_c);
    write_parked(vault, &item)
}

pub fn migrate_from_db(state: &AppState, username: &str, vault: &Path) -> Result<(), AppError> {
    let user_id = match user_id_by_name(state, username)? {
        Some(id) => id,
        None => return Ok(()),
    };
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'parked'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if exists == 0 {
        return Ok(());
    }
    let mut stmt = conn.prepare(
        "SELECT id, body, created_at, source_id, source_title, source_folder, excerpt,
                surface, device, local_time, timezone, lat, lon, accuracy_m,
                weather_code, weather_label, temp_c, tags
         FROM parked WHERE user_id = ?1",
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, Option<String>>(10)?,
            row.get::<_, Option<f64>>(11)?,
            row.get::<_, Option<f64>>(12)?,
            row.get::<_, Option<f64>>(13)?,
            row.get::<_, Option<i64>>(14)?,
            row.get::<_, Option<String>>(15)?,
            row.get::<_, Option<f64>>(16)?,
            row.get::<_, Option<String>>(17)?,
        ))
    })?;
    let mut exported = Vec::new();
    for row in rows {
        let (
            old_id,
            body,
            created_at,
            source_id,
            source_title,
            source_folder,
            excerpt,
            surface,
            device,
            local_time,
            timezone,
            lat,
            lon,
            accuracy_m,
            weather_code,
            weather_label,
            temp_c,
            tags,
        ) = row?;
        let tags = tags
            .filter(|s| !s.trim().is_empty())
            .map(|s| crate::tags::parse_tags_field(&s))
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| crate::tags::extract_hashtags(&body));
        exported.push(Parked {
            id: Uuid::new_v4().to_string(),
            body,
            created_at,
            source_id,
            source_title,
            source_folder,
            excerpt,
            surface,
            device,
            local_time,
            timezone,
            lat,
            lon,
            accuracy_m,
            weather_code,
            weather_label,
            temp_c,
            tags,
        });
        let _ = old_id;
    }
    drop(stmt);
    if exported.is_empty() {
        return Ok(());
    }
    conn.execute("DELETE FROM parked WHERE user_id = ?1", params![user_id])?;
    drop(conn);
    for item in exported {
        write_parked(vault, &item)?;
    }
    Ok(())
}

fn user_id_by_name(state: &AppState, username: &str) -> Result<Option<i64>, AppError> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parked_roundtrip() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        notes::ensure_vault(vault).unwrap();
        let item = Parked {
            id: "abc".into(),
            body: "ask jim".into(),
            created_at: "2026-09-11T00:00:00Z".into(),
            source_id: Some("n1".into()),
            source_title: Some("Weekly".into()),
            source_folder: Some("ideas".into()),
            excerpt: Some("retry\nbudget".into()),
            surface: Some("park".into()),
            device: Some("phone".into()),
            local_time: Some("2026-09-11 00:00".into()),
            timezone: Some("America/Los_Angeles".into()),
            lat: Some(37.77),
            lon: Some(-122.42),
            accuracy_m: None,
            weather_code: None,
            weather_label: None,
            temp_c: None,
            tags: vec!["work".into()],
        };
        write_parked(vault, &item).unwrap();
        let loaded = get_parked(vault, "abc").unwrap();
        assert_eq!(loaded.body, "ask jim");
        assert_eq!(loaded.excerpt.as_deref(), Some("retry\nbudget"));
        assert_eq!(loaded.lat, Some(37.77));
        assert_eq!(loaded.tags, vec!["work"]);
    }
}
