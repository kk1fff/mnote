use crate::error::AppError;
use chrono::NaiveDate;
use regex::Regex;
use serde::{Deserialize, Serialize};
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parked_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Asset {
    pub id: String,
    pub url: String,
    pub markdown: String,
    pub path: String,
    pub filename: String,
    pub original_name: String,
    pub mime: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub group: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetManifest {
    pub version: u8,
    pub id: String,
    pub filename: String,
    pub original_name: String,
    pub mime: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub created_at: String,
    #[serde(default)]
    pub group: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HistoryEntry {
    pub rev: String,
    pub created_at: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HistoryRev {
    pub rev: String,
    pub created_at: String,
    pub bytes: u64,
    pub title: String,
    pub folder: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub content: String,
}

const ALLOWED_IMAGE_TYPES: &[(&str, &str)] = &[
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/jpg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
];

pub const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ASSET_PIXELS: u64 = 40_000_000;

pub fn ensure_vault(vault: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(vault.join("notes"))?;
    std::fs::create_dir_all(vault.join("assets"))?;
    std::fs::create_dir_all(vault.join("parked"))?;
    std::fs::create_dir_all(vault.join("context"))?;
    migrate_legacy_assets(vault)?;
    Ok(())
}

fn migrate_legacy_assets(vault: &Path) -> Result<(), AppError> {
    let root = vault.join("assets");
    for entry in std::fs::read_dir(&root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(filename) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string();
        if ext_for_content_type(&mime).is_err() {
            continue;
        }
        let bytes = std::fs::read(&path)?;
        let (width, height) = image_dimensions(&bytes).unwrap_or((0, 0));
        let dir = root.join("legacy").join(filename);
        std::fs::create_dir_all(&dir)?;
        std::fs::rename(&path, dir.join(filename))?;
        let manifest = AssetManifest {
            version: 1,
            id: filename.to_string(),
            filename: filename.to_string(),
            original_name: filename.to_string(),
            mime,
            bytes: bytes.len() as u64,
            width,
            height,
            created_at: chrono::Utc::now().to_rfc3339(),
            group: "legacy".into(),
        };
        let json =
            serde_json::to_vec_pretty(&manifest).map_err(|e| AppError::Internal(e.into()))?;
        std::fs::write(dir.join("asset.json"), json)?;
    }
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

fn title_first_char_ok(title: &str) -> bool {
    title
        .chars()
        .next()
        .is_some_and(|c| c.is_alphabetic() || c.is_ascii_digit() || matches!(c, '[' | '{' | '('))
}

pub fn normalize_title(raw: &str) -> Result<String, AppError> {
    let title = raw.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("title is empty".into()));
    }
    if title.len() > 200 {
        return Err(AppError::BadRequest("title is too long".into()));
    }
    if title.contains('\n') || title.contains('\r') || title.contains('\0') || title.contains('/') {
        return Err(AppError::BadRequest("invalid title".into()));
    }
    if !title_first_char_ok(title) {
        return Err(AppError::BadRequest(
            "title must start with a letter, digit, or [, {, (".into(),
        ));
    }
    Ok(title.to_string())
}

pub fn parked_note_title(body: &str) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if normalize_title(line).is_ok() {
        line.to_string()
    } else {
        format!("Quick note {}", chrono::Utc::now().format("%Y-%m-%d %H:%M"))
    }
}

pub fn parked_note_body(
    body: &str,
    source_title: Option<&str>,
    source_folder: Option<&str>,
    excerpt: Option<&str>,
) -> String {
    let mut out = body.trim().to_string();
    let Some(title) = source_title.filter(|title| !title.is_empty()) else {
        return out;
    };
    let path = wiki_path(source_folder.unwrap_or(""), title);
    out.push_str("\n\nCaptured while in [[");
    out.push_str(&path);
    out.push_str("]]:");
    if let Some(excerpt) = excerpt.filter(|excerpt| !excerpt.is_empty()) {
        out.push('\n');
        for line in excerpt.lines() {
            out.push_str("> ");
            out.push_str(line);
            out.push('\n');
        }
    }
    out
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

pub fn wiki_path(folder: &str, title: &str) -> String {
    if folder.is_empty() {
        title.to_string()
    } else {
        format!("{folder}/{title}")
    }
}

fn path_key(folder: &str, title: &str) -> String {
    title_key(&wiki_path(folder, title))
}

pub fn parse_wiki_path(target: &str) -> Option<(String, String)> {
    let target = target.trim().trim_matches('/');
    if target.is_empty() || target.contains("..") {
        return None;
    }
    match target.rsplit_once('/') {
        Some((folder, title)) => {
            let folder = folder.trim_matches('/');
            let title = title.trim();
            if folder.is_empty() || title.is_empty() {
                None
            } else {
                Some((folder.to_string(), title.to_string()))
            }
        }
        None => Some((String::new(), target.to_string())),
    }
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

pub(crate) fn parse_frontmatter(raw: &str) -> (HashMap<String, String>, String) {
    let Some(rest) = raw
        .strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"))
    else {
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
    if !note.tags.is_empty() {
        out.push_str(&format!("tags: {}\n", crate::tags::format_tags(&note.tags)));
    }
    out.push_str("---\n\n");
    out.push_str(&note.content);
    out
}

const CONFLICT_MARK: &str = "<<<<<<< this device";

fn history_dir(vault: &Path, id: &str) -> PathBuf {
    vault.join("history").join(id)
}

pub fn migrate_last_edit_files(
    state: &crate::AppState,
    username: &str,
    vault: &Path,
) -> Result<(), AppError> {
    let Some(user_id) = crate::index::user_id_by_name(state, username)? else {
        return Ok(());
    };
    let root = vault.join("history");
    if !root.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&root)? {
        let dir = entry?.path();
        if !dir.is_dir() {
            continue;
        }
        let file = dir.join("last_edit");
        if !file.is_file() {
            continue;
        }
        if let Some(note_id) = dir.file_name().and_then(|s| s.to_str()) {
            if let Ok(raw) = std::fs::read_to_string(&file) {
                let _ = crate::index::set_last_edit(state, user_id, note_id, raw.trim());
            }
        }
        let _ = std::fs::remove_file(file);
    }
    Ok(())
}

fn find_existing(vault: &Path, id: &str) -> Result<Option<Note>, AppError> {
    let root = vault.join("notes");
    if !root.exists() {
        return Ok(None);
    }
    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Ok(note) = load_note_file(vault, path) {
            if note.id == id {
                return Ok(Some(note));
            }
        }
    }
    Ok(None)
}

fn latest_snapshot(vault: &Path, id: &str) -> Result<Option<HistoryRev>, AppError> {
    Ok(list_history_files(vault, id)?.into_iter().next())
}

fn allocate_snapshot_name(dir: &Path) -> String {
    let stem = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let first = format!("{stem}.md");
    if !dir.join(&first).exists() {
        return first;
    }
    for n in 2..1000 {
        let name = format!("{stem}-{n}.md");
        if !dir.join(&name).exists() {
            return name;
        }
    }
    format!("{stem}-{}.md", uuid::Uuid::new_v4())
}

fn created_at_from_rev(rev: &str) -> Option<String> {
    let core = rev
        .strip_suffix(|c: char| c.is_ascii_digit())
        .and_then(|s| s.strip_suffix('-'))
        .filter(|s| s.ends_with('Z'))
        .unwrap_or(rev);
    if core.len() >= 20 && core.as_bytes()[10] == b'T' && core.as_bytes()[19] == b'Z' {
        let date = &core[..10];
        let hour = &core[11..13];
        let min = &core[14..16];
        let sec = &core[17..19];
        return Some(format!("{date}T{hour}:{min}:{sec}Z"));
    }
    None
}

fn parse_snapshot(file: &Path) -> Result<HistoryRev, AppError> {
    let rev = file
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or(AppError::NotFound)?
        .to_string();
    let raw = std::fs::read_to_string(file)?;
    let (fields, body) = parse_frontmatter(&raw);
    let meta = std::fs::metadata(file)?;
    let created_at = created_at_from_rev(&rev).unwrap_or(file_modified(file)?);
    Ok(HistoryRev {
        rev,
        created_at,
        bytes: meta.len(),
        title: fields.get("title").cloned().unwrap_or_default(),
        folder: fields.get("folder").cloned().unwrap_or_default(),
        tags: fields
            .get("tags")
            .map(|raw| crate::tags::parse_tags_field(raw))
            .unwrap_or_default(),
        content: body,
    })
}

fn list_history_files(vault: &Path, id: &str) -> Result<Vec<HistoryRev>, AppError> {
    let dir = history_dir(vault, id);
    let mut items = Vec::new();
    if !dir.is_dir() {
        return Ok(items);
    }
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Ok(item) = parse_snapshot(&path) {
            items.push(item);
        }
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.rev.cmp(&a.rev)));
    Ok(items)
}

fn snapshot_note(vault: &Path, note: &Note) -> Result<(), AppError> {
    let dir = history_dir(vault, &note.id);
    std::fs::create_dir_all(&dir)?;
    let name = allocate_snapshot_name(&dir);
    std::fs::write(dir.join(name), render_file(note))?;
    Ok(())
}

fn maybe_snapshot(
    vault: &Path,
    id: &str,
    force: bool,
    session_ended: bool,
) -> Result<(), AppError> {
    let Some(disk) = find_existing(vault, id)? else {
        return Ok(());
    };
    if let Some(latest) = latest_snapshot(vault, id)? {
        if latest.content == disk.content
            && latest.title == disk.title
            && latest.folder == disk.folder
            && latest.tags == disk.tags
        {
            return Ok(());
        }
    }
    if !force && !session_ended {
        return Ok(());
    }
    snapshot_note(vault, &disk)
}

fn write_note(vault: &Path, note: &Note, session_ended: bool) -> Result<(), AppError> {
    ensure_vault(vault)?;
    let force = note.content.contains(CONFLICT_MARK);
    maybe_snapshot(vault, &note.id, force, session_ended)?;
    write_note_file(vault, note)?;
    Ok(())
}

fn write_note_file(vault: &Path, note: &Note) -> Result<(), AppError> {
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

fn load_note_file(vault: &Path, file: &Path) -> Result<Note, AppError> {
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
    let tags = crate::tags::extract_hashtags(&body);
    Ok(Note {
        id,
        title,
        folder,
        tags,
        content: body,
        modified_at: file_modified(file)?,
        file_path,
    })
}

fn note_from_file(vault: &Path, file: &Path) -> Result<Note, AppError> {
    let raw = std::fs::read_to_string(file)?;
    let (fields, _) = parse_frontmatter(&raw);
    let note = load_note_file(vault, file)?;
    if fields.get("id").map(|s| s.trim()).unwrap_or("").is_empty() {
        write_note(vault, &note, false)?;
    }
    Ok(note)
}

pub(crate) fn list_notes_internal(vault: &Path) -> Result<Vec<Note>, AppError> {
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
        tags: note.tags.clone(),
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

pub fn find_by_path(vault: &Path, folder: &str, title: &str) -> Result<Option<Note>, AppError> {
    let key = path_key(folder, title);
    Ok(list_notes_internal(vault)?
        .into_iter()
        .find(|note| path_key(&note.folder, &note.title) == key))
}

pub fn create_note(
    vault: &Path,
    title: &str,
    folder: &str,
    content: Option<&str>,
) -> Result<Note, AppError> {
    let title = normalize_title(title)?;
    let folder = normalize_folder(folder)?;
    if let Some(existing) = find_by_path(vault, &folder, &title)? {
        return Err(AppError::Conflict(format!("title_exists:{}", existing.id)));
    }
    let file_path = allocate_file_path(vault, &folder, &title, None);
    let content = content.unwrap_or("").to_string();
    let tags = crate::tags::extract_hashtags(&content);
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        content,
        modified_at: String::new(),
        file_path,
        folder,
        tags,
        title,
    };
    write_note(vault, &note, true)?;
    get_note(vault, &note.id)
}

pub fn put_note(vault: &Path, id: &str, content: &str) -> Result<Note, AppError> {
    put_note_session(vault, id, content, false)
}

pub fn put_note_session(
    vault: &Path,
    id: &str,
    content: &str,
    session_ended: bool,
) -> Result<Note, AppError> {
    let mut note = get_note(vault, id)?;
    note.content = content.to_string();
    note.tags = crate::tags::extract_hashtags(content);
    write_note(vault, &note, session_ended)?;
    get_note(vault, id)
}

fn prune_empty_note_dirs(vault: &Path, file_path: &str) {
    let notes_root = vault.join("notes");
    let mut dir = match note_file(vault, file_path).parent() {
        Some(parent) => parent.to_path_buf(),
        None => return,
    };
    while dir.starts_with(&notes_root) && dir != notes_root {
        let empty = match std::fs::read_dir(&dir) {
            Ok(mut entries) => entries.next().is_none(),
            Err(_) => break,
        };
        if !empty {
            break;
        }
        if std::fs::remove_dir(&dir).is_err() {
            break;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
}

pub fn delete_note(vault: &Path, id: &str) -> Result<Note, AppError> {
    let note = get_note(vault, id)?;
    let file = note_file(vault, &note.file_path);
    if file.exists() {
        std::fs::remove_file(&file)?;
    }
    prune_empty_note_dirs(vault, &note.file_path);
    let hist = history_dir(vault, &note.id);
    if hist.exists() {
        std::fs::remove_dir_all(hist)?;
    }
    Ok(note)
}

pub fn normalize_rev(raw: &str) -> Result<String, AppError> {
    let rev = raw.trim();
    if rev.is_empty() {
        return Err(AppError::BadRequest("revision is empty".into()));
    }
    if rev.len() > 80
        || rev.contains('/')
        || rev.contains('\\')
        || rev.contains("..")
        || rev.contains('\0')
    {
        return Err(AppError::BadRequest("invalid revision".into()));
    }
    Ok(rev.to_string())
}

pub fn list_history(vault: &Path, id: &str) -> Result<Vec<HistoryEntry>, AppError> {
    get_note(vault, id)?;
    Ok(list_history_files(vault, id)?
        .into_iter()
        .map(|item| HistoryEntry {
            rev: item.rev,
            created_at: item.created_at,
            bytes: item.bytes,
        })
        .collect())
}

pub fn get_history(vault: &Path, id: &str, rev: &str) -> Result<HistoryRev, AppError> {
    get_note(vault, id)?;
    let rev = normalize_rev(rev)?;
    let path = history_dir(vault, id).join(format!("{rev}.md"));
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    parse_snapshot(&path)
}

pub fn restore_note(vault: &Path, id: &str, rev: &str) -> Result<Note, AppError> {
    let snap = get_history(vault, id, rev)?;
    maybe_snapshot(vault, id, true, true)?;
    let mut note = get_note(vault, id)?;
    note.content = snap.content;
    let file = note_file(vault, &note.file_path);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&file, render_file(&note))?;
    get_note(vault, id)
}

pub fn update_meta(
    vault: &Path,
    id: &str,
    title: Option<&str>,
    folder: Option<&str>,
) -> Result<Note, AppError> {
    Ok(update_meta_and_rewrites(vault, id, title, folder, None)?.0)
}

pub fn update_meta_and_rewrites(
    vault: &Path,
    id: &str,
    title: Option<&str>,
    folder: Option<&str>,
    tags: Option<&[String]>,
) -> Result<(Note, Vec<Note>), AppError> {
    let mut note = get_note(vault, id)?;
    let old_title = note.title.clone();
    let old_folder = note.folder.clone();
    let new_title = match title {
        Some(raw) => normalize_title(raw)?,
        None => note.title.clone(),
    };
    let new_folder = match folder {
        Some(raw) => normalize_folder(raw)?,
        None => note.folder.clone(),
    };
    let new_tags = match tags {
        Some(raw) => crate::tags::normalize_tag_list(raw).map_err(AppError::BadRequest)?,
        None => note.tags.clone(),
    };
    if new_title == note.title && new_folder == note.folder && new_tags == note.tags {
        return Ok((note, Vec::new()));
    }
    if path_key(&new_folder, &new_title) != path_key(&old_folder, &old_title) {
        if let Some(existing) = find_by_path(vault, &new_folder, &new_title)? {
            if existing.id != note.id {
                return Err(AppError::Conflict(format!("title_exists:{}", existing.id)));
            }
        }
    }
    let old_file = note.file_path.clone();
    let path_changed = path_key(&new_folder, &new_title) != path_key(&old_folder, &old_title);
    note.title = new_title;
    note.folder = new_folder;
    note.tags = new_tags;
    if path_changed {
        note.file_path = allocate_file_path(vault, &note.folder, &note.title, Some(&note.id));
    }
    write_note(vault, &note, false)?;
    if old_file != note.file_path {
        let old = note_file(vault, &old_file);
        if old.exists() {
            std::fs::remove_file(old)?;
        }
    }
    let rewritten = if path_changed {
        rewrite_wiki_targets(
            vault,
            &path_key(&old_folder, &old_title),
            &wiki_path(&note.folder, &note.title),
        )?
    } else {
        Vec::new()
    };
    Ok((get_note(vault, id)?, rewritten))
}

pub fn get_or_create_daily(vault: &Path, date: &str) -> Result<Note, AppError> {
    let date = parse_daily_date(date)?;
    if let Some(existing) = find_by_path(vault, "", &date)? {
        return Ok(existing);
    }
    create_note(vault, &date, "", None)
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

fn rewrite_wiki_content(content: &str, mut map: impl FnMut(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(content.len());
    let mut last = 0;
    for caps in wiki_re().captures_iter(content) {
        let Some(full) = caps.get(0) else {
            continue;
        };
        out.push_str(&content[last..full.start()]);
        let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let (target_raw, label) = match inner.split_once('|') {
            Some((target, label)) => (target, Some(label)),
            None => (inner, None),
        };
        let target = target_raw.trim();
        if let Some(new_target) = map(target) {
            out.push_str("[[");
            out.push_str(&new_target);
            if let Some(label) = label {
                out.push('|');
                out.push_str(label);
            }
            out.push_str("]]");
        } else {
            out.push_str(full.as_str());
        }
        last = full.end();
    }
    out.push_str(&content[last..]);
    out
}

pub fn rewrite_wiki_targets(
    vault: &Path,
    old_key: &str,
    new_path: &str,
) -> Result<Vec<Note>, AppError> {
    let mut rewritten = Vec::new();
    for mut note in list_notes_internal(vault)? {
        let next = rewrite_wiki_content(&note.content, |target| {
            if title_key(target) == old_key {
                Some(new_path.to_string())
            } else {
                None
            }
        });
        if next == note.content {
            continue;
        }
        note.content = next;
        write_note_file(vault, &note)?;
        rewritten.push(note);
    }
    Ok(rewritten)
}

pub fn migrate_wiki_paths(vault: &Path) -> Result<Vec<Note>, AppError> {
    let notes = list_notes_internal(vault)?;
    let mut by_title: HashMap<String, Vec<&Note>> = HashMap::new();
    for note in &notes {
        by_title
            .entry(title_key(&note.title))
            .or_default()
            .push(note);
    }
    let path_keys: std::collections::HashSet<String> = notes
        .iter()
        .map(|note| path_key(&note.folder, &note.title))
        .collect();
    let mut rewritten = Vec::new();
    for mut note in notes.clone() {
        let next = rewrite_wiki_content(&note.content, |target| {
            let key = title_key(target);
            if path_keys.contains(&key) {
                return None;
            }
            let matches = by_title.get(&key)?;
            if matches.len() != 1 {
                return None;
            }
            let path = wiki_path(&matches[0].folder, &matches[0].title);
            if title_key(&path) == key {
                None
            } else {
                Some(path)
            }
        });
        if next == note.content {
            continue;
        }
        note.content = next;
        write_note_file(vault, &note)?;
        rewritten.push(note);
    }
    Ok(rewritten)
}

pub fn backlinks(vault: &Path, id: &str) -> Result<Vec<NoteMeta>, AppError> {
    let target = get_note(vault, id)?;
    let key = path_key(&target.folder, &target.title);
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
    search_in(vault, query, None)
}

pub fn search_in(
    vault: &Path,
    query: &str,
    note_id: Option<&str>,
) -> Result<Vec<SearchHit>, AppError> {
    let q = query.trim();
    if q.is_empty() {
        return Err(AppError::BadRequest("query is empty".into()));
    }
    if q.len() > 200 {
        return Err(AppError::BadRequest("query is too long".into()));
    }
    if let Some(tq) = crate::tags::parse_structured_tag_query(q) {
        if tq.here && note_id.is_none() {
            return Ok(Vec::new());
        }
        let Some(last) = tq.last_tag() else {
            return Ok(Vec::new());
        };
        let mut chain = tq.chain;
        chain.push(last);
        let scope = if tq.here { note_id } else { None };
        return search_tag_chain(vault, &chain, scope);
    }
    let needle = q.to_lowercase();
    let mut hits = Vec::new();
    for note in list_notes_internal(vault)? {
        let tags = crate::tags::format_tags(&note.tags);
        let hay = format!(
            "{}\n{}\n{}\n{}",
            note.title, note.folder, tags, note.content
        )
        .to_lowercase();
        if let Some(idx) = hay.find(&needle) {
            let prefix = note.title.len() + note.folder.len() + tags.len() + 3;
            let offset = idx.saturating_sub(prefix);
            hits.push(SearchHit {
                id: note.id,
                title: note.title,
                snippet: snippet(&note.content, offset, q.len()),
                kind: None,
                parked_id: None,
                context: None,
                from: None,
                to: None,
                line: None,
            });
        }
    }
    Ok(hits)
}

pub fn tags_in_query(
    vault: &Path,
    query: &str,
    note_id: Option<&str>,
) -> Result<Vec<crate::tags::TagSuggest>, AppError> {
    let q = query.trim();
    let Some(tq) = crate::tags::parse_structured_tag_query(q) else {
        return Ok(Vec::new());
    };
    if tq.here && note_id.is_none() {
        return Ok(Vec::new());
    }
    let notes = if tq.here {
        match get_note(vault, note_id.unwrap_or("")) {
            Ok(note) => vec![note],
            Err(AppError::NotFound) | Err(AppError::BadRequest(_)) => return Ok(Vec::new()),
            Err(err) => return Err(err),
        }
    } else {
        list_notes_internal(vault)?
    };
    let mut counts = HashMap::new();
    for note in &notes {
        crate::tags::count_scoped_tags(&note.content, &tq.chain, &tq.needle, &mut counts);
    }
    let mut out: Vec<crate::tags::TagSuggest> = counts
        .into_iter()
        .map(|(name, count)| crate::tags::TagSuggest {
            name,
            count,
            create: false,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn search_tag_chain(
    vault: &Path,
    chain: &[String],
    note_id: Option<&str>,
) -> Result<Vec<SearchHit>, AppError> {
    let notes = if let Some(id) = note_id {
        match get_note(vault, id) {
            Ok(note) => vec![note],
            Err(AppError::NotFound) | Err(AppError::BadRequest(_)) => return Ok(Vec::new()),
            Err(err) => return Err(err),
        }
    } else {
        list_notes_internal(vault)?
    };
    let last = chain.last().map(|s| s.as_str()).unwrap_or("");
    let mut hits = Vec::new();
    for note in notes {
        for span in crate::tags::search_tag_chain(&note.content, chain) {
            let from = crate::tags::char_index(&note.content, span.start);
            let to = crate::tags::char_index(&note.content, span.end);
            hits.push(SearchHit {
                id: note.id.clone(),
                title: note.title.clone(),
                snippet: snippet(&note.content, from, last.len() + 1),
                kind: None,
                parked_id: None,
                context: None,
                from: Some(from),
                to: Some(to),
                line: Some(crate::tags::line_at(&note.content, span.start)),
            });
        }
    }
    Ok(hits)
}

fn split_folder_title_query(q: &str) -> Option<(&str, &str)> {
    if q.ends_with('/') {
        return None;
    }
    let (folder, title) = q.rsplit_once('/')?;
    let folder = folder.trim_matches('/');
    let title = title.trim();
    if folder.is_empty() || title.is_empty() {
        None
    } else {
        Some((folder, title))
    }
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
    let in_folder = split_folder_title_query(&needle);
    let folder_prefix = needle.ends_with('/');
    let mut hits: Vec<_> = list_notes_internal(vault)?
        .into_iter()
        .filter_map(|note| {
            if let Some((folder, title)) = in_folder {
                let note_folder = note.folder.to_lowercase();
                if note_folder == folder || note_folder.starts_with(&format!("{folder}/")) {
                    return title_search_rank(&note.title, "", title).map(|rank| (rank, note));
                }
                return None;
            }
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
    Ok(hits
        .into_iter()
        .take(10)
        .map(|(_, note)| to_meta(&note))
        .collect())
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

pub fn normalize_asset_group(raw: &str) -> Result<String, AppError> {
    let group = raw.trim().trim_matches('/');
    if group.is_empty() {
        return Ok(String::new());
    }
    if group.len() > 200 || group.contains('\\') || group.contains('\0') {
        return Err(AppError::BadRequest("invalid asset group".into()));
    }
    let mut parts = Vec::new();
    for part in group.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." || part == ".." || part.starts_with('.') {
            return Err(AppError::BadRequest("invalid asset group".into()));
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 3 && bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        Some("image/gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32), AppError> {
    let size = imagesize::blob_size(bytes)
        .map_err(|_| AppError::BadRequest("invalid image data".into()))?;
    Ok((size.width as u32, size.height as u32))
}

fn safe_filename(name: &str, ext: &str) -> String {
    let name = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let stem = name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name);
    let stem: String = stem
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | ' '))
        .take(100)
        .collect();
    let stem = stem.trim();
    format!("{}.{}", if stem.is_empty() { "image" } else { stem }, ext)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AssetMapFile {
    version: u8,
    assets: HashMap<String, AssetMapEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AssetMapEntry {
    path: String,
    filename: String,
    original_name: String,
    mime: String,
    bytes: u64,
    width: u32,
    height: u32,
    created_at: String,
    #[serde(default)]
    group: String,
}

fn asset_map_path(vault: &Path) -> PathBuf {
    vault.join("assets").join("map.json")
}

fn vault_asset_path(group: &str, id: &str, filename: &str) -> String {
    if group.is_empty() {
        format!("assets/{id}/{filename}")
    } else {
        format!("assets/{group}/{id}/{filename}")
    }
}

fn relative_asset_markdown(folder: &str, vault_path: &str) -> String {
    let depth = folder.split('/').filter(|s| !s.is_empty()).count() + 1;
    format!("![]({}{vault_path})", "../".repeat(depth))
}

fn asset_from_entry(id: &str, entry: &AssetMapEntry) -> Asset {
    Asset {
        markdown: relative_asset_markdown("", &entry.path),
        url: format!("/api/assets/{id}"),
        path: entry.path.clone(),
        id: id.to_string(),
        filename: entry.filename.clone(),
        original_name: entry.original_name.clone(),
        mime: entry.mime.clone(),
        bytes: entry.bytes,
        width: entry.width,
        height: entry.height,
        group: entry.group.clone(),
        created_at: entry.created_at.clone(),
    }
}

fn load_asset_map(vault: &Path) -> Result<AssetMapFile, AppError> {
    let path = asset_map_path(vault);
    if !path.is_file() {
        return Ok(AssetMapFile {
            version: 1,
            assets: HashMap::new(),
        });
    }
    let text = std::fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(|_| AppError::BadRequest("invalid asset map".into()))
}

fn save_asset_map(vault: &Path, map: &AssetMapFile) -> Result<(), AppError> {
    ensure_vault(vault)?;
    let json = serde_json::to_vec_pretty(map).map_err(|e| AppError::Internal(e.into()))?;
    std::fs::write(asset_map_path(vault), json)?;
    Ok(())
}

fn rebuild_asset_map(vault: &Path) -> Result<AssetMapFile, AppError> {
    let mut map = AssetMapFile {
        version: 1,
        assets: HashMap::new(),
    };
    let root = vault.join("assets");
    if root.is_dir() {
        for entry in WalkDir::new(&root).into_iter().filter_map(Result::ok) {
            if entry.file_name() != "asset.json" {
                continue;
            }
            let Ok(manifest) = read_manifest(entry.path()) else {
                continue;
            };
            let rel = vault_asset_path(&manifest.group, &manifest.id, &manifest.filename);
            map.assets.insert(
                manifest.id.clone(),
                AssetMapEntry {
                    path: rel,
                    filename: manifest.filename,
                    original_name: manifest.original_name,
                    mime: manifest.mime,
                    bytes: manifest.bytes,
                    width: manifest.width,
                    height: manifest.height,
                    created_at: manifest.created_at,
                    group: manifest.group,
                },
            );
        }
    }
    save_asset_map(vault, &map)?;
    Ok(map)
}

fn asset_map(vault: &Path) -> Result<AssetMapFile, AppError> {
    let path = asset_map_path(vault);
    if path.is_file() {
        load_asset_map(vault)
    } else {
        rebuild_asset_map(vault)
    }
}

fn read_manifest(path: &Path) -> Result<AssetManifest, AppError> {
    let text = std::fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(|_| AppError::BadRequest("invalid asset manifest".into()))
}

pub fn migrate_assets_map(vault: &Path) -> Result<(), AppError> {
    ensure_vault(vault)?;
    if asset_map_path(vault).is_file() {
        return Ok(());
    }
    let _ = rebuild_asset_map(vault)?;
    Ok(())
}

pub fn asset_embed(id: &str) -> String {
    format!("mnote-asset:{id}")
}

pub fn save_asset(vault: &Path, content_type: &str, bytes: &[u8]) -> Result<Asset, AppError> {
    save_asset_in_group(vault, content_type, bytes, "image", "")
}

pub fn save_asset_in_group(
    vault: &Path,
    content_type: &str,
    bytes: &[u8],
    original_name: &str,
    group: &str,
) -> Result<Asset, AppError> {
    if bytes.is_empty() {
        return Err(AppError::BadRequest("empty file".into()));
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(AppError::BadRequest("file too large".into()));
    }
    let mime =
        sniff_image_mime(bytes).ok_or_else(|| AppError::BadRequest("invalid image data".into()))?;
    if ext_for_content_type(content_type).is_err() && ext_for_content_type(mime).is_err() {
        return Err(AppError::BadRequest("unsupported image type".into()));
    }
    let ext = ext_for_content_type(mime)?;
    let (width, height) = image_dimensions(bytes)?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_ASSET_PIXELS {
        return Err(AppError::BadRequest(
            "image dimensions are too large".into(),
        ));
    }
    let group = normalize_asset_group(group)?;
    let group = if group.is_empty() {
        "image".to_string()
    } else {
        group
    };
    ensure_vault(vault)?;
    let id = uuid::Uuid::new_v4().to_string();
    let dir = vault.join("assets").join(&group).join(&id);
    std::fs::create_dir_all(&dir)?;
    let filename = safe_filename(original_name, ext);
    std::fs::write(dir.join(&filename), bytes)?;
    let path = vault_asset_path(&group, &id, &filename);
    let entry = AssetMapEntry {
        path: path.clone(),
        filename,
        original_name: original_name.to_string(),
        mime: mime.to_string(),
        bytes: bytes.len() as u64,
        width,
        height,
        created_at: chrono::Utc::now().to_rfc3339(),
        group,
    };
    let mut map = asset_map(vault)?;
    map.version = 1;
    map.assets.insert(id.clone(), entry.clone());
    save_asset_map(vault, &map)?;
    Ok(asset_from_entry(&id, &entry))
}

fn valid_asset_id(id: &str) -> Result<(), AppError> {
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.starts_with('.')
    {
        return Err(AppError::BadRequest("invalid asset id".into()));
    }
    Ok(())
}

fn confined_file(vault: &Path, path: &Path) -> Result<PathBuf, AppError> {
    let vault = vault.canonicalize()?;
    if !path.exists() {
        return Err(AppError::NotFound);
    }
    let path = path.canonicalize()?;
    if path.is_file() && path.starts_with(&vault) {
        Ok(path)
    } else {
        Err(AppError::NotFound)
    }
}

pub fn read_asset(vault: &Path, id: &str) -> Result<(Vec<u8>, String), AppError> {
    valid_asset_id(id)?;
    if let Some(entry) = asset_map(vault)?.assets.get(id).cloned() {
        let path = confined_file(vault, &vault.join(&entry.path))?;
        return Ok((std::fs::read(path)?, entry.mime));
    }
    let root = vault.join("assets");
    for entry in WalkDir::new(&root).into_iter().filter_map(Result::ok) {
        if entry.file_name() == "asset.json"
            && entry
                .path()
                .parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy() == id)
                .unwrap_or(false)
        {
            let manifest = read_manifest(entry.path())?;
            let path = confined_file(
                vault,
                &entry.path().parent().unwrap().join(&manifest.filename),
            )?;
            return Ok((std::fs::read(path)?, manifest.mime));
        }
    }
    let path = confined_file(vault, &vault.join("assets").join(id))?;
    let bytes = std::fs::read(&path)?;
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    Ok((bytes, mime))
}

pub fn list_assets(vault: &Path) -> Result<Vec<Asset>, AppError> {
    ensure_vault(vault)?;
    let map = asset_map(vault)?;
    let mut assets: Vec<Asset> = map
        .assets
        .iter()
        .map(|(id, entry)| asset_from_entry(id, entry))
        .collect();
    assets.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(assets)
}

pub fn get_asset_meta(vault: &Path, id: &str) -> Result<Asset, AppError> {
    valid_asset_id(id)?;
    let map = asset_map(vault)?;
    let entry = map.assets.get(id).ok_or(AppError::NotFound)?;
    Ok(asset_from_entry(id, entry))
}

pub fn asset_backlinks(vault: &Path, id: &str) -> Result<Vec<NoteMeta>, AppError> {
    let embed = asset_embed(id);
    let path_needle = format!("/{id}/");
    let mut links = Vec::new();
    for meta in list_notes(vault)? {
        let content = get_note(vault, &meta.id)?.content;
        if content.contains(&embed) || content.contains(&path_needle) {
            links.push(meta);
        }
    }
    Ok(links)
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
        assert_eq!(normalize_title("[draft]").unwrap(), "[draft]");
        assert_eq!(normalize_title("{x}").unwrap(), "{x}");
        assert_eq!(normalize_title("(note)").unwrap(), "(note)");
        assert_eq!(normalize_title("Été").unwrap(), "Été");
        assert!(normalize_title("").is_err());
        assert!(normalize_title("***").is_err());
        assert!(normalize_title("-dash").is_err());
        assert!(normalize_title("ideas/one").is_err());
        assert_eq!(wiki_path("ideas", "One"), "ideas/One");
        assert_eq!(wiki_path("", "One"), "One");
        assert_eq!(
            parse_wiki_path("ideas/One"),
            Some(("ideas".into(), "One".into()))
        );
        assert_eq!(parse_wiki_path("One"), Some(("".into(), "One".into())));
        assert!(parse_wiki_path("../x").is_none());
        assert_eq!(parked_note_title("ask jim\nmore"), "ask jim");
        assert!(parked_note_title("***").starts_with("Quick note "));
        assert_eq!(
            parked_note_body("ask jim", Some("Weekly"), None, Some("retry")),
            "ask jim\n\nCaptured while in [[Weekly]]:\n> retry\n"
        );
        assert_eq!(
            parked_note_body("ask jim", Some("Weekly"), Some("ideas"), Some("retry")),
            "ask jim\n\nCaptured while in [[ideas/Weekly]]:\n> retry\n"
        );
        assert_eq!(
            parked_note_body("ask jim", None, Some("ideas"), Some("retry")),
            "ask jim"
        );
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
        let root = create_note(vault, "one", "", None).unwrap();
        assert_eq!(root.folder, "");
        let conflict = create_note(vault, "one", "ideas", None).unwrap_err();
        assert!(conflict_id(&conflict).is_some());
        let daily = get_or_create_daily(vault, "2026-08-22").unwrap();
        assert_eq!(daily.title, "2026-08-22");
        assert_eq!(daily.content, "");
        let again = get_or_create_daily(vault, "2026-08-22").unwrap();
        assert_eq!(again.id, daily.id);
        create_note(vault, "2026-08-22", "ideas", Some("other day")).unwrap();
        let still = get_or_create_daily(vault, "2026-08-22").unwrap();
        assert_eq!(still.id, daily.id);
        assert_eq!(list_notes(vault).unwrap().len(), 4);

        let renamed = update_meta(vault, &note.id, Some("Two"), None).unwrap();
        assert_eq!(renamed.title, "Two");
        assert_eq!(renamed.folder, "ideas");
        assert_eq!(renamed.content, "hi");
        assert!(get_note(vault, &note.id).is_ok());
        let moved = update_meta(vault, &note.id, None, Some("work")).unwrap();
        assert_eq!(moved.folder, "work");
        assert_eq!(moved.title, "Two");
        create_note(vault, "Two", "", None).unwrap();
        let conflict = update_meta(vault, &root.id, Some("two"), None).unwrap_err();
        assert!(conflict_id(&conflict).is_some());
        assert!(update_meta(vault, &note.id, Some("***"), None).is_err());
        let same = update_meta(vault, &note.id, Some("Two"), Some("work")).unwrap();
        assert_eq!(same.id, note.id);
    }

    #[test]
    fn delete_removes_file_history_and_empty_folders() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note = create_note(vault, "One", "ideas/nested", Some("hi")).unwrap();
        let linker = create_note(vault, "Index", "", Some("see [[ideas/nested/One]]")).unwrap();
        put_note_session(vault, &note.id, "v2", true).unwrap();
        assert!(!list_history(vault, &note.id).unwrap().is_empty());

        delete_note(vault, &note.id).unwrap();
        assert!(get_note(vault, &note.id).is_err());
        assert!(!vault.join("notes/ideas").exists());
        assert!(!history_dir(vault, &note.id).exists());
        assert!(delete_note(vault, &note.id).is_err());
        let kept = get_note(vault, &linker.id).unwrap();
        assert!(kept.content.contains("[[ideas/nested/One]]"));
    }

    #[test]
    fn wiki_backlinks_and_search() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let alpha =
            create_note(vault, "alpha", "", Some("see [[beta|B]] and [[missing]]")).unwrap();
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

        let nested = create_note(vault, "gamma", "ideas", Some("g")).unwrap();
        let linker = create_note(vault, "delta", "", Some("see [[ideas/gamma]]")).unwrap();
        let nested_links = backlinks(vault, &nested.id).unwrap();
        assert_eq!(nested_links.len(), 1);
        assert_eq!(nested_links[0].id, linker.id);
    }

    #[test]
    fn migrate_and_rename_rewrites_paths() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let one = create_note(vault, "One", "ideas", Some("body")).unwrap();
        let src = create_note(
            vault,
            "Src",
            "",
            Some("see [[One|label]] and [[ideas/One]] and [[Other]]"),
        )
        .unwrap();
        put_note_session(vault, &src.id, &src.content, true).unwrap();
        let hist_before = list_history(vault, &src.id).unwrap();
        assert_eq!(hist_before.len(), 1);

        let migrated = migrate_wiki_paths(vault).unwrap();
        assert_eq!(migrated.len(), 1);
        let src = get_note(vault, &src.id).unwrap();
        assert_eq!(
            src.content,
            "see [[ideas/One|label]] and [[ideas/One]] and [[Other]]"
        );
        assert_eq!(
            get_history(vault, &src.id, &hist_before[0].rev)
                .unwrap()
                .content,
            "see [[One|label]] and [[ideas/One]] and [[Other]]"
        );

        update_meta(vault, &one.id, Some("Two"), Some("work")).unwrap();
        let src = get_note(vault, &src.id).unwrap();
        assert_eq!(
            src.content,
            "see [[work/Two|label]] and [[work/Two]] and [[Other]]"
        );
        assert_eq!(
            get_history(vault, &src.id, &hist_before[0].rev)
                .unwrap()
                .content,
            "see [[One|label]] and [[ideas/One]] and [[Other]]"
        );
        assert!(migrate_wiki_paths(vault).unwrap().is_empty());
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
    fn title_search_folder_slash_matches_title_in_folder() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        create_note(vault, "Alpha", "ideas", Some("a")).unwrap();
        create_note(vault, "Alpine", "other", Some("b")).unwrap();
        create_note(vault, "Beta", "ideas", Some("c")).unwrap();
        let hits = search_titles(vault, "ideas/alp").unwrap();
        assert_eq!(
            hits.iter()
                .map(|n| (n.folder.as_str(), n.title.as_str()))
                .collect::<Vec<_>>(),
            [("ideas", "Alpha")]
        );
        let browse = search_titles(vault, "ideas/").unwrap();
        assert_eq!(browse.len(), 2);
    }

    #[test]
    fn assets() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        assert!(ext_for_content_type("image/png").is_ok());
        assert!(ext_for_content_type("text/plain").is_err());
        let png = [
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 252, 207,
            192, 80, 15, 0, 4, 133, 1, 128, 132, 169, 140, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
            96, 130,
        ];
        let asset = save_asset(vault, "image/png", &png).unwrap();
        assert!(!asset.id.contains('.'));
        assert!(vault.join("assets").join("map.json").is_file());
        assert!(asset.markdown.contains("assets/"));
        assert!(asset.path.contains(&asset.id));
        let (bytes, mime) = read_asset(vault, &asset.id).unwrap();
        assert_eq!(bytes, png);
        assert!(mime.contains("png"));
        assert!(read_asset(vault, "../x").is_err());
        let leak = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(leak.path(), b"leak").unwrap();
        let map_path = vault.join("assets").join("map.json");
        let mut map: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&map_path).unwrap()).unwrap();
        map["assets"][&asset.id]["path"] =
            serde_json::Value::String(leak.path().to_string_lossy().into_owned());
        std::fs::write(&map_path, map.to_string()).unwrap();
        assert!(read_asset(vault, &asset.id).is_err());
        assert!(save_asset(vault, "image/png", &[]).is_err());
        assert!(save_asset(vault, "image/png", &vec![0; MAX_ASSET_BYTES + 1]).is_err());
    }

    #[test]
    fn snippet_ellipsis() {
        let s = snippet("abcdefghijklmnopqrstuvwxyz", 10, 2);
        assert!(s.contains('k'));
        assert_eq!(snippet("", 0, 1), "");
    }

    #[test]
    fn history_snapshots_after_idle_session() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note = create_note(vault, "One", "", Some("v0")).unwrap();
        put_note_session(vault, &note.id, "v1", false).unwrap();
        assert!(list_history(vault, &note.id).unwrap().is_empty());

        put_note_session(vault, &note.id, "v2", true).unwrap();
        put_note_session(vault, &note.id, "v2b", false).unwrap();
        let hist = list_history(vault, &note.id).unwrap();
        assert_eq!(hist.len(), 1);
        let snap = get_history(vault, &note.id, &hist[0].rev).unwrap();
        assert_eq!(snap.content, "v1");
        assert_eq!(snap.title, "One");
    }

    #[test]
    fn history_survives_rename_and_restore() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note = create_note(vault, "One", "", Some("v0")).unwrap();
        put_note_session(vault, &note.id, "keep", false).unwrap();
        put_note_session(vault, &note.id, "newer", true).unwrap();
        let hist = list_history(vault, &note.id).unwrap();
        assert_eq!(hist.len(), 1);

        update_meta(vault, &note.id, Some("Two"), Some("work")).unwrap();
        let hist = list_history(vault, &note.id).unwrap();
        assert_eq!(hist.len(), 1);

        let restored = restore_note(vault, &note.id, &hist[0].rev).unwrap();
        assert_eq!(restored.content, "keep");
        assert_eq!(restored.title, "Two");
        let hist = list_history(vault, &note.id).unwrap();
        assert_eq!(hist.len(), 2);
        let current_snap = get_history(vault, &note.id, &hist[0].rev).unwrap();
        assert_eq!(current_snap.content, "newer");
        assert!(normalize_rev("../x").is_err());
        assert!(get_history(vault, &note.id, "missing").is_err());
    }

    #[test]
    fn conflict_write_force_snapshots() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note = create_note(vault, "One", "", Some("clean")).unwrap();
        put_note(vault, &note.id, "session").unwrap();
        put_note(
            vault,
            &note.id,
            "<<<<<<< this device\nleft\n=======\nright\n>>>>>>> other device",
        )
        .unwrap();
        let hist = list_history(vault, &note.id).unwrap();
        assert_eq!(hist.len(), 1);
        assert_eq!(
            get_history(vault, &note.id, &hist[0].rev).unwrap().content,
            "session"
        );
    }

    #[test]
    fn tags_follow_hashtags_and_search_lines() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note = create_note(
            vault,
            "One",
            "ideas",
            Some("see #work today\n\nlater #work again\n"),
        )
        .unwrap();
        assert_eq!(note.tags, vec!["work"]);

        let saved = put_note(vault, &note.id, "see #work and #rust\n").unwrap();
        assert_eq!(saved.tags, vec!["work", "rust"]);

        let hits = search(vault, "#work").unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains("#work"));
        assert_eq!(hits[0].line, Some(1));
        assert_eq!(hits[0].from, Some(4));
        assert_eq!(hits[0].to, Some(9));

        let cleared = put_note(vault, &note.id, "no tags here\n").unwrap();
        assert!(cleared.tags.is_empty());
        assert!(search(vault, "#work").unwrap().is_empty());

        let two = put_note(vault, &note.id, "a #work\nb #work\n").unwrap();
        assert_eq!(two.tags, vec!["work"]);
        let again = search(vault, "#work").unwrap();
        assert_eq!(again.len(), 2);
        assert_eq!(again[0].line, Some(1));
        assert_eq!(again[1].line, Some(2));
    }

    #[test]
    fn structured_tag_search_scopes_lists_and_here() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note = create_note(
            vault,
            "Scoped",
            "",
            Some("- #work\n  - nested #meeting\n- sibling #meeting\n\n## Plan #work\ninside #meeting\n"),
        )
        .unwrap();
        let other = create_note(vault, "Other", "", Some("#work\n#meeting\n")).unwrap();

        let hits = search(vault, "#work > #meeting").unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|hit| hit.id == note.id));
        assert_eq!(hits[0].line, Some(2));
        assert_eq!(hits[1].line, Some(6));

        let here = search_in(vault, "> #meeting", Some(&note.id)).unwrap();
        assert_eq!(here.len(), 3);
        assert!(search_in(vault, "> #meeting", None).unwrap().is_empty());
        assert_eq!(
            search_in(vault, "> #meeting", Some(&other.id))
                .unwrap()
                .len(),
            1
        );

        let names = tags_in_query(vault, "#work >", None).unwrap();
        assert!(names.iter().any(|tag| tag.name == "meeting"));
        assert!(names.iter().all(|tag| tag.name != "work"));

        let page = tags_in_query(vault, ">", Some(&other.id)).unwrap();
        assert_eq!(
            page.iter().map(|tag| tag.name.as_str()).collect::<Vec<_>>(),
            vec!["meeting", "work"]
        );
        assert!(search(vault, "#work >").unwrap().is_empty());
    }
}
