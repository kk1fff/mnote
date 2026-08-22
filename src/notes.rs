use crate::error::AppError;
use chrono::NaiveDate;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Note {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub folder: String,
    pub content: String,
    pub modified_at: String,
    #[serde(skip)]
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub folder: String,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SearchHit {
    pub id: String,
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

pub fn parse_daily_date(date: &str) -> Result<String, AppError> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| d.format("%Y-%m-%d").to_string())
        .map_err(|_| AppError::BadRequest("date must be YYYY-MM-DD".into()))
}

pub fn normalize_title(raw: &str) -> Result<String, AppError> {
    let title = raw.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("title is empty".into()));
    }
    if title.len() > 200 {
        return Err(AppError::BadRequest("title is too long".into()));
    }
    if title.contains('\n') || title.contains('\r') || title.contains('\0') {
        return Err(AppError::BadRequest("invalid title".into()));
    }
    Ok(title.to_string())
}

pub fn normalize_folder(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    normalize_note_path(trimmed)
}

fn title_key(title: &str) -> String {
    title.trim().to_lowercase()
}

pub fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut dash = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !slug.is_empty() && !dash {
            slug.push('-');
            dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "untitled".into()
    } else {
        slug
    }
}

fn note_file(vault: &Path, file_path: &str) -> PathBuf {
    vault.join("notes").join(format!("{file_path}.md"))
}

fn file_modified(path: &Path) -> Result<String, AppError> {
    let meta = std::fs::metadata(path)?;
    let modified = meta.modified()?;
    let dt: chrono::DateTime<chrono::Utc> = modified.into();
    Ok(dt.to_rfc3339())
}

fn heading_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
    }
    None
}

fn parse_frontmatter(raw: &str) -> (HashMap<String, String>, String) {
    let Some(rest) = raw.strip_prefix("---\n").or_else(|| raw.strip_prefix("---\r\n")) else {
        return (HashMap::new(), raw.to_string());
    };
    let Some(end) = rest.find("\n---\n").or_else(|| rest.find("\n---\r\n")) else {
        return (HashMap::new(), raw.to_string());
    };
    let header = &rest[..end];
    let after = rest[end..]
        .strip_prefix("\n---\n")
        .or_else(|| rest[end..].strip_prefix("\n---\r\n"))
        .unwrap_or("");
    let body = after
        .strip_prefix('\n')
        .or_else(|| after.strip_prefix("\r\n"))
        .unwrap_or(after)
        .to_string();
    let mut fields = HashMap::new();
    for line in header.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').to_string();
        if !key.trim().is_empty() {
            fields.insert(key.trim().to_string(), value);
        }
    }
    (fields, body)
}

fn render_file(note: &Note) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("id: {}\n", note.id));
    out.push_str(&format!("title: {}\n", note.title));
    if !note.folder.is_empty() {
        out.push_str(&format!("folder: {}\n", note.folder));
    }
    out.push_str("---\n\n");
    out.push_str(&note.content);
    out
}

fn write_note(vault: &Path, note: &Note) -> Result<(), AppError> {
    ensure_vault(vault)?;
    let file = note_file(vault, &note.file_path);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&file, render_file(note))?;
    Ok(())
}

fn allocate_file_path(vault: &Path, folder: &str, title: &str, ignore_id: Option<&str>) -> String {
    let slug = slugify(title);
    let base = if folder.is_empty() {
        slug
    } else {
        format!("{folder}/{slug}")
    };
    let existing = list_notes_internal(vault).unwrap_or_default();
    let used: Vec<_> = existing
        .into_iter()
        .filter(|note| ignore_id != Some(note.id.as_str()))
        .map(|note| note.file_path)
        .collect();
    if !used.iter().any(|path| path == &base) && !note_file(vault, &base).exists() {
        return base;
    }
    for n in 2..1000 {
        let candidate = format!("{base}-{n}");
        if !used.iter().any(|path| path == &candidate) && !note_file(vault, &candidate).exists() {
            return candidate;
        }
    }
    format!("{base}-{}", uuid::Uuid::new_v4())
}

fn note_from_file(vault: &Path, file: &Path) -> Result<Note, AppError> {
    let root = vault.join("notes");
    let rel = file.strip_prefix(&root).unwrap_or(file);
    let rel = rel.with_extension("");
    let file_path = rel.to_string_lossy().replace('\\', "/");
    let raw = std::fs::read_to_string(file)?;
    let (fields, body) = parse_frontmatter(&raw);
    let stem = file_path.rsplit('/').next().unwrap_or(file_path.as_str());
    let parent = file_path
        .rsplit_once('/')
        .map(|(folder, _)| folder.to_string())
        .unwrap_or_default();
    let id = fields
        .get("id")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let title = fields
        .get("title")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| heading_title(&body))
        .unwrap_or_else(|| stem.to_string());
    let folder = fields
        .get("folder")
        .map(|s| s.trim().trim_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(parent);
    let note = Note {
        id,
        title,
        folder,
        content: body,
        modified_at: file_modified(file)?,
        file_path,
    };
    if fields.get("id").map(|s| s.trim()).unwrap_or("").is_empty() {
        write_note(vault, &note)?;
    }
    Ok(note)
}

fn list_notes_internal(vault: &Path) -> Result<Vec<Note>, AppError> {
    ensure_vault(vault)?;
    let root = vault.join("notes");
    let mut notes = Vec::new();
    if !root.exists() {
        return Ok(notes);
    }
    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Ok(note) = note_from_file(vault, path) {
            notes.push(note);
        }
    }
    notes.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(notes)
}

pub fn to_meta(note: &Note) -> NoteMeta {
    NoteMeta {
        id: note.id.clone(),
        title: note.title.clone(),
        folder: note.folder.clone(),
        modified_at: note.modified_at.clone(),
    }
}

pub fn list_notes(vault: &Path) -> Result<Vec<NoteMeta>, AppError> {
    Ok(list_notes_internal(vault)?.iter().map(to_meta).collect())
}

pub fn normalize_note_id(raw: &str) -> Result<String, AppError> {
    let id = raw.trim();
    if id.is_empty() {
        return Err(AppError::BadRequest("note id is empty".into()));
    }
    if id.len() > 80
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.contains('\0')
    {
        return Err(AppError::BadRequest("invalid note id".into()));
    }
    Ok(id.to_string())
}

pub fn get_note(vault: &Path, id: &str) -> Result<Note, AppError> {
    let id = normalize_note_id(id)?;
    list_notes_internal(vault)?
        .into_iter()
        .find(|note| note.id == id)
        .ok_or(AppError::NotFound)
}

pub fn find_by_title(vault: &Path, title: &str) -> Result<Option<Note>, AppError> {
    let key = title_key(title);
    Ok(list_notes_internal(vault)?
        .into_iter()
        .find(|note| title_key(&note.title) == key))
}

pub fn create_note(
    vault: &Path,
    title: &str,
    folder: &str,
    content: Option<&str>,
) -> Result<Note, AppError> {
    let title = normalize_title(title)?;
    let folder = normalize_folder(folder)?;
    if let Some(existing) = find_by_title(vault, &title)? {
        return Err(AppError::Conflict(format!("title_exists:{}", existing.id)));
    }
    let file_path = allocate_file_path(vault, &folder, &title, None);
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        content: content.unwrap_or("").to_string(),
        modified_at: String::new(),
        file_path,
        folder,
        title,
    };
    write_note(vault, &note)?;
    get_note(vault, &note.id)
}

pub fn put_note(vault: &Path, id: &str, content: &str) -> Result<Note, AppError> {
    let mut note = get_note(vault, id)?;
    note.content = content.to_string();
    write_note(vault, &note)?;
    get_note(vault, id)
}

pub fn get_or_create_daily(vault: &Path, date: &str) -> Result<Note, AppError> {
    let date = parse_daily_date(date)?;
    if let Some(existing) = find_by_title(vault, &date)? {
        return Ok(existing);
    }
    create_note(vault, &date, "", Some(&format!("# {date}\n\n")))
}

pub fn note_meta(vault: &Path, id: &str) -> Result<NoteMeta, AppError> {
    Ok(to_meta(&get_note(vault, id)?))
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
            if target.is_empty() || target.contains("..") {
                return None;
            }
            Some(target.to_string())
        })
        .collect()
}

pub fn backlinks(vault: &Path, id: &str) -> Result<Vec<NoteMeta>, AppError> {
    let target = get_note(vault, id)?;
    let key = title_key(&target.title);
    let mut hits = Vec::new();
    for note in list_notes_internal(vault)? {
        if note.id == target.id {
            continue;
        }
        if extract_wiki_targets(&note.content)
            .iter()
            .any(|t| title_key(t) == key)
        {
            hits.push(to_meta(&note));
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
    for note in list_notes_internal(vault)? {
        let hay = format!("{}\n{}\n{}", note.title, note.folder, note.content).to_lowercase();
        if let Some(idx) = hay.find(&needle) {
            let offset = idx.saturating_sub(note.title.len() + note.folder.len() + 2);
            hits.push(SearchHit {
                id: note.id,
                title: note.title,
                snippet: snippet(&note.content, offset, q.len()),
            });
        }
    }
    Ok(hits)
}

fn title_search_rank(title: &str, folder: &str, needle: &str) -> Option<u8> {
    let title = title.to_lowercase();
    let folder = folder.to_lowercase();
    if title == needle {
        return Some(0);
    }
    if title.starts_with(needle) {
        return Some(1);
    }
    if title.contains(needle) {
        return Some(2);
    }
    if folder == needle.trim_end_matches('/') || folder.starts_with(needle) {
        return Some(3);
    }
    if needle.ends_with('/') {
        return None;
    }
    for part in folder.split('/').filter(|p| !p.is_empty()) {
        if part == needle {
            return Some(4);
        }
        if part.starts_with(needle) {
            return Some(5);
        }
        if part.contains(needle) {
            return Some(6);
        }
    }
    None
}

pub fn search_titles(vault: &Path, query: &str) -> Result<Vec<NoteMeta>, AppError> {
    let q = query.trim();
    if q.is_empty() {
        return Err(AppError::BadRequest("query is empty".into()));
    }
    if q.len() > 200 {
        return Err(AppError::BadRequest("query is too long".into()));
    }
    let needle = q.to_lowercase();
    let folder_prefix = needle.ends_with('/');
    let mut hits: Vec<_> = list_notes_internal(vault)?
        .into_iter()
        .filter_map(|note| {
            if folder_prefix {
                let prefix = needle.trim_end_matches('/');
                let folder = note.folder.to_lowercase();
                if folder == prefix || folder.starts_with(&format!("{prefix}/")) {
                    return Some((3, note));
                }
                return None;
            }
            title_search_rank(&note.title, &note.folder, &needle).map(|rank| (rank, note))
        })
        .collect();
    hits.sort_by(|(left_rank, left), (right_rank, right)| {
        left_rank
            .cmp(right_rank)
            .then_with(|| right.modified_at.cmp(&left.modified_at))
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(hits.into_iter().take(10).map(|(_, note)| to_meta(&note)).collect())
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

pub fn conflict_id(err: &AppError) -> Option<&str> {
    match err {
        AppError::Conflict(msg) => msg.strip_prefix("title_exists:"),
        _ => None,
    }
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
    fn slugs_and_titles() {
        assert_eq!(slugify("Q: what next?"), "q-what-next");
        assert_eq!(slugify("***"), "untitled");
        assert_eq!(normalize_title("  Plan  ").unwrap(), "Plan");
        assert!(normalize_title("").is_err());
    }

    #[test]
    fn crud_unique_title_and_daily() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note = create_note(vault, "One", "ideas", Some("hi")).unwrap();
        assert_eq!(note.title, "One");
        assert_eq!(note.folder, "ideas");
        assert!(!note.id.is_empty());
        let loaded = get_note(vault, &note.id).unwrap();
        assert_eq!(loaded.content, "hi");
        assert!(get_note(vault, "missing").is_err());
        assert!(normalize_note_id("../x").is_err());
        assert!(normalize_note_id("").is_err());
        let conflict = create_note(vault, "one", "", None).unwrap_err();
        assert!(conflict_id(&conflict).is_some());
        let daily = get_or_create_daily(vault, "2026-08-22").unwrap();
        assert!(daily.content.contains("2026-08-22"));
        let again = get_or_create_daily(vault, "2026-08-22").unwrap();
        assert_eq!(again.id, daily.id);
        assert_eq!(list_notes(vault).unwrap().len(), 2);
    }

    #[test]
    fn wiki_backlinks_and_search() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let alpha = create_note(vault, "alpha", "", Some("see [[beta|B]] and [[missing]]")).unwrap();
        let beta = create_note(vault, "beta", "", Some("root")).unwrap();
        assert_eq!(extract_wiki_targets("see [[beta|B]]"), vec!["beta"]);
        let links = backlinks(vault, &beta.id).unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].id, alpha.id);
        let hits = search(vault, "root").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, beta.id);
        assert!(search(vault, "   ").is_err());
        assert!(search(vault, &"q".repeat(201)).is_err());
        assert!(extract_wiki_targets("[[../x]]").is_empty());
        assert!(normalize_note_path(&"a".repeat(201)).is_err());
    }

    #[test]
    fn title_search_ranks_title_then_folder() {
        assert_eq!(title_search_rank("mybox", "", "mybo"), Some(1));
        assert_eq!(title_search_rank("file1", "mybox", "mybo"), Some(3));
        assert_eq!(
            title_search_rank("file2", "archived/mybox2020", "mybo"),
            Some(5)
        );
        assert_eq!(title_search_rank("file", "other", "mybo"), None);

        let dir = tempdir().unwrap();
        let vault = dir.path();
        create_note(vault, "file2", "archived/mybox2020", Some("inner")).unwrap();
        create_note(vault, "file1", "mybox", Some("prefix")).unwrap();
        create_note(vault, "mybox-note", "", Some("name")).unwrap();
        let hits = search_titles(vault, "mybo").unwrap();
        assert_eq!(
            hits.iter().map(|n| n.title.as_str()).collect::<Vec<_>>(),
            ["mybox-note", "file1", "file2"]
        );
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
