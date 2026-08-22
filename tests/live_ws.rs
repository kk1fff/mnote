use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use futures_util::{SinkExt, StreamExt};
use mnote::{api, db, AppState};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tower::ServiceExt;

async fn login_cookie(app: axum::Router, username: &str) -> String {
    let res = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "username": username, "password": "password1" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let raw = res
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    raw.split(';')
        .next()
        .unwrap()
        .strip_prefix("mnote_session=")
        .unwrap()
        .to_string()
}

async fn connect(
    addr: std::net::SocketAddr,
    cookie: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let mut req = format!("ws://{addr}/api/live")
        .into_client_request()
        .unwrap();
    req.headers_mut()
        .insert("Cookie", format!("mnote_session={cookie}").parse().unwrap());
    let (ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
    ws
}

async fn next_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    loop {
        let msg = ws.next().await.unwrap().unwrap();
        if let Message::Text(text) = msg {
            return serde_json::from_str(text.as_str()).unwrap();
        }
    }
}

#[tokio::test]
async fn live_relays_between_same_user() {
    let dir = TempDir::new().unwrap();
    let state = AppState::open(dir.path()).unwrap();
    db::create_user(&state, "alice", Some("password1")).unwrap();
    db::create_user(&state, "bob", Some("password1")).unwrap();
    db::set_password(&state, "alice", "password1", false).unwrap();
    db::set_password(&state, "bob", "password1", false).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = api::router(state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let alice = login_cookie(api::router(state.clone()), "alice").await;
    let bob = login_cookie(api::router(state.clone()), "bob").await;

    let created = api::router(state.clone())
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/notes")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, format!("mnote_session={alice}"))
                .body(Body::from(
                    json!({ "title": "One", "folder": "ideas", "content": "hello" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_body: Value = serde_json::from_slice(
        &created.into_body().collect().await.unwrap().to_bytes(),
    )
    .unwrap();
    let note_id = created_body["id"].as_str().unwrap();

    let mut a = connect(addr, &alice).await;
    let mut b = connect(addr, &alice).await;
    let mut c = connect(addr, &bob).await;

    a.send(Message::Text(r#"{"type":"hello","client_id":"a"}"#.into()))
        .await
        .unwrap();
    b.send(Message::Text(r#"{"type":"hello","client_id":"b"}"#.into()))
        .await
        .unwrap();
    c.send(Message::Text(r#"{"type":"hello","client_id":"c"}"#.into()))
        .await
        .unwrap();
    assert_eq!(next_json(&mut a).await["type"], "welcome");
    assert_eq!(next_json(&mut b).await["type"], "welcome");
    assert_eq!(next_json(&mut c).await["type"], "welcome");

    a.send(Message::Text(
        format!(r#"{{"type":"open","path":"{note_id}","content":"hello"}}"#).into(),
    ))
    .await
    .unwrap();
    b.send(Message::Text(
        format!(r#"{{"type":"open","path":"{note_id}","content":"hello"}}"#).into(),
    ))
    .await
    .unwrap();
    c.send(Message::Text(
        format!(r#"{{"type":"open","path":"{note_id}","content":"hello"}}"#).into(),
    ))
    .await
    .unwrap();
    assert_eq!(next_json(&mut a).await["type"], "opened");
    assert_eq!(next_json(&mut a).await["type"], "peers");
    assert_eq!(next_json(&mut b).await["type"], "opened");
    assert_eq!(next_json(&mut b).await["type"], "peers");
    assert_eq!(next_json(&mut c).await["type"], "opened");
    assert_eq!(next_json(&mut c).await["type"], "peers");

    a.send(Message::Text(
        format!(
            r#"{{"type":"change","path":"{note_id}","rev":0,"content":"hello!","from":5,"to":5,"insert":"!"}}"#
        )
        .into(),
    ))
    .await
    .unwrap();
    let change = next_json(&mut b).await;
    assert_eq!(change["type"], "change");
    assert_eq!(change["insert"], "!");
    assert_eq!(change["client_id"], "a");

    let wait = tokio::time::timeout(std::time::Duration::from_millis(80), c.next()).await;
    assert!(wait.is_err(), "other user must not see the change");
}

#[tokio::test]
async fn live_keeps_peers_after_http_put_and_stale_reconnect() {
    let dir = TempDir::new().unwrap();
    let state = AppState::open(dir.path()).unwrap();
    db::create_user(&state, "alice", Some("password1")).unwrap();
    db::set_password(&state, "alice", "password1", false).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = api::router(state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let alice = login_cookie(api::router(state.clone()), "alice").await;
    let created = api::router(state.clone())
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/notes")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, format!("mnote_session={alice}"))
                .body(Body::from(
                    json!({ "title": "Time", "content": "hello" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_body: Value = serde_json::from_slice(
        &created.into_body().collect().await.unwrap().to_bytes(),
    )
    .unwrap();
    let note_id = created_body["id"].as_str().unwrap();

    let mut stale = connect(addr, &alice).await;
    let mut a = connect(addr, &alice).await;
    let mut b = connect(addr, &alice).await;

    stale
        .send(Message::Text(
            r#"{"type":"hello","client_id":"a"}"#.into(),
        ))
        .await
        .unwrap();
    a.send(Message::Text(r#"{"type":"hello","client_id":"a"}"#.into()))
        .await
        .unwrap();
    b.send(Message::Text(r#"{"type":"hello","client_id":"b"}"#.into()))
        .await
        .unwrap();
    assert_eq!(next_json(&mut stale).await["type"], "welcome");
    assert_eq!(next_json(&mut a).await["type"], "welcome");
    assert_eq!(next_json(&mut b).await["type"], "welcome");

    drop(stale);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    a.send(Message::Text(
        format!(r#"{{"type":"open","path":"{note_id}","content":"hello"}}"#).into(),
    ))
    .await
    .unwrap();
    b.send(Message::Text(
        format!(r#"{{"type":"open","path":"{note_id}","content":"hello"}}"#).into(),
    ))
    .await
    .unwrap();
    assert_eq!(next_json(&mut a).await["type"], "opened");
    assert_eq!(next_json(&mut a).await["type"], "peers");
    assert_eq!(next_json(&mut b).await["type"], "opened");
    assert_eq!(next_json(&mut b).await["type"], "peers");

    let put = api::router(state.clone())
        .oneshot(
            Request::builder()
                .method(Method::PUT)
                .uri(format!("/api/notes/{note_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, format!("mnote_session={alice}"))
                .body(Body::from(json!({ "content": "stale" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(put.status(), StatusCode::OK);

    let no_resync = tokio::time::timeout(std::time::Duration::from_millis(80), b.next()).await;
    assert!(no_resync.is_err(), "http put must not resync live peers");

    a.send(Message::Text(
        format!(
            r#"{{"type":"change","path":"{note_id}","rev":0,"content":"hello!","from":5,"to":5,"insert":"!"}}"#
        )
        .into(),
    ))
    .await
    .unwrap();
    let change = next_json(&mut b).await;
    assert_eq!(change["type"], "change");
    assert_eq!(change["insert"], "!");
    assert_eq!(change["client_id"], "a");
}

#[tokio::test]
async fn live_requires_auth() {
    let dir = TempDir::new().unwrap();
    let state = AppState::open(dir.path()).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, api::router(state)).await.unwrap();
    });
    let req = format!("ws://{addr}/api/live")
        .into_client_request()
        .unwrap();
    let err = tokio_tungstenite::connect_async(req).await.unwrap_err();
    let _ = err;
}
