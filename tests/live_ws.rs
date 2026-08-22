use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
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
        r#"{"type":"open","path":"ideas/one","content":"hello"}"#.into(),
    ))
    .await
    .unwrap();
    b.send(Message::Text(
        r#"{"type":"open","path":"ideas/one","content":"hello"}"#.into(),
    ))
    .await
    .unwrap();
    c.send(Message::Text(
        r#"{"type":"open","path":"ideas/one","content":"hello"}"#.into(),
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
        r#"{"type":"change","path":"ideas/one","rev":0,"content":"hello!","from":5,"to":5,"insert":"!"}"#.into(),
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
