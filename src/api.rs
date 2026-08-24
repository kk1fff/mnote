use crate::context::{self, ContextStamp, IngestBody, SearchParams, WeatherNow};
use crate::db::{self, User, SESSION_COOKIE, SESSION_DAYS};
use crate::error::AppError;
use crate::live::{self, ClientMsg, ServerMsg};
use crate::notes;
use crate::AppState;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, Multipart, Path, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, COOKIE, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/password", post(change_password))
        .route("/auth/me", get(me))
        .route("/live", get(live_ws))
        .route("/notes", get(list_notes).post(create_note))
        .route("/notes/daily/{date}", get(daily_note).put(put_daily_note))
        .route("/notes/recent", get(recent_notes))
        .route("/notes/title-search", get(search_titles))
        .route("/notes/{id}/history", get(list_history))
        .route("/notes/{id}/history/{rev}", get(get_history))
        .route("/notes/{id}/restore", post(restore_note))
        .route("/notes/{id}/context", get(get_context).post(post_context))
        .route("/weather", get(get_weather))
        .route(
            "/notes/{id}",
            get(get_note)
                .put(put_note)
                .patch(patch_note)
                .delete(delete_note),
        )
        .route("/favorites", get(favorites))
        .route("/favorites/{id}", put(favorite).delete(unfavorite))
        .route("/collapsed-folders", get(list_collapsed_folders))
        .route(
            "/collapsed-folders/{*folder}",
            put(collapse_folder).delete(expand_folder),
        )
        .route("/search", get(search_notes))
        .route("/parked", get(list_parked).post(create_parked))
        .route("/parked/{id}", axum::routing::delete(delete_parked))
        .route("/parked/{id}/note", post(parked_to_note))
        .route("/backlinks/{id}", get(backlinks))
        .route("/assets", post(upload_asset))
        .route("/assets/{id}", get(get_asset));

    let mut app = Router::new()
        .nest("/api", api)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let dist = crate::web_dist();
    if dist.is_dir() {
        let index = dist.join("index.html");
        app = app
            .nest_service("/assets", ServeDir::new(dist.join("assets")))
            .fallback_service(ServeFile::new(index));
    }
    app
}

#[derive(Clone)]
struct Auth(User);

impl FromRequestParts<AppState> for Auth {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = cookie_value(&parts.headers, SESSION_COOKIE).ok_or(AppError::Unauthorized)?;
        let user = db::user_from_token(state, &token)?;
        Ok(Auth(user))
    }
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie = headers.get(COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix(&format!("{name}="))
            .map(|v| v.to_string())
    })
}

fn session_cookie(token: &str, clear: bool) -> HeaderValue {
    let mut cookie = if clear {
        format!("{SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0")
    } else {
        format!(
            "{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Lax; Max-Age={}",
            SESSION_DAYS * 24 * 60 * 60
        )
    };
    if std::env::var("MNOTE_SECURE_COOKIE").ok().as_deref() == Some("1") {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).expect("cookie header")
}

fn require_ready(user: &User) -> Result<(), AppError> {
    if user.must_change_password {
        Err(AppError::Forbidden("must_change_password"))
    } else {
        Ok(())
    }
}

#[derive(Serialize)]
struct Health {
    ok: bool,
}

async fn health() -> Json<Health> {
    Json(Health { ok: true })
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct MeBody {
    username: String,
    must_change_password: bool,
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Response, AppError> {
    let user = db::authenticate(&state, &body.username, &body.password)?;
    let token = db::create_session(&state, user.id)?;
    let mut res = Json(MeBody {
        username: user.username,
        must_change_password: user.must_change_password,
    })
    .into_response();
    res.headers_mut()
        .insert(SET_COOKIE, session_cookie(&token, false));
    Ok(res)
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    if let Some(token) = cookie_value(&headers, SESSION_COOKIE) {
        db::delete_session(&state, &token)?;
    }
    let mut res = StatusCode::NO_CONTENT.into_response();
    res.headers_mut()
        .insert(SET_COOKIE, session_cookie("", true));
    Ok(res)
}

async fn me(Auth(user): Auth) -> Json<MeBody> {
    Json(MeBody {
        username: user.username,
        must_change_password: user.must_change_password,
    })
}

#[derive(Deserialize)]
struct PasswordBody {
    password: String,
}

async fn change_password(
    State(state): State<AppState>,
    Auth(user): Auth,
    Json(body): Json<PasswordBody>,
) -> Result<Json<MeBody>, AppError> {
    db::replace_password(&state, &user.username, body.password.trim())?;
    Ok(Json(MeBody {
        username: user.username,
        must_change_password: false,
    }))
}

async fn list_notes(
    State(state): State<AppState>,
    Auth(user): Auth,
) -> Result<Json<Vec<notes::NoteMeta>>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::list_notes(&state.vault_dir(&user.username))?))
}

#[derive(Deserialize)]
struct CreateNote {
    title: String,
    folder: Option<String>,
    content: Option<String>,
}

async fn create_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Json(body): Json<CreateNote>,
) -> Result<Response, AppError> {
    require_ready(&user)?;
    let vault = state.vault_dir(&user.username);
    match notes::create_note(
        &vault,
        &body.title,
        body.folder.as_deref().unwrap_or(""),
        body.content.as_deref(),
    ) {
        Ok(note) => {
            state.live.replace(user.id, &note.id, &note.content);
            state.live.index(user.id, notes::to_meta(&note));
            Ok((StatusCode::CREATED, Json(note)).into_response())
        }
        Err(err) => {
            if let Some(id) = notes::conflict_id(&err) {
                if let Ok(note) = notes::get_note(&vault, id) {
                    return Ok((StatusCode::CONFLICT, Json(note)).into_response());
                }
            }
            Err(err)
        }
    }
}

async fn daily_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(date): Path<String>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    let note = notes::get_or_create_daily(&state.vault_dir(&user.username), &date)?;
    db::record_note_open(&state, user.id, &note.id)?;
    state.live.index(user.id, notes::to_meta(&note));
    Ok(Json(note))
}

async fn put_daily_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(date): Path<String>,
    Json(body): Json<UpdateNote>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    let note = notes::get_or_create_daily(&state.vault_dir(&user.username), &date)?;
    let note = notes::put_note(&state.vault_dir(&user.username), &note.id, &body.content)?;
    state.live.replace(user.id, &note.id, &note.content);
    Ok(Json(note))
}

#[derive(Deserialize)]
struct UpdateNote {
    content: String,
}

async fn get_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    let note = notes::get_note(&state.vault_dir(&user.username), &id)?;
    db::record_note_open(&state, user.id, &note.id)?;
    Ok(Json(note))
}

fn metas_for_ids(vault: &std::path::Path, ids: Vec<String>) -> Vec<notes::NoteMeta> {
    ids.into_iter()
        .filter_map(|id| notes::note_meta(vault, &id).ok())
        .collect()
}

async fn recent_notes(
    State(state): State<AppState>,
    Auth(user): Auth,
) -> Result<Json<Vec<notes::NoteMeta>>, AppError> {
    require_ready(&user)?;
    let vault = state.vault_dir(&user.username);
    Ok(Json(metas_for_ids(
        &vault,
        db::recent_paths(&state, user.id)?,
    )))
}

async fn favorites(
    State(state): State<AppState>,
    Auth(user): Auth,
) -> Result<Json<Vec<notes::NoteMeta>>, AppError> {
    require_ready(&user)?;
    let vault = state.vault_dir(&user.username);
    Ok(Json(metas_for_ids(
        &vault,
        db::favorite_paths(&state, user.id)?,
    )))
}

async fn favorite(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    require_ready(&user)?;
    notes::get_note(&state.vault_dir(&user.username), &id)?;
    db::set_favorite(&state, user.id, &id, true)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unfavorite(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    require_ready(&user)?;
    db::set_favorite(&state, user.id, &id, false)?;
    Ok(StatusCode::NO_CONTENT)
}

fn folder_key(raw: &str) -> Result<String, AppError> {
    let folder = notes::normalize_folder(raw)?;
    if folder.is_empty() {
        return Err(AppError::BadRequest("folder path is empty".into()));
    }
    Ok(folder)
}

async fn list_collapsed_folders(
    State(state): State<AppState>,
    Auth(user): Auth,
) -> Result<Json<Vec<String>>, AppError> {
    require_ready(&user)?;
    Ok(Json(db::collapsed_folders(&state, user.id)?))
}

async fn collapse_folder(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(folder): Path<String>,
) -> Result<StatusCode, AppError> {
    require_ready(&user)?;
    db::set_folder_collapsed(&state, user.id, &folder_key(&folder)?, true)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn expand_folder(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(folder): Path<String>,
) -> Result<StatusCode, AppError> {
    require_ready(&user)?;
    db::set_folder_collapsed(&state, user.id, &folder_key(&folder)?, false)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_history(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
) -> Result<Json<Vec<notes::HistoryEntry>>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::list_history(
        &state.vault_dir(&user.username),
        &id,
    )?))
}

async fn get_history(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path((id, rev)): Path<(String, String)>,
) -> Result<Json<notes::HistoryRev>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::get_history(
        &state.vault_dir(&user.username),
        &id,
        &rev,
    )?))
}

#[derive(Deserialize)]
struct RestoreNote {
    rev: String,
}

async fn delete_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    require_ready(&user)?;
    let id = notes::normalize_note_id(&id)?;
    notes::delete_note(&state.vault_dir(&user.username), &id)?;
    db::clear_note_state(&state, user.id, &id)?;
    context::delete_note_context(&state, user.id, &id)?;
    state.live.remove(user.id, &id);
    Ok(StatusCode::NO_CONTENT)
}

async fn restore_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
    Json(body): Json<RestoreNote>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    let note = notes::restore_note(&state.vault_dir(&user.username), &id, &body.rev)?;
    state.live.force_replace(user.id, &note.id, &note.content);
    Ok(Json(note))
}

async fn put_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
    Json(body): Json<UpdateNote>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    let note = notes::put_note(&state.vault_dir(&user.username), &id, &body.content)?;
    state.live.replace(user.id, &note.id, &note.content);
    Ok(Json(note))
}

#[derive(Deserialize)]
struct PatchNote {
    title: Option<String>,
    folder: Option<String>,
}

async fn patch_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
    Json(body): Json<PatchNote>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    let (note, rewritten) = notes::update_meta_and_rewrites(
        &state.vault_dir(&user.username),
        &id,
        body.title.as_deref(),
        body.folder.as_deref(),
    )?;
    state.live.index(user.id, notes::to_meta(&note));
    for other in rewritten {
        state.live.force_replace(user.id, &other.id, &other.content);
    }
    Ok(Json(note))
}

#[derive(Deserialize)]
struct CreateParked {
    body: String,
    source_id: Option<String>,
    source_title: Option<String>,
    source_folder: Option<String>,
    excerpt: Option<String>,
    surface: Option<String>,
    device: Option<String>,
    local_time: Option<String>,
    timezone: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    accuracy_m: Option<f64>,
}

async fn list_parked(
    State(state): State<AppState>,
    Auth(user): Auth,
) -> Result<Json<Vec<db::Parked>>, AppError> {
    require_ready(&user)?;
    Ok(Json(db::list_parked(&state, user.id)?))
}

async fn create_parked(
    State(state): State<AppState>,
    Auth(user): Auth,
    Json(body): Json<CreateParked>,
) -> Result<(StatusCode, Json<db::Parked>), AppError> {
    require_ready(&user)?;
    let stamp = ContextStamp {
        surface: body.surface.clone(),
        device: body.device.clone(),
        local_time: body.local_time.clone(),
        timezone: body.timezone.clone(),
        lat: body.lat,
        lon: body.lon,
        accuracy_m: body.accuracy_m,
    };
    let item = db::create_parked(
        &state,
        user.id,
        &body.body,
        db::ParkedSource {
            source_id: body.source_id.as_deref(),
            source_title: body.source_title.as_deref(),
            source_folder: body.source_folder.as_deref(),
            excerpt: body.excerpt.as_deref(),
        },
        &stamp,
    )?;
    if item.weather_label.is_none() {
        if let (Some(lat), Some(lon)) = (body.lat, body.lon) {
            let state2 = state.clone();
            let user_id = user.id;
            let parked_id = item.id;
            tokio::spawn(async move {
                let fetch = state2.clone();
                let Some(weather) = tokio::task::spawn_blocking(move || {
                    context::resolve_weather(&fetch, lat, lon)
                })
                .await
                .ok()
                .flatten() else {
                    return;
                };
                let _ = context::apply_weather_to_parked(&state2, user_id, parked_id, &weather);
            });
        }
    }
    Ok((StatusCode::CREATED, Json(item)))
}

async fn delete_parked(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    require_ready(&user)?;
    db::delete_parked(&state, user.id, id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn parked_to_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    require_ready(&user)?;
    let item = db::get_parked(&state, user.id, id)?;
    let title = notes::parked_note_title(&item.body);
    let folder = item.source_folder.clone().unwrap_or_default();
    let content = notes::parked_note_body(
        &item.body,
        item.source_title.as_deref(),
        item.source_folder.as_deref(),
        item.excerpt.as_deref(),
    );
    let vault = state.vault_dir(&user.username);
    let (status, note) = match notes::create_note(&vault, &title, &folder, Some(&content)) {
        Ok(note) => (StatusCode::CREATED, note),
        Err(err) => {
            let Some(existing_id) = notes::conflict_id(&err) else {
                return Err(err);
            };
            (StatusCode::OK, notes::get_note(&vault, existing_id)?)
        }
    };
    db::delete_parked(&state, user.id, id)?;
    state.live.replace(user.id, &note.id, &note.content);
    state.live.index(user.id, notes::to_meta(&note));
    Ok((status, Json(note)).into_response())
}

async fn backlinks(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
) -> Result<Json<Vec<notes::NoteMeta>>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::backlinks(
        &state.vault_dir(&user.username),
        &id,
    )?))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

async fn search_notes(
    State(state): State<AppState>,
    Auth(user): Auth,
    Query(query): Query<SearchParams>,
) -> Result<Json<Vec<notes::SearchHit>>, AppError> {
    require_ready(&user)?;
    Ok(Json(context::search(
        &state,
        user.id,
        &state.vault_dir(&user.username),
        &query,
    )?))
}

async fn get_context(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
) -> Result<Json<context::ContextResponse>, AppError> {
    require_ready(&user)?;
    let id = notes::normalize_note_id(&id)?;
    notes::get_note(&state.vault_dir(&user.username), &id)?;
    Ok(Json(context::get_context(&state, user.id, &id)?))
}

async fn post_context(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
    Json(body): Json<IngestBody>,
) -> Result<Json<context::ContextResponse>, AppError> {
    require_ready(&user)?;
    let id = notes::normalize_note_id(&id)?;
    notes::get_note(&state.vault_dir(&user.username), &id)?;
    let (resp, pending) = context::ingest(&state, user.id, &id, body)?;
    if !pending.is_empty() {
        let state2 = state.clone();
        tokio::spawn(async move {
            let _ = tokio::task::spawn_blocking(move || {
                context::fill_pending_weather(&state2, pending);
            })
            .await;
        });
    }
    Ok(Json(resp))
}

#[derive(Deserialize)]
struct WeatherQuery {
    lat: f64,
    lon: f64,
}

async fn get_weather(
    State(state): State<AppState>,
    Auth(user): Auth,
    Query(query): Query<WeatherQuery>,
) -> Result<Json<WeatherNow>, AppError> {
    require_ready(&user)?;
    if !(-90.0..=90.0).contains(&query.lat) || !(-180.0..=180.0).contains(&query.lon) {
        return Err(AppError::BadRequest("invalid coordinates".into()));
    }
    context::resolve_weather(&state, query.lat, query.lon)
        .map(Json)
        .ok_or_else(|| AppError::NotFound)
}

async fn search_titles(
    State(state): State<AppState>,
    Auth(user): Auth,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<notes::NoteMeta>>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::search_titles(
        &state.vault_dir(&user.username),
        &query.q,
    )?))
}

async fn upload_asset(
    State(state): State<AppState>,
    Auth(user): Auth,
    mut multipart: Multipart,
) -> Result<Json<notes::Asset>, AppError> {
    require_ready(&user)?;
    while let Some(field) = multipart.next_field().await? {
        let name = field.name().unwrap_or_default().to_string();
        if name != "file" {
            continue;
        }
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;
        let asset = notes::save_asset(&state.vault_dir(&user.username), &content_type, &bytes)?;
        return Ok(Json(asset));
    }
    Err(AppError::BadRequest("missing file field".into()))
}

async fn live_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Auth(user): Auth,
) -> Result<Response, AppError> {
    require_ready(&user)?;
    Ok(ws.on_upgrade(move |socket| live_socket(socket, state, user)))
}

async fn live_socket(mut socket: WebSocket, state: AppState, user: User) {
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMsg>();
    let mut client_id = String::new();
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        handle_live_text(&state, &user, &tx, &mut client_id, text.as_str());
                    }
                    Some(Ok(Message::Ping(p))) => {
                        if socket.send(Message::Pong(p)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            out = rx.recv() => {
                let Some(msg) = out else { break };
                let Ok(json) = serde_json::to_string(&msg) else { continue };
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    }
    if !client_id.is_empty() {
        state.live.disconnect_conn(user.id, &client_id, Some(&tx));
    }
}

fn handle_live_text(
    state: &AppState,
    user: &User,
    tx: &mpsc::UnboundedSender<ServerMsg>,
    client_id: &mut String,
    text: &str,
) {
    let msg = match serde_json::from_str::<ClientMsg>(text) {
        Ok(msg) => msg,
        Err(_) => {
            let _ = tx.send(ServerMsg::Error {
                error: "bad_message".into(),
            });
            return;
        }
    };
    match msg {
        ClientMsg::Hello { client_id: id } => {
            let id = id.trim();
            if id.is_empty() {
                let _ = tx.send(ServerMsg::Error {
                    error: "client_id required".into(),
                });
                return;
            }
            if !client_id.is_empty() && client_id != id {
                state.live.disconnect_conn(user.id, client_id, Some(tx));
            }
            *client_id = id.to_string();
            state.live.connect(user.id, client_id, tx.clone());
        }
        ClientMsg::Ping => {}
        _ if client_id.is_empty() => {
            let _ = tx.send(ServerMsg::Error {
                error: "hello first".into(),
            });
        }
        ClientMsg::Open { path, content } => match notes::normalize_note_id(&path) {
            Ok(id) => match notes::get_note(&state.vault_dir(&user.username), &id) {
                Ok(note) => {
                    state
                        .live
                        .open(user.id, client_id, &id, Some(&note.content), &content);
                }
                Err(_) => {
                    let _ = tx.send(ServerMsg::Deleted { id });
                }
            },
            Err(err) => {
                let _ = tx.send(ServerMsg::Error {
                    error: err.message(),
                });
            }
        },
        ClientMsg::Cursor { from, to } => {
            state.live.cursor(user.id, client_id, from, to);
        }
        ClientMsg::Change {
            path,
            rev,
            content,
            from,
            to,
            insert,
        } => match notes::normalize_note_id(&path) {
            Ok(id) => {
                if let Some(persist) = state.live.change(
                    user.id,
                    client_id,
                    live::Change {
                        path: id,
                        rev,
                        content,
                        from,
                        to,
                        insert,
                    },
                ) {
                    schedule_persist(state.clone(), user.clone(), persist);
                }
            }
            Err(err) => {
                let _ = tx.send(ServerMsg::Error {
                    error: err.message(),
                });
            }
        },
        ClientMsg::Push {
            path,
            base,
            content,
        } => match notes::normalize_note_id(&path) {
            Ok(id) => {
                if let Some(persist) = state.live.push(user.id, client_id, &id, &base, &content) {
                    schedule_persist(state.clone(), user.clone(), persist);
                }
            }
            Err(err) => {
                let _ = tx.send(ServerMsg::Error {
                    error: err.message(),
                });
            }
        },
    }
}

fn schedule_persist(state: AppState, user: User, persist: live::Persist) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        if state.live.rev(user.id, &persist.path) != Some(persist.rev) {
            return;
        }
        let _ = notes::put_note(
            &state.vault_dir(&user.username),
            &persist.path,
            &persist.content,
        );
    });
}

async fn get_asset(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    require_ready(&user)?;
    let (bytes, mime) = notes::read_asset(&state.vault_dir(&user.username), &id)?;
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap());
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000"),
    );
    Ok((headers, Body::from(bytes)).into_response())
}
