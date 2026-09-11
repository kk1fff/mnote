use crate::error::AppError;
use crate::notes::{self, SearchHit};
use crate::parked;
use crate::AppState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use uuid::Uuid;

const ALIGN_LIMIT: usize = 250_000;
const MAX_EVENTS: usize = 200;
const MAX_PARAS: usize = 10_000;
const PREVIEW_LEN: usize = 160;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub id: String,
    pub ordinal: Option<i64>,
    pub text_norm: String,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AlignOp {
    Keep { old_idx: usize, new_idx: usize },
    Insert { new_idx: usize },
    Delete { old_idx: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherNow {
    pub weather_code: i64,
    pub weather_label: String,
    pub temp_c: f64,
}

#[derive(Debug, Clone, Default)]
pub struct ContextStamp {
    pub surface: Option<String>,
    pub device: Option<String>,
    pub local_time: Option<String>,
    pub timezone: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub accuracy_m: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct IngestEvent {
    pub tmp_id: String,
    pub ordinal: i64,
    pub captured_at: String,
    pub local_time: String,
    pub timezone: String,
    pub surface: String,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default)]
    pub lat: Option<f64>,
    #[serde(default)]
    pub lon: Option<f64>,
    #[serde(default)]
    pub accuracy_m: Option<f64>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IngestBody {
    pub paragraphs: Vec<String>,
    pub events: Vec<IngestEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlockOut {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordinal: Option<i64>,
    pub preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmp_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventOut {
    pub id: String,
    pub block_id: String,
    pub captured_at: String,
    pub local_time: String,
    pub timezone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    pub surface: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weather_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weather_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp_c: Option<f64>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextResponse {
    pub blocks: Vec<BlockOut>,
    pub events: Vec<EventOut>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SearchParams {
    #[serde(default)]
    pub q: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub surface: Option<String>,
    pub weather: Option<String>,
    pub near: Option<String>,
    pub radius_m: Option<f64>,
    pub note_id: Option<String>,
}

impl SearchParams {
    pub fn has_filters(&self) -> bool {
        self.from.is_some()
            || self.to.is_some()
            || self.surface.is_some()
            || self.weather.is_some()
            || self.near.is_some()
    }
}

pub fn normalize_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn split_paragraphs(content: &str) -> Vec<String> {
    if content.is_empty() {
        Vec::new()
    } else {
        content.split('\n').map(str::to_string).collect()
    }
}

pub fn preview_of(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() <= PREVIEW_LEN {
        t.to_string()
    } else {
        t.chars().take(PREVIEW_LEN).collect()
    }
}

pub fn weather_label(code: i64) -> &'static str {
    match code {
        0 => "clear",
        1..=3 => "partly cloudy",
        45 | 48 => "fog",
        51..=57 => "drizzle",
        61..=67 | 80..=82 => "rain",
        71..=77 | 85..=86 => "snow",
        95..=99 => "thunderstorm",
        _ => "unknown",
    }
}

pub fn weather_matches(code: i64, q: &str) -> bool {
    let q = q.trim().to_lowercase();
    match q.as_str() {
        "rain" => matches!(code, 51..=67 | 80..=82),
        "drizzle" => matches!(code, 51..=57),
        "snow" => matches!(code, 71..=77 | 85..=86),
        "fog" => matches!(code, 45 | 48),
        "clear" => code == 0,
        "thunder" | "thunderstorm" => matches!(code, 95..=99),
        "cloud" | "cloudy" | "partly cloudy" => matches!(code, 1..=3),
        _ => weather_label(code).contains(&q),
    }
}

pub fn weather_cell(lat: f64, lon: f64) -> String {
    format!(
        "{:.2},{:.2}",
        (lat * 100.0).round() / 100.0,
        (lon * 100.0).round() / 100.0
    )
}

pub fn format_stamp(local_time: &str, timezone: &str, weather: Option<&WeatherNow>) -> String {
    let tz = timezone.rsplit('/').next().unwrap_or(timezone);
    match weather {
        Some(w) => format!(
            "{local_time} {tz} · {:.0}°C, {}",
            w.temp_c, w.weather_label
        ),
        None => format!("{local_time} {tz}"),
    }
}

fn similar(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    let (short, long) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    if long.starts_with(short) || long.contains(short) {
        return short.len() as f64 / long.len() as f64;
    }
    let n = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
    n as f64 / long.chars().count().max(1) as f64
}

fn lcs_pairs(a: &[String], b: &[String]) -> Vec<(usize, usize)> {
    let n = a.len();
    let m = b.len();
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for (i, ai) in a.iter().enumerate() {
        for (j, bj) in b.iter().enumerate() {
            dp[i + 1][j + 1] = if ai == bj {
                dp[i][j] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let mut pairs = Vec::new();
    let mut i = n;
    let mut j = m;
    while i > 0 && j > 0 {
        if a[i - 1] == b[j - 1] {
            pairs.push((i - 1, j - 1));
            i -= 1;
            j -= 1;
        } else if dp[i - 1][j] >= dp[i][j - 1] {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    pairs.reverse();
    pairs
}

pub fn align(old: &[Block], new_lines: &[String]) -> Vec<AlignOp> {
    let new_norm: Vec<String> = new_lines.iter().map(|s| normalize_line(s)).collect();
    if old.is_empty() {
        return (0..new_lines.len())
            .map(|new_idx| AlignOp::Insert { new_idx })
            .collect();
    }
    if new_lines.is_empty() {
        return (0..old.len())
            .map(|old_idx| AlignOp::Delete { old_idx })
            .collect();
    }
    if old.len().saturating_mul(new_lines.len()) > ALIGN_LIMIT {
        let mut ops: Vec<AlignOp> = (0..old.len())
            .map(|old_idx| AlignOp::Delete { old_idx })
            .collect();
        ops.extend((0..new_lines.len()).map(|new_idx| AlignOp::Insert { new_idx }));
        return ops;
    }
    let old_norm: Vec<String> = old.iter().map(|b| b.text_norm.clone()).collect();
    let pairs = lcs_pairs(&old_norm, &new_norm);
    let mut kept_old = HashSet::new();
    let mut kept_new = HashSet::new();
    let mut ops = Vec::new();
    for (oi, ni) in &pairs {
        kept_old.insert(*oi);
        kept_new.insert(*ni);
        ops.push(AlignOp::Keep {
            old_idx: *oi,
            new_idx: *ni,
        });
    }
    let leftover_old: Vec<usize> = (0..old.len()).filter(|i| !kept_old.contains(i)).collect();
    let leftover_new: Vec<usize> = (0..new_lines.len())
        .filter(|i| !kept_new.contains(i))
        .collect();
    let mut used_new = HashSet::new();
    for oi in leftover_old {
        let mut best: Option<(usize, f64)> = None;
        for &ni in &leftover_new {
            if used_new.contains(&ni) {
                continue;
            }
            let score = similar(&old[oi].text_norm, &new_norm[ni]);
            if score >= 0.5 && best.map(|(_, s)| score > s).unwrap_or(true) {
                best = Some((ni, score));
            }
        }
        if let Some((ni, _)) = best {
            used_new.insert(ni);
            ops.push(AlignOp::Keep {
                old_idx: oi,
                new_idx: ni,
            });
        } else {
            ops.push(AlignOp::Delete { old_idx: oi });
        }
    }
    for ni in leftover_new {
        if !used_new.contains(&ni) {
            ops.push(AlignOp::Insert { new_idx: ni });
        }
    }
    ops.sort_by_key(|op| match op {
        AlignOp::Keep { new_idx, .. } | AlignOp::Insert { new_idx } => (*new_idx, 0),
        AlignOp::Delete { old_idx } => (usize::MAX, *old_idx),
    });
    ops
}

pub fn fetch_open_meteo(lat: f64, lon: f64) -> Option<WeatherNow> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code"
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;
    let v: serde_json::Value = client.get(url).send().ok()?.json().ok()?;
    let code = v.get("current")?.get("weather_code")?.as_i64()?;
    let temp = v.get("current")?.get("temperature_2m")?.as_f64()?;
    Some(WeatherNow {
        weather_code: code,
        weather_label: weather_label(code).to_string(),
        temp_c: temp,
    })
}

fn valid_surface(s: &str) -> bool {
    matches!(s, "editor" | "park" | "quick")
}

fn valid_source(s: &str) -> bool {
    matches!(s, "auto" | "where")
}

fn valid_device(s: &str) -> bool {
    matches!(s, "phone" | "tablet" | "desktop")
}

fn valid_coord(lat: Option<f64>, lon: Option<f64>) -> (Option<f64>, Option<f64>) {
    match (lat, lon) {
        (Some(la), Some(lo)) if (-90.0..=90.0).contains(&la) && (-180.0..=180.0).contains(&lo) => {
            (Some(la), Some(lo))
        }
        _ => (None, None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ContextFile {
    version: u8,
    note_id: String,
    blocks: Vec<BlockRec>,
    events: Vec<EventRec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BlockRec {
    id: String,
    ordinal: Option<i64>,
    text_norm: String,
    preview: String,
    created_at: String,
    updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EventRec {
    id: String,
    block_id: String,
    captured_at: String,
    local_time: String,
    timezone: String,
    surface: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lat: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lon: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    accuracy_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    weather_code: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    weather_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    temp_c: Option<f64>,
    #[serde(default)]
    source: String,
}

pub struct PendingWeather {
    pub note_id: String,
    pub event_id: String,
    pub lat: f64,
    pub lon: f64,
}

fn context_path(vault: &std::path::Path, note_id: &str) -> std::path::PathBuf {
    vault.join("context").join(format!("{note_id}.json"))
}

fn empty_context(note_id: &str) -> ContextFile {
    ContextFile {
        version: 1,
        note_id: note_id.to_string(),
        blocks: Vec::new(),
        events: Vec::new(),
    }
}

fn load_context_file(vault: &std::path::Path, note_id: &str) -> Result<ContextFile, AppError> {
    let path = context_path(vault, note_id);
    if !path.is_file() {
        return Ok(empty_context(note_id));
    }
    let text = std::fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(|_| AppError::BadRequest("invalid context file".into()))
}

fn save_context_file(vault: &std::path::Path, file: &ContextFile) -> Result<(), AppError> {
    let dir = vault.join("context");
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_vec_pretty(file).map_err(|e| AppError::Internal(e.into()))?;
    std::fs::write(context_path(vault, &file.note_id), json)?;
    Ok(())
}

fn live_blocks(file: &ContextFile) -> Vec<Block> {
    let mut blocks: Vec<_> = file
        .blocks
        .iter()
        .filter(|b| b.ordinal.is_some())
        .cloned()
        .collect();
    blocks.sort_by_key(|b| b.ordinal.unwrap_or(0));
    blocks
        .into_iter()
        .map(|b| Block {
            id: b.id,
            ordinal: b.ordinal,
            text_norm: b.text_norm,
            preview: b.preview,
        })
        .collect()
}

fn events_out(file: &ContextFile) -> Vec<EventOut> {
    let mut events = file.events.clone();
    events.sort_by(|a, b| a.captured_at.cmp(&b.captured_at).then(a.id.cmp(&b.id)));
    events
        .into_iter()
        .map(|e| EventOut {
            id: e.id,
            block_id: e.block_id,
            captured_at: e.captured_at,
            local_time: e.local_time,
            timezone: e.timezone,
            device: e.device,
            surface: e.surface,
            lat: e.lat,
            lon: e.lon,
            weather_code: e.weather_code,
            weather_label: e.weather_label,
            temp_c: e.temp_c,
            source: e.source,
        })
        .collect()
}

pub fn get_context(
    vault: &std::path::Path,
    note_id: &str,
) -> Result<ContextResponse, AppError> {
    let file = load_context_file(vault, note_id)?;
    Ok(ContextResponse {
        blocks: live_blocks(&file)
            .into_iter()
            .map(|b| BlockOut {
                id: b.id,
                ordinal: b.ordinal,
                preview: b.preview,
                tmp_id: None,
            })
            .collect(),
        events: events_out(&file),
    })
}

pub fn ingest(
    state: &AppState,
    vault: &std::path::Path,
    note_id: &str,
    body: IngestBody,
) -> Result<(ContextResponse, Vec<PendingWeather>), AppError> {
    if body.paragraphs.len() > MAX_PARAS {
        return Err(AppError::BadRequest("too many paragraphs".into()));
    }
    if body.events.len() > MAX_EVENTS {
        return Err(AppError::BadRequest("too many events".into()));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let mut file = load_context_file(vault, note_id)?;
    let old = live_blocks(&file);
    let ops = align(&old, &body.paragraphs);
    for block in &mut file.blocks {
        if block.ordinal.is_some() {
            block.ordinal = None;
        }
    }
    let mut id_at_new: HashMap<usize, String> = HashMap::new();
    for op in &ops {
        match op {
            AlignOp::Keep { old_idx, new_idx } => {
                let block_id = old[*old_idx].id.clone();
                let preview = preview_of(&body.paragraphs[*new_idx]);
                let text_norm = normalize_line(&body.paragraphs[*new_idx]);
                if let Some(block) = file.blocks.iter_mut().find(|b| b.id == block_id) {
                    block.ordinal = Some(*new_idx as i64);
                    block.text_norm = text_norm;
                    block.preview = preview;
                    block.updated_at = now.clone();
                    block.deleted_at = None;
                }
                id_at_new.insert(*new_idx, block_id);
            }
            AlignOp::Insert { new_idx } => {
                let id = Uuid::new_v4().to_string();
                file.blocks.push(BlockRec {
                    id: id.clone(),
                    ordinal: Some(*new_idx as i64),
                    text_norm: normalize_line(&body.paragraphs[*new_idx]),
                    preview: preview_of(&body.paragraphs[*new_idx]),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    deleted_at: None,
                });
                id_at_new.insert(*new_idx, id);
            }
            AlignOp::Delete { old_idx } => {
                let block_id = old[*old_idx].id.clone();
                if let Some(block) = file.blocks.iter_mut().find(|b| b.id == block_id) {
                    block.ordinal = None;
                    block.deleted_at = Some(now.clone());
                    block.updated_at = now.clone();
                }
            }
        }
    }
    let mut tmp_map: HashMap<String, String> = HashMap::new();
    let mut pending_weather = Vec::new();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    for ev in &body.events {
        if ev.tmp_id.is_empty() || ev.captured_at.is_empty() || ev.local_time.is_empty() {
            continue;
        }
        if ev.timezone.is_empty() || !valid_surface(&ev.surface) {
            continue;
        }
        let source = ev.source.as_deref().unwrap_or("auto");
        if !valid_source(source) {
            continue;
        }
        if ev.device.as_deref().is_some_and(|d| !valid_device(d)) {
            continue;
        }
        let idx = ev.ordinal as usize;
        let Some(block_id) = id_at_new.get(&idx) else {
            continue;
        };
        if body
            .paragraphs
            .get(idx)
            .is_none_or(|p| p.trim().is_empty())
        {
            continue;
        }
        let (lat, lon) = valid_coord(ev.lat, ev.lon);
        let weather = match (lat, lon) {
            (Some(la), Some(lo)) => cached_weather(&conn, la, lo)?,
            _ => None,
        };
        let event_id = Uuid::new_v4().to_string();
        file.events.push(EventRec {
            id: event_id.clone(),
            block_id: block_id.clone(),
            captured_at: ev.captured_at.clone(),
            local_time: ev.local_time.clone(),
            timezone: ev.timezone.clone(),
            surface: ev.surface.clone(),
            device: ev.device.clone(),
            lat,
            lon,
            accuracy_m: ev.accuracy_m,
            weather_code: weather.as_ref().map(|w| w.weather_code),
            weather_label: weather.as_ref().map(|w| w.weather_label.clone()),
            temp_c: weather.as_ref().map(|w| w.temp_c),
            source: source.to_string(),
        });
        tmp_map.insert(ev.tmp_id.clone(), block_id.clone());
        if weather.is_none() {
            if let (Some(lat), Some(lon)) = (lat, lon) {
                pending_weather.push(PendingWeather {
                    note_id: note_id.to_string(),
                    event_id,
                    lat,
                    lon,
                });
            }
        }
    }
    drop(conn);
    save_context_file(vault, &file)?;
    let blocks_out = live_blocks(&file)
        .into_iter()
        .map(|b| {
            let tmp_id = tmp_map
                .iter()
                .find_map(|(tmp, id)| (id == &b.id).then(|| tmp.clone()));
            BlockOut {
                id: b.id,
                ordinal: b.ordinal,
                preview: b.preview,
                tmp_id,
            }
        })
        .collect();
    Ok((
        ContextResponse {
            blocks: blocks_out,
            events: events_out(&file),
        },
        pending_weather,
    ))
}

fn cached_weather(
    conn: &rusqlite::Connection,
    lat: f64,
    lon: f64,
) -> Result<Option<WeatherNow>, AppError> {
    let cell = weather_cell(lat, lon);
    let row = conn
        .query_row(
            "SELECT fetched_at, weather_code, weather_label, temp_c FROM weather_cache WHERE cell = ?1",
            params![cell],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, f64>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((fetched, code, label, temp)) = row else {
        return Ok(None);
    };
    if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&fetched) {
        if chrono::Utc::now().signed_duration_since(ts.with_timezone(&chrono::Utc))
            > chrono::Duration::minutes(30)
        {
            return Ok(None);
        }
    }
    Ok(Some(WeatherNow {
        weather_code: code,
        weather_label: label,
        temp_c: temp,
    }))
}

pub fn put_weather_cache(
    state: &AppState,
    lat: f64,
    lon: f64,
    weather: &WeatherNow,
) -> Result<(), AppError> {
    let cell = weather_cell(lat, lon);
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    conn.execute(
        "INSERT INTO weather_cache (cell, fetched_at, weather_code, weather_label, temp_c)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(cell) DO UPDATE SET
           fetched_at = excluded.fetched_at,
           weather_code = excluded.weather_code,
           weather_label = excluded.weather_label,
           temp_c = excluded.temp_c",
        params![
            cell,
            now,
            weather.weather_code,
            weather.weather_label,
            weather.temp_c
        ],
    )?;
    Ok(())
}

pub fn lookup_weather(state: &AppState, lat: f64, lon: f64) -> Result<Option<WeatherNow>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
    cached_weather(&conn, lat, lon)
}

pub fn apply_weather_to_event(
    vault: &std::path::Path,
    note_id: &str,
    event_id: &str,
    weather: &WeatherNow,
) -> Result<(), AppError> {
    let mut file = load_context_file(vault, note_id)?;
    let Some(event) = file.events.iter_mut().find(|e| e.id == event_id) else {
        return Ok(());
    };
    event.weather_code = Some(weather.weather_code);
    event.weather_label = Some(weather.weather_label.clone());
    event.temp_c = Some(weather.temp_c);
    save_context_file(vault, &file)
}

pub fn apply_weather_to_parked(
    vault: &std::path::Path,
    parked_id: &str,
    weather: &WeatherNow,
) -> Result<(), AppError> {
    parked::apply_weather(vault, parked_id, weather)
}

pub fn delete_note_context(vault: &std::path::Path, note_id: &str) -> Result<(), AppError> {
    let path = context_path(vault, note_id);
    if path.is_file() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6_371_000.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

fn parse_near(near: &str) -> Option<(f64, f64)> {
    let (a, b) = near.split_once(',')?;
    let lat = a.trim().parse().ok()?;
    let lon = b.trim().parse().ok()?;
    valid_coord(Some(lat), Some(lon)).0.zip(valid_coord(Some(lat), Some(lon)).1)
}

struct SitRow {
    note_id: Option<String>,
    parked_id: Option<String>,
    parked_body: Option<String>,
    local_time: String,
    timezone: String,
    weather_label: Option<String>,
    temp_c: Option<f64>,
    weather_code: Option<i64>,
}

fn situation_rows(vault: &std::path::Path, q: &SearchParams) -> Result<Vec<SitRow>, AppError> {
    let near = q.near.as_deref().and_then(parse_near);
    let radius = q.radius_m.unwrap_or(1000.0).clamp(1.0, 50_000.0);
    let mut rows = Vec::new();
    let ctx_dir = vault.join("context");
    if ctx_dir.is_dir() {
        for entry in std::fs::read_dir(&ctx_dir)? {
            let path = entry?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Ok(file) = load_context_file(
                vault,
                path.file_stem().and_then(|s| s.to_str()).unwrap_or(""),
            ) else {
                continue;
            };
            for ev in &file.events {
                if !sit_match(
                    q,
                    &ev.captured_at,
                    &ev.surface,
                    ev.weather_code,
                    ev.lat,
                    ev.lon,
                    near,
                    radius,
                ) {
                    continue;
                }
                rows.push(SitRow {
                    note_id: Some(file.note_id.clone()),
                    parked_id: None,
                    parked_body: None,
                    local_time: ev.local_time.clone(),
                    timezone: ev.timezone.clone(),
                    weather_label: ev.weather_label.clone(),
                    temp_c: ev.temp_c,
                    weather_code: ev.weather_code,
                });
            }
        }
    }
    for item in parked::list_parked(vault)? {
        let surface = item.surface.clone().unwrap_or_default();
        let local = item
            .local_time
            .clone()
            .unwrap_or_else(|| item.created_at.clone());
        let tz = item.timezone.clone().unwrap_or_default();
        if !sit_match(
            q,
            &item.created_at,
            &surface,
            item.weather_code,
            item.lat,
            item.lon,
            near,
            radius,
        ) {
            continue;
        }
        rows.push(SitRow {
            note_id: None,
            parked_id: Some(item.id),
            parked_body: Some(item.body),
            local_time: local,
            timezone: tz,
            weather_label: item.weather_label,
            temp_c: item.temp_c,
            weather_code: item.weather_code,
        });
    }
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
fn sit_match(
    q: &SearchParams,
    captured: &str,
    surface: &str,
    code: Option<i64>,
    lat: Option<f64>,
    lon: Option<f64>,
    near: Option<(f64, f64)>,
    radius: f64,
) -> bool {
    if let Some(from) = &q.from {
        if captured < from.as_str() {
            return false;
        }
    }
    if let Some(to) = &q.to {
        if captured > to.as_str() {
            return false;
        }
    }
    if let Some(s) = &q.surface {
        if surface != s {
            return false;
        }
    }
    if let Some(w) = &q.weather {
        let Some(code) = code else {
            return false;
        };
        if !weather_matches(code, w) {
            return false;
        }
    }
    if let Some((nlat, nlon)) = near {
        let Some((lat, lon)) = lat.zip(lon) else {
            return false;
        };
        if haversine_m(nlat, nlon, lat, lon) > radius {
            return false;
        }
    }
    true
}

fn context_line(row: &SitRow) -> String {
    let weather = row.weather_label.as_ref().map(|label| WeatherNow {
        weather_code: row.weather_code.unwrap_or(0),
        weather_label: label.clone(),
        temp_c: row.temp_c.unwrap_or(0.0),
    });
    format_stamp(
        &row.local_time,
        &row.timezone,
        weather.as_ref(),
    )
}

pub fn search(
    state: &AppState,
    user_id: i64,
    vault: &std::path::Path,
    params: &SearchParams,
) -> Result<Vec<SearchHit>, AppError> {
    let q = params.q.trim();
    if q.is_empty() && !params.has_filters() {
        return Err(AppError::BadRequest("query is empty".into()));
    }
    if q.len() > 200 {
        return Err(AppError::BadRequest("query is too long".into()));
    }
    let _ = crate::index::sync(state, user_id, vault);
    let text_hits = if q.is_empty() {
        Vec::new()
    } else {
        notes::search_in(vault, q, params.note_id.as_deref())?
    };
    if !params.has_filters() {
        if let Some(tag) = crate::tags::parse_tag_query(q) {
            let mut hits = text_hits;
            hits.extend(parked_tag_hits(vault, &tag)?);
            return Ok(hits);
        }
        return Ok(text_hits);
    }
    let sits = situation_rows(vault, params)?;
    let mut out = Vec::new();
    let mut seen_notes = HashSet::new();
    let metas: HashMap<String, notes::NoteMeta> = notes::list_notes(vault)?
        .into_iter()
        .map(|n| (n.id.clone(), n))
        .collect();
    if q.is_empty() {
        for row in &sits {
            if let Some(note_id) = &row.note_id {
                if !seen_notes.insert(note_id.clone()) {
                    continue;
                }
                let Some(meta) = metas.get(note_id) else {
                    continue;
                };
                out.push(SearchHit {
                    id: note_id.clone(),
                    title: meta.title.clone(),
                    snippet: context_line(row),
                    kind: Some("note".into()),
                    parked_id: None,
                    context: Some(context_line(row)),
                    from: None,
                    to: None,
                    line: None,
                });
            } else if let Some(pid) = row.parked_id.as_ref() {
                let title = row
                    .parked_body
                    .as_deref()
                    .and_then(|b| b.lines().next())
                    .unwrap_or("Parked")
                    .to_string();
                out.push(SearchHit {
                    id: format!("parked-{pid}"),
                    title,
                    snippet: context_line(row),
                    kind: Some("parked".into()),
                    parked_id: Some(pid.clone()),
                    context: Some(context_line(row)),
                    from: None,
                    to: None,
                    line: None,
                });
            }
        }
        return Ok(out);
    }
    let sit_notes: HashSet<String> = sits
        .iter()
        .filter_map(|r| r.note_id.clone())
        .collect();
    for hit in text_hits {
        if sit_notes.contains(&hit.id) {
            let ctx = sits
                .iter()
                .find(|r| r.note_id.as_deref() == Some(hit.id.as_str()))
                .map(context_line);
            out.push(SearchHit {
                kind: Some("note".into()),
                context: ctx,
                ..hit
            });
        }
    }
    let needle = q.to_lowercase();
    let tag_q = crate::tags::parse_tag_query(q);
    for row in &sits {
        let Some(pid) = row.parked_id.as_ref() else {
            continue;
        };
        let body = row.parked_body.as_deref().unwrap_or("");
        let tag_hit = tag_q.as_ref().is_some_and(|tag| {
            crate::tags::extract_hashtags(body).iter().any(|t| t == tag)
        });
        if !tag_hit && !body.to_lowercase().contains(&needle) {
            continue;
        }
        let title = body.lines().next().unwrap_or("Parked").to_string();
        out.push(SearchHit {
            id: format!("parked-{pid}"),
            title,
            snippet: context_line(row),
            kind: Some("parked".into()),
            parked_id: Some(pid.clone()),
            context: Some(context_line(row)),
            from: None,
            to: None,
            line: None,
        });
    }
    Ok(out)
}

fn parked_tag_hits(vault: &std::path::Path, tag: &str) -> Result<Vec<SearchHit>, AppError> {
    let mut hits = Vec::new();
    for item in parked::list_parked(vault)? {
        let tagged = item.tags.iter().any(|t| t == tag);
        let idx = crate::tags::first_hashtag_index(&item.body, tag);
        if !tagged && idx.is_none() {
            continue;
        }
        let title = item
            .body
            .lines()
            .next()
            .unwrap_or("Parked")
            .to_string();
        let snippet = if let Some(at) = idx {
            notes::snippet(&item.body, at, tag.len() + 1)
        } else {
            notes::snippet(&item.body, 0, 0)
        };
        hits.push(SearchHit {
            id: format!("parked-{}", item.id),
            title,
            snippet,
            kind: Some("parked".into()),
            parked_id: Some(item.id),
            context: None,
            from: None,
            to: None,
            line: None,
        });
    }
    Ok(hits)
}

pub fn fill_pending_weather(state: &AppState, vault: &std::path::Path, pending: Vec<PendingWeather>) {
    for item in pending {
        let weather = match lookup_weather(state, item.lat, item.lon) {
            Ok(Some(w)) => w,
            _ => match (state.weather)(item.lat, item.lon) {
                Some(w) => {
                    let _ = put_weather_cache(state, item.lat, item.lon, &w);
                    w
                }
                None => continue,
            },
        };
        let _ = apply_weather_to_event(vault, &item.note_id, &item.event_id, &weather);
    }
}

pub fn migrate_from_db(state: &AppState, username: &str, vault: &std::path::Path) -> Result<(), AppError> {
    let Some(user_id) = crate::index::user_id_by_name(state, username)? else {
        return Ok(());
    };
    let files = {
        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Internal(anyhow::anyhow!("db lock")))?;
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'note_blocks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if exists == 0 {
            return Ok(());
        }
        let mut stmt = conn.prepare(
            "SELECT note_id FROM note_blocks WHERE user_id = ?1 GROUP BY note_id",
        )?;
        let note_ids: Vec<String> = stmt
            .query_map(params![user_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        let mut files = Vec::new();
        for note_id in note_ids {
            let mut file = empty_context(&note_id);
            let mut bstmt = conn.prepare(
                "SELECT id, ordinal, text_norm, preview, created_at, updated_at, deleted_at
                 FROM note_blocks WHERE user_id = ?1 AND note_id = ?2",
            )?;
            let blocks = bstmt.query_map(params![user_id, note_id], |row| {
                Ok(BlockRec {
                    id: row.get(0)?,
                    ordinal: row.get(1)?,
                    text_norm: row.get(2)?,
                    preview: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    deleted_at: row.get(6)?,
                })
            })?;
            for block in blocks {
                file.blocks.push(block?);
            }
            drop(bstmt);
            let mut estmt = conn.prepare(
                "SELECT id, block_id, captured_at, local_time, timezone, surface, device,
                        lat, lon, accuracy_m, weather_code, weather_label, temp_c, source
                 FROM context_events WHERE user_id = ?1 AND note_id = ?2",
            )?;
            let events = estmt.query_map(params![user_id, note_id], |row| {
                Ok(EventRec {
                    id: row.get::<_, i64>(0)?.to_string(),
                    block_id: row.get(1)?,
                    captured_at: row.get(2)?,
                    local_time: row.get(3)?,
                    timezone: row.get(4)?,
                    surface: row.get(5)?,
                    device: row.get(6)?,
                    lat: row.get(7)?,
                    lon: row.get(8)?,
                    accuracy_m: row.get(9)?,
                    weather_code: row.get(10)?,
                    weather_label: row.get(11)?,
                    temp_c: row.get(12)?,
                    source: row.get(13)?,
                })
            })?;
            for event in events {
                file.events.push(event?);
            }
            files.push(file);
        }
        conn.execute("DELETE FROM note_blocks WHERE user_id = ?1", params![user_id])?;
        files
    };
    for file in files {
        if !context_path(vault, &file.note_id).is_file() {
            save_context_file(vault, &file)?;
        }
    }
    Ok(())
}

pub fn resolve_weather(state: &AppState, lat: f64, lon: f64) -> Option<WeatherNow> {
    if let Ok(Some(w)) = lookup_weather(state, lat, lon) {
        return Some(w);
    }
    let w = (state.weather)(lat, lon)?;
    let _ = put_weather_cache(state, lat, lon, &w);
    Some(w)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(id: &str, text: &str, ord: i64) -> Block {
        Block {
            id: id.into(),
            ordinal: Some(ord),
            text_norm: normalize_line(text),
            preview: preview_of(text),
        }
    }

    #[test]
    fn align_keeps_equal_lines() {
        let old = vec![block("a", "hello", 0), block("b", "world", 1)];
        let new = vec!["hello".into(), "world".into()];
        let ops = align(&old, &new);
        assert!(ops.iter().all(|op| matches!(op, AlignOp::Keep { .. })));
    }

    #[test]
    fn align_inserts_and_deletes() {
        let old = vec![block("a", "keep", 0), block("b", "gone", 1)];
        let new = vec!["keep".into(), "new".into()];
        let ops = align(&old, &new);
        assert!(ops.iter().any(|op| matches!(op, AlignOp::Delete { old_idx: 1 })));
        assert!(ops.iter().any(|op| matches!(op, AlignOp::Insert { new_idx: 1 })));
    }

    #[test]
    fn align_split_keeps_best() {
        let old = vec![block("a", "hello world", 0)];
        let new = vec!["hello world extra".into(), "other".into()];
        let ops = align(&old, &new);
        assert!(ops.iter().any(|op| matches!(
            op,
            AlignOp::Keep {
                old_idx: 0,
                new_idx: 0
            }
        )));
        assert!(ops.iter().any(|op| matches!(op, AlignOp::Insert { new_idx: 1 })));
    }

    #[test]
    fn weather_buckets() {
        assert!(weather_matches(61, "rain"));
        assert!(weather_matches(80, "rain"));
        assert!(!weather_matches(0, "rain"));
        assert_eq!(weather_label(1), "partly cloudy");
    }

    #[test]
    fn stamp_has_no_coords() {
        let w = WeatherNow {
            weather_code: 1,
            weather_label: "partly cloudy".into(),
            temp_c: 18.0,
        };
        let s = format_stamp("2026-08-23 14:05", "America/Los_Angeles", Some(&w));
        assert!(s.contains("14:05"));
        assert!(s.contains("18°C"));
        assert!(!s.contains("lat"));
        assert!(!s.to_lowercase().contains("37."));
    }

    #[test]
    fn split_and_norm() {
        assert_eq!(split_paragraphs("a\n\nb").len(), 3);
        assert_eq!(normalize_line("  a   b "), "a b");
    }
}
