use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use mnote::{api, db, AppState};
use serde_json::{json, Value};
use std::path::PathBuf;
use tempfile::TempDir;
use tower::ServiceExt;

struct Harness {
    app: axum::Router,
    _dir: TempDir,
}

impl Harness {
    fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let state = AppState::open(dir.path()).unwrap();
        db::create_user(&state, "alice", Some("password1")).unwrap();
        db::create_user(&state, "bob", Some("password1")).unwrap();
        db::set_password(&state, "alice", "password1", false).unwrap();
        db::set_password(&state, "bob", "password1", false).unwrap();
        Self {
            app: api::router(state),
            _dir: dir,
        }
    }

    async fn call(&self, req: Request<Body>) -> (StatusCode, header::HeaderMap, Value) {
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or(Value::String(String::from_utf8_lossy(&bytes).into_owned()))
        };
        (status, headers, body)
    }

    async fn login(&self, username: &str, password: &str) -> String {
        let (status, headers, body) = self
            .call(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({ "username": username, "password": password }).to_string(),
                    ))
                    .unwrap(),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        session_cookie(&headers)
    }

    fn authed(
        &self,
        method: Method,
        uri: &str,
        cookie: &str,
        body: Option<Value>,
    ) -> Request<Body> {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::COOKIE, format!("mnote_session={cookie}"));
        if body.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        builder
            .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
            .unwrap()
    }
}

fn session_cookie(headers: &header::HeaderMap) -> String {
    let raw = headers.get(header::SET_COOKIE).unwrap().to_str().unwrap();
    raw.split(';')
        .next()
        .unwrap()
        .strip_prefix("mnote_session=")
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn spa_fallback_serves_index() {
    let h = Harness::new();
    let res = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/n/2026-08-22")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    if PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("web/dist/index.html")
        .is_file()
    {
        assert_eq!(res.status(), StatusCode::OK);
        assert!(res
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("text/html"));
    } else {
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}

#[tokio::test]
async fn health() {
    let h = Harness::new();
    let (status, _, body) = h
        .call(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn login_me_logout() {
    let h = Harness::new();
    let (status, _, body) = h
        .call(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "username": "alice", "password": "nope" }).to_string(),
                ))
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "unauthorized");

    let cookie = h.login("alice", "password1").await;
    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/auth/me", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["username"], "alice");
    assert_eq!(body["must_change_password"], false);

    let (status, _, _) = h
        .call(h.authed(Method::POST, "/api/auth/logout", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _, _) = h
        .call(h.authed(Method::GET, "/api/auth/me", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn notes_require_auth() {
    let h = Harness::new();
    let (status, _, _) = h
        .call(
            Request::builder()
                .uri("/api/notes")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn must_change_password_blocks_notes() {
    let dir = TempDir::new().unwrap();
    let state = AppState::open(dir.path()).unwrap();
    db::create_user(&state, "cara", None).unwrap();
    db::set_password(&state, "cara", "temppass1", true).unwrap();
    let app = api::router(state);
    let h = Harness { app, _dir: dir };
    let cookie = h.login("cara", "temppass1").await;
    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/notes", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "must_change_password");

    let (status, _, body) = h
        .call(h.authed(
            Method::POST,
            "/api/auth/password",
            &cookie,
            Some(json!({ "password": "temppass1" })),
        ))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "choose a different password");

    let (status, _, _) = h
        .call(h.authed(
            Method::POST,
            "/api/auth/password",
            &cookie,
            Some(json!({ "password": "newpass12" })),
        ))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = h
        .call(h.authed(Method::GET, "/api/notes", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = h
        .call(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "username": "cara", "password": "newpass12" }).to_string(),
                ))
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn daily_crud_list_search_backlinks() {
    let h = Harness::new();
    let cookie = h.login("alice", "password1").await;

    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/notes/daily/2026-08-22", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["path"], "2026-08-22");
    assert!(body["content"].as_str().unwrap().contains("2026-08-22"));

    let (status, _, _) = h
        .call(h.authed(
            Method::PUT,
            "/api/notes/daily/2026-08-22",
            &cookie,
            Some(json!({ "content": "# 2026-08-22\n\nsee [[ideas/one]]\n" })),
        ))
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, body) = h
        .call(h.authed(
            Method::POST,
            "/api/notes",
            &cookie,
            Some(json!({ "path": "ideas/one", "content": "# One\n\nhello searchterm\n" })),
        ))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["path"], "ideas/one");

    let (status, _, _) = h
        .call(h.authed(
            Method::POST,
            "/api/notes",
            &cookie,
            Some(json!({ "path": "ideas/one" })),
        ))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _, body) = h
        .call(h.authed(
            Method::POST,
            "/api/notes",
            &cookie,
            Some(json!({ "path": "work/plan" })),
        ))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(body["content"].as_str().unwrap().starts_with("# plan\n"));

    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/notes/ideas/one", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["content"].as_str().unwrap().contains("searchterm"));

    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/notes", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 3);

    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/search?q=searchterm", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["path"], "ideas/one");

    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/backlinks/ideas/one", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["path"], "2026-08-22");

    let (status, _, _) = h
        .call(h.authed(
            Method::PUT,
            "/api/notes/ideas/one",
            &cookie,
            Some(json!({ "content": "# One\n\nupdated\n" })),
        ))
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn isolation_and_traversal() {
    let h = Harness::new();
    let alice = h.login("alice", "password1").await;
    let bob = h.login("bob", "password1").await;

    h.call(h.authed(
        Method::PUT,
        "/api/notes/secret",
        &alice,
        Some(json!({ "content": "alice only" })),
    ))
    .await;

    let (status, _, _) = h
        .call(h.authed(Method::GET, "/api/notes/secret", &bob, None))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _, _) = h
        .call(h.authed(
            Method::GET,
            "/api/notes/..%2F..%2Fetc%2Fpasswd",
            &alice,
            None,
        ))
        .await;
    assert!(status == StatusCode::BAD_REQUEST || status == StatusCode::NOT_FOUND);

    let (status, _, _) = h
        .call(h.authed(Method::GET, "/api/notes/daily/not-a-date", &alice, None))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn favorites_and_recent_notes_are_per_user() {
    let h = Harness::new();
    let alice = h.login("alice", "password1").await;
    let bob = h.login("bob", "password1").await;

    let (status, _, _) = h
        .call(h.authed(
            Method::POST,
            "/api/notes",
            &alice,
            Some(json!({ "path": "ideas/one", "content": "# One\n" })),
        ))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _, _) = h
        .call(h.authed(Method::GET, "/api/notes/ideas/one", &alice, None))
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = h
        .call(h.authed(Method::PUT, "/api/favorites/ideas/one", &alice, None))
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/favorites", &alice, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["path"], "ideas/one");
    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/notes/recent", &alice, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["path"], "ideas/one");

    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/favorites", &bob, None))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!([]));
    let (status, _, _) = h
        .call(h.authed(Method::DELETE, "/api/favorites/ideas/one", &alice, None))
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn assets() {
    let h = Harness::new();
    let cookie = h.login("alice", "password1").await;
    let png = [137, 80, 78, 71, 13, 10, 26, 10];
    let body = build_multipart("file", "pic.png", "image/png", &png);

    let (status, _, body_json) = h
        .call(
            Request::builder()
                .method(Method::POST)
                .uri("/api/assets")
                .header(header::COOKIE, format!("mnote_session={cookie}"))
                .header(header::CONTENT_TYPE, "multipart/form-data; boundary=bound")
                .body(Body::from(body))
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body_json}");
    let id = body_json["id"].as_str().unwrap().to_string();
    assert!(id.ends_with(".png"));

    let res = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/assets/{id}"))
                .header(header::COOKIE, format!("mnote_session={cookie}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "image/png"
    );
}

fn build_multipart(field: &str, filename: &str, ct: &str, data: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--bound\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\nContent-Type: {ct}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(data);
    body.extend_from_slice(b"\r\n--bound--\r\n");
    body
}

#[tokio::test]
async fn change_password_and_short_rejected() {
    let h = Harness::new();
    let cookie = h.login("alice", "password1").await;
    let (status, _, _) = h
        .call(h.authed(
            Method::POST,
            "/api/auth/password",
            &cookie,
            Some(json!({ "password": "short" })),
        ))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _, _) = h
        .call(h.authed(
            Method::POST,
            "/api/auth/password",
            &cookie,
            Some(json!({ "password": "newerpass" })),
        ))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!h.login("alice", "newerpass").await.is_empty());
    let (status, _, _) = h
        .call(h.authed(Method::GET, "/api/auth/me", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn search_empty_query() {
    let h = Harness::new();
    let cookie = h.login("alice", "password1").await;
    let (status, _, _) = h
        .call(h.authed(Method::GET, "/api/search?q=", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn missing_note_and_asset_errors() {
    let h = Harness::new();
    let cookie = h.login("alice", "password1").await;
    let (status, _, body) = h
        .call(h.authed(Method::GET, "/api/notes/nope", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "not_found");

    let (status, _, _) = h
        .call(h.authed(Method::GET, "/api/assets/missing.png", &cookie, None))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _, _) = h
        .call(
            Request::builder()
                .method(Method::POST)
                .uri("/api/assets")
                .header(header::COOKIE, format!("mnote_session={cookie}"))
                .header(header::CONTENT_TYPE, "multipart/form-data; boundary=bound")
                .body(Body::from("--bound--\r\n"))
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
