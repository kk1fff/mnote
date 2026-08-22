use crate::db::{self, User, SESSION_COOKIE, SESSION_DAYS};
use crate::error::AppError;
use crate::notes;
use crate::AppState;
use axum::body::Body;
use axum::extract::{FromRequestParts, Multipart, Path, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, COOKIE, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/password", post(change_password))
        .route("/auth/me", get(me))
        .route("/notes", get(list_notes).post(create_note))
        .route("/notes/daily/{date}", get(daily_note).put(put_daily_note))
        .route("/notes/{*path}", get(get_note).put(put_note))
        .route("/search", get(search_notes))
        .route("/backlinks/{*path}", get(backlinks))
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
    path: String,
    content: Option<String>,
}

async fn create_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Json(body): Json<CreateNote>,
) -> Result<(StatusCode, Json<notes::Note>), AppError> {
    require_ready(&user)?;
    let vault = state.vault_dir(&user.username);
    let path = notes::normalize_note_path(&body.path)?;
    if notes::get_note(&vault, &path).is_ok() {
        return Err(AppError::Conflict("note already exists".into()));
    }
    let content = body.content.unwrap_or_else(|| format!("# {path}\n\n"));
    let note = notes::put_note(&vault, &path, &content)?;
    Ok((StatusCode::CREATED, Json(note)))
}

async fn daily_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(date): Path<String>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::get_or_create_daily(
        &state.vault_dir(&user.username),
        &date,
    )?))
}

async fn put_daily_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(date): Path<String>,
    Json(body): Json<UpdateNote>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    let date = notes::parse_daily_date(&date)?;
    Ok(Json(notes::put_note(
        &state.vault_dir(&user.username),
        &date,
        &body.content,
    )?))
}

#[derive(Deserialize)]
struct UpdateNote {
    content: String,
}

async fn get_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(path): Path<String>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::get_note(
        &state.vault_dir(&user.username),
        &path,
    )?))
}

async fn put_note(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(path): Path<String>,
    Json(body): Json<UpdateNote>,
) -> Result<Json<notes::Note>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::put_note(
        &state.vault_dir(&user.username),
        &path,
        &body.content,
    )?))
}

async fn backlinks(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(path): Path<String>,
) -> Result<Json<Vec<notes::NoteMeta>>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::backlinks(
        &state.vault_dir(&user.username),
        &path,
    )?))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

async fn search_notes(
    State(state): State<AppState>,
    Auth(user): Auth,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<notes::SearchHit>>, AppError> {
    require_ready(&user)?;
    Ok(Json(notes::search(
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
