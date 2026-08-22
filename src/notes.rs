use crate::error::AppError;
use chrono::NaiveDate;
use regex::Regex;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Note {
    pub path: String,
    pub content: String,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Asset {
    pub id: String,
    pub url: String,
    pub markdown: String,
}

const ALLOWED_IMAGE_TYPES: &[(&str, &str)] = &[
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
];

pub const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;

pub fn ensure_vault(vault: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(vault.join("notes"))?;
    std::fs::create_dir_all(vault.join("assets"))?;
    Ok(())
}

pub fn normalize_note_path(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim().trim_start_matches('/');
    let without_md = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".MD"))
        .unwrap_or(trimmed);
    if without_md.is_empty() {
        return Err(AppError::BadRequest("note path is empty".into()));
    }
    if without_md.contains('\\') || without_md.contains('\0') {
        return Err(AppError::BadRequest("invalid note path".into()));
    }
    if without_md.len() > 200 {
        return Err(AppError::BadRequest("note path is too long".into()));
    }
    let path = Path::new(without_md);
    if path.is_absolute() {
        return Err(AppError::BadRequest("note path must be relative".into()));
    }
    let mut parts = Vec::new();
    for comp in path.components() {
        match comp {
            Component::Normal(s) => {
                let s = s.to_string_lossy();
                if s.is_empty() || s == "." || s.contains('\0') {
                    return Err(AppError::BadRequest("invalid note path".into()));
                }
                parts.push(s.into_owned());
            }
            _ => return Err(AppError::BadRequest("invalid note path".into())),
        }
    }
    if parts.is_empty() {
        return Err(AppError::BadRequest("note path is empty".into()));
    }
    Ok(parts.join("/"))
}

pub fn is_daily_path(path: &str) -> bool {
    NaiveDate::parse_from_str(path, "%Y-%m-%d").is_ok() && !path.contains('/')
}

pub fn parse_daily_date(date: &str) -> Result<String, AppError> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| d.format("%Y-%m-%d").to_string())
        .map_err(|_| AppError::BadRequest("date must be YYYY-MM-DD".into()))
}

fn note_file(vault: &Path, path: &str) -> PathBuf {
    vault.join("notes").join(format!("{path}.md"))
}

fn file_modified(path: &Path) -> Result<String, AppError> {
    let meta = std::fs::metadata(path)?;
    let modified = meta.modified()?;
    let dt: chrono::DateTime<chrono::Utc> = modified.into();
    Ok(dt.to_rfc3339())
}

pub fn note_title(path: &str, content: &str) -> String {
    for line in content.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }
    path.rsplit('/').next().unwrap_or(path).to_string()
}

pub fn get_note(vault: &Path, path: &str) -> Result<Note, AppError> {
    let path = normalize_note_path(path)?;
    let file = note_file(vault, &path);
    if !file.is_file() {
        return Err(AppError::NotFound);
    }
    let content = std::fs::read_to_string(&file)?;
    Ok(Note {
        path,
        content,
        modified_at: file_modified(&file)?,
    })
}

pub fn note_meta(vault: &Path, path: &str) -> Result<NoteMeta, AppError> {
    let note = get_note(vault, path)?;
    Ok(NoteMeta {
        title: note_title(&note.path, &note.content),
        path: note.path,
        modified_at: note.modified_at,
    })
}

pub fn put_note(vault: &Path, path: &str, content: &str) -> Result<Note, AppError> {
    ensure_vault(vault)?;
    let path = normalize_note_path(path)?;
    let file = note_file(vault, &path);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&file, content)?;
    Ok(Note {
        path,
        content: content.to_string(),
        modified_at: file_modified(&file)?,
    })
}

pub fn get_or_create_daily(vault: &Path, date: &str) -> Result<Note, AppError> {
    let date = parse_daily_date(date)?;
    match get_note(vault, &date) {
        Ok(note) => Ok(note),
        Err(AppError::NotFound) => put_note(vault, &date, &format!("# {date}\n\n")),
        Err(err) => Err(err),
    }
}

pub fn list_notes(vault: &Path) -> Result<Vec<NoteMeta>, AppError> {
    ensure_vault(vault)?;
    let root = vault.join("notes");
    let mut notes = Vec::new();
    if !root.exists() {
        return Ok(notes);
    }
    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let rel = path.strip_prefix(&root).unwrap();
        let rel = rel.with_extension("");
        let note_path = rel.to_string_lossy().replace('\\', "/");
        let Ok(note_path) = normalize_note_path(&note_path) else {
            continue;
        };
        let content = std::fs::read_to_string(path).unwrap_or_default();
        notes.push(NoteMeta {
            title: note_title(&note_path, &content),
            path: note_path,
            modified_at: file_modified(path)?,
        });
    }
    notes.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(notes)
}

fn wiki_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\[\]]+)\]\]").expect("wiki regex"))
}

pub fn extract_wiki_targets(content: &str) -> Vec<String> {
    wiki_re()
        .captures_iter(content)
        .filter_map(|caps| {
            let inner = caps.get(1)?.as_str();
            let target = inner.split('|').next().unwrap_or(inner).trim();
            normalize_note_path(target).ok()
        })
        .collect()
}

pub fn backlinks(vault: &Path, target: &str) -> Result<Vec<NoteMeta>, AppError> {
    let target = normalize_note_path(target)?;
    let mut hits = Vec::new();
    for meta in list_notes(vault)? {
        if meta.path == target {
            continue;
        }
        let note = get_note(vault, &meta.path)?;
        if extract_wiki_targets(&note.content)
            .iter()
            .any(|t| t == &target)
        {
            hits.push(meta);
        }
    }
    Ok(hits)
}

pub fn search(vault: &Path, query: &str) -> Result<Vec<SearchHit>, AppError> {
    let q = query.trim();
    if q.is_empty() {
        return Err(AppError::BadRequest("query is empty".into()));
    }
    if q.len() > 200 {
        return Err(AppError::BadRequest("query is too long".into()));
    }
    let needle = q.to_lowercase();
    let mut hits = Vec::new();
    for meta in list_notes(vault)? {
        let note = get_note(vault, &meta.path)?;
        let hay = format!("{}\n{}", note.path, note.content).to_lowercase();
        if let Some(idx) = hay.find(&needle) {
            hits.push(SearchHit {
                path: meta.path,
                title: meta.title,
                snippet: snippet(
                    &note.content,
                    idx.saturating_sub(note.path.len() + 1),
                    q.len(),
                ),
            });
        }
    }
    Ok(hits)
}

pub fn snippet(content: &str, idx: usize, needle_len: usize) -> String {
    let chars: Vec<char> = content.chars().collect();
    if chars.is_empty() {
        return String::new();
    }
    let start = idx.saturating_sub(40).min(chars.len());
    let end = (idx + needle_len + 40).min(chars.len());
    let mut s: String = chars[start..end].iter().collect();
    if start > 0 {
        s = format!("…{s}");
    }
    if end < chars.len() {
        s = format!("{s}…");
    }
    s.replace('\n', " ")
}

pub fn ext_for_content_type(content_type: &str) -> Result<&'static str, AppError> {
    let ct = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();
    ALLOWED_IMAGE_TYPES
        .iter()
        .find(|(mime, _)| *mime == ct)
        .map(|(_, ext)| *ext)
        .ok_or_else(|| AppError::BadRequest("unsupported image type".into()))
}

pub fn save_asset(vault: &Path, content_type: &str, bytes: &[u8]) -> Result<Asset, AppError> {
    if bytes.is_empty() {
        return Err(AppError::BadRequest("empty file".into()));
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(AppError::BadRequest("file too large".into()));
    }
    let ext = ext_for_content_type(content_type)?;
    ensure_vault(vault)?;
    let id = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    std::fs::write(vault.join("assets").join(&id), bytes)?;
    let url = format!("/api/assets/{id}");
    Ok(Asset {
        markdown: format!("![]({url})"),
        url,
        id,
    })
}

pub fn read_asset(vault: &Path, id: &str) -> Result<(Vec<u8>, String), AppError> {
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.starts_with('.')
    {
        return Err(AppError::BadRequest("invalid asset id".into()));
    }
    let path = vault.join("assets").join(id);
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    let bytes = std::fs::read(&path)?;
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    Ok((bytes, mime))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn path_normalization() {
        assert_eq!(normalize_note_path("Hello").unwrap(), "Hello");
        assert_eq!(normalize_note_path("/a/b.md").unwrap(), "a/b");
        assert!(normalize_note_path("../etc/passwd").is_err());
        assert!(normalize_note_path("").is_err());
        assert!(normalize_note_path("/").is_err());
        assert!(normalize_note_path("..").is_err());
        assert_eq!(normalize_note_path("a/./b").unwrap(), "a/b");
        assert!(normalize_note_path("a\\b").is_err());
    }

    #[test]
    fn daily_paths() {
        assert!(is_daily_path("2026-08-22"));
        assert!(!is_daily_path("2026-13-01"));
        assert!(!is_daily_path("notes/2026-08-22"));
        assert!(parse_daily_date("nope").is_err());
        assert_eq!(parse_daily_date("2026-08-22").unwrap(), "2026-08-22");
    }

    #[test]
    fn title_from_heading_or_path() {
        assert_eq!(note_title("x/y", "# Hello\nbody"), "Hello");
        assert_eq!(note_title("x/y", "no heading"), "y");
    }

    #[test]
    fn crud_and_daily() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note = put_note(vault, "ideas/one", "# One\n\nhi").unwrap();
        assert_eq!(note.path, "ideas/one");
        let loaded = get_note(vault, "ideas/one").unwrap();
        assert_eq!(loaded.content, "# One\n\nhi");
        assert!(get_note(vault, "missing").is_err());
        let daily = get_or_create_daily(vault, "2026-08-22").unwrap();
        assert!(daily.content.contains("2026-08-22"));
        let again = get_or_create_daily(vault, "2026-08-22").unwrap();
        assert_eq!(again.content, daily.content);
        let list = list_notes(vault).unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn wiki_backlinks_and_search() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        put_note(vault, "alpha", "see [[beta|B]] and [[missing]]").unwrap();
        put_note(vault, "beta", "root").unwrap();
        assert_eq!(extract_wiki_targets("see [[beta|B]]"), vec!["beta"]);
        let links = backlinks(vault, "beta").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].path, "alpha");
        let hits = search(vault, "root").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "beta");
        assert!(search(vault, "   ").is_err());
        assert!(search(vault, &"q".repeat(201)).is_err());
        assert!(extract_wiki_targets("[[../x]]").is_empty());
        assert!(normalize_note_path(&"a".repeat(201)).is_err());
    }

    #[test]
    fn assets() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        assert!(ext_for_content_type("image/png").is_ok());
        assert!(ext_for_content_type("text/plain").is_err());
        let asset = save_asset(vault, "image/png", &[1, 2, 3, 4]).unwrap();
        assert!(asset.id.ends_with(".png"));
        let (bytes, mime) = read_asset(vault, &asset.id).unwrap();
        assert_eq!(bytes, vec![1, 2, 3, 4]);
        assert!(mime.contains("png"));
        assert!(read_asset(vault, "../x").is_err());
        assert!(save_asset(vault, "image/png", &[]).is_err());
        assert!(save_asset(vault, "image/png", &vec![0; MAX_ASSET_BYTES + 1]).is_err());
    }

    #[test]
    fn snippet_ellipsis() {
        let s = snippet("abcdefghijklmnopqrstuvwxyz", 10, 2);
        assert!(s.contains('k'));
        assert_eq!(snippet("", 0, 1), "");
    }
}
