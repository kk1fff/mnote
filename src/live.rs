use crate::merge;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

pub type Outbox = mpsc::UnboundedSender<ServerMsg>;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    Hello {
        client_id: String,
    },
    Open {
        path: String,
        content: String,
    },
    Cursor {
        from: u32,
        to: u32,
    },
    Change {
        path: String,
        rev: u64,
        content: String,
        from: u32,
        to: u32,
        insert: String,
    },
    Push {
        path: String,
        base: String,
        content: String,
    },
    Ping,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Welcome {
        client_id: String,
    },
    Opened {
        path: String,
        rev: u64,
        content: String,
    },
    Change {
        path: String,
        rev: u64,
        content: String,
        from: u32,
        to: u32,
        insert: String,
        client_id: String,
    },
    Resync {
        path: String,
        rev: u64,
        content: String,
        conflict: bool,
    },
    Cursor {
        client_id: String,
        from: u32,
        to: u32,
    },
    Peers {
        peers: Vec<Peer>,
    },
    Gone {
        client_id: String,
    },
    Error {
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Peer {
    pub client_id: String,
    pub from: u32,
    pub to: u32,
}

#[derive(Clone, Default)]
pub struct LiveHub {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    users: HashMap<i64, UserLive>,
}

#[derive(Default)]
struct UserLive {
    conns: HashMap<String, Conn>,
    notes: HashMap<String, NoteBuf>,
}

struct Conn {
    tx: Outbox,
    path: Option<String>,
    cursor: Option<(u32, u32)>,
}

struct NoteBuf {
    content: String,
    rev: u64,
}

pub struct Change {
    pub path: String,
    pub rev: u64,
    pub content: String,
    pub from: u32,
    pub to: u32,
    pub insert: String,
}

impl LiveHub {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn connect(&self, user_id: i64, client_id: &str, tx: Outbox) {
        let mut inner = self.inner.lock().expect("live lock");
        let user = inner.users.entry(user_id).or_default();
        user.conns.insert(
            client_id.to_string(),
            Conn {
                tx: tx.clone(),
                path: None,
                cursor: None,
            },
        );
        let _ = tx.send(ServerMsg::Welcome {
            client_id: client_id.to_string(),
        });
    }

    pub fn disconnect(&self, user_id: i64, client_id: &str) {
        let mut inner = self.inner.lock().expect("live lock");
        let Some(user) = inner.users.get_mut(&user_id) else {
            return;
        };
        let path = user.conns.remove(client_id).and_then(|c| c.path);
        if let Some(path) = path {
            fanout(
                user,
                client_id,
                Some(&path),
                ServerMsg::Gone {
                    client_id: client_id.to_string(),
                },
            );
        }
        if user.conns.is_empty() {
            inner.users.remove(&user_id);
        }
    }

    pub fn open(&self, user_id: i64, client_id: &str, path: &str, disk: Option<&str>, local: &str) {
        let mut inner = self.inner.lock().expect("live lock");
        let Some(user) = inner.users.get_mut(&user_id) else {
            return;
        };
        let prev = user
            .conns
            .get(client_id)
            .and_then(|c| c.path.clone())
            .filter(|p| p != path);
        if let Some(prev) = prev {
            fanout(
                user,
                client_id,
                Some(&prev),
                ServerMsg::Gone {
                    client_id: client_id.to_string(),
                },
            );
        }
        let buf = user
            .notes
            .entry(path.to_string())
            .or_insert_with(|| NoteBuf {
                content: disk.unwrap_or(local).to_string(),
                rev: 0,
            });
        if let Some(conn) = user.conns.get_mut(client_id) {
            conn.path = Some(path.to_string());
            conn.cursor = None;
            let _ = conn.tx.send(ServerMsg::Opened {
                path: path.to_string(),
                rev: buf.rev,
                content: buf.content.clone(),
            });
        }
        let peers = peers_on(user, path, client_id);
        if let Some(conn) = user.conns.get(client_id) {
            let _ = conn.tx.send(ServerMsg::Peers { peers });
        }
    }

    pub fn cursor(&self, user_id: i64, client_id: &str, from: u32, to: u32) {
        let mut inner = self.inner.lock().expect("live lock");
        let Some(user) = inner.users.get_mut(&user_id) else {
            return;
        };
        let path = {
            let Some(conn) = user.conns.get_mut(client_id) else {
                return;
            };
            conn.cursor = Some((from, to));
            conn.path.clone()
        };
        if let Some(path) = path {
            fanout(
                user,
                client_id,
                Some(&path),
                ServerMsg::Cursor {
                    client_id: client_id.to_string(),
                    from,
                    to,
                },
            );
        }
    }

    pub fn change(&self, user_id: i64, client_id: &str, change: Change) -> Option<Persist> {
        let mut inner = self.inner.lock().expect("live lock");
        let user = inner.users.get_mut(&user_id)?;
        let path = change.path;
        let buf = user.notes.entry(path.clone()).or_insert_with(|| NoteBuf {
            content: change.content.clone(),
            rev: 0,
        });
        if buf.rev != change.rev {
            if let Some(conn) = user.conns.get(client_id) {
                let _ = conn.tx.send(ServerMsg::Resync {
                    path: path.clone(),
                    rev: buf.rev,
                    content: buf.content.clone(),
                    conflict: false,
                });
            }
            return None;
        }
        buf.content = change.content.clone();
        buf.rev += 1;
        let new_rev = buf.rev;
        fanout(
            user,
            client_id,
            Some(&path),
            ServerMsg::Change {
                path: path.clone(),
                rev: new_rev,
                content: change.content.clone(),
                from: change.from,
                to: change.to,
                insert: change.insert,
                client_id: client_id.to_string(),
            },
        );
        Some(Persist {
            path,
            content: change.content,
            rev: new_rev,
        })
    }

    pub fn push(
        &self,
        user_id: i64,
        client_id: &str,
        path: &str,
        base: &str,
        local: &str,
    ) -> Option<Persist> {
        let mut inner = self.inner.lock().expect("live lock");
        let user = inner.users.get_mut(&user_id)?;
        let buf = user
            .notes
            .entry(path.to_string())
            .or_insert_with(|| NoteBuf {
                content: base.to_string(),
                rev: 0,
            });
        let merged = merge::three_way(base, local, &buf.content);
        buf.content = merged.content.clone();
        buf.rev += 1;
        let persist = Persist {
            path: path.to_string(),
            content: buf.content.clone(),
            rev: buf.rev,
        };
        let msg = ServerMsg::Resync {
            path: path.to_string(),
            rev: buf.rev,
            content: buf.content.clone(),
            conflict: merged.conflict,
        };
        fanout(user, "", Some(path), msg);
        let _ = client_id;
        Some(persist)
    }

    pub fn replace(&self, user_id: i64, path: &str, content: &str) -> Option<u64> {
        let mut inner = self.inner.lock().expect("live lock");
        let user = inner.users.get_mut(&user_id)?;
        if !user.notes.contains_key(path)
            && !user.conns.values().any(|c| c.path.as_deref() == Some(path))
        {
            return None;
        }
        let buf = user
            .notes
            .entry(path.to_string())
            .or_insert_with(|| NoteBuf {
                content: content.to_string(),
                rev: 0,
            });
        if buf.content == content {
            return Some(buf.rev);
        }
        buf.content = content.to_string();
        buf.rev += 1;
        let rev = buf.rev;
        fanout(
            user,
            "",
            Some(path),
            ServerMsg::Resync {
                path: path.to_string(),
                rev,
                content: content.to_string(),
                conflict: false,
            },
        );
        Some(rev)
    }

    pub fn rev(&self, user_id: i64, path: &str) -> Option<u64> {
        let inner = self.inner.lock().expect("live lock");
        inner
            .users
            .get(&user_id)
            .and_then(|u| u.notes.get(path))
            .map(|b| b.rev)
    }
}

pub struct Persist {
    pub path: String,
    pub content: String,
    pub rev: u64,
}

fn peers_on(user: &UserLive, path: &str, except: &str) -> Vec<Peer> {
    user.conns
        .iter()
        .filter(|(id, c)| *id != except && c.path.as_deref() == Some(path))
        .map(|(id, c)| Peer {
            client_id: id.clone(),
            from: c.cursor.map(|c| c.0).unwrap_or(0),
            to: c.cursor.map(|c| c.1).unwrap_or(0),
        })
        .collect()
}

fn fanout(user: &UserLive, except: &str, path: Option<&str>, msg: ServerMsg) {
    for (id, conn) in &user.conns {
        if id == except {
            continue;
        }
        if let Some(path) = path {
            if conn.path.as_deref() != Some(path) {
                continue;
            }
        }
        let _ = conn.tx.send(msg.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair() -> (
        LiveHub,
        mpsc::UnboundedReceiver<ServerMsg>,
        mpsc::UnboundedReceiver<ServerMsg>,
    ) {
        let hub = LiveHub::new();
        let (a_tx, a_rx) = mpsc::unbounded_channel();
        let (b_tx, b_rx) = mpsc::unbounded_channel();
        hub.connect(1, "a", a_tx);
        hub.connect(1, "b", b_tx);
        (hub, a_rx, b_rx)
    }

    fn drain(rx: &mut mpsc::UnboundedReceiver<ServerMsg>) -> Vec<ServerMsg> {
        let mut out = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            out.push(msg);
        }
        out
    }

    #[test]
    fn change_broadcasts_to_peer_not_sender() {
        let (hub, mut a_rx, mut b_rx) = pair();
        drain(&mut a_rx);
        drain(&mut b_rx);
        hub.open(1, "a", "ideas/one", Some("hello"), "hello");
        hub.open(1, "b", "ideas/one", Some("hello"), "hello");
        drain(&mut a_rx);
        drain(&mut b_rx);
        let persist = hub
            .change(
                1,
                "a",
                Change {
                    path: "ideas/one".into(),
                    rev: 0,
                    content: "hello!".into(),
                    from: 5,
                    to: 5,
                    insert: "!".into(),
                },
            )
            .unwrap();
        assert_eq!(persist.rev, 1);
        assert!(drain(&mut a_rx).is_empty());
        let msgs = drain(&mut b_rx);
        assert!(msgs.iter().any(|m| matches!(
            m,
            ServerMsg::Change {
                rev: 1,
                insert,
                ..
            } if insert == "!"
        )));
    }

    #[test]
    fn stale_rev_resyncs_sender() {
        let (hub, mut a_rx, mut b_rx) = pair();
        drain(&mut a_rx);
        drain(&mut b_rx);
        hub.open(1, "a", "n", Some("x"), "x");
        hub.open(1, "b", "n", Some("x"), "x");
        drain(&mut a_rx);
        drain(&mut b_rx);
        hub.change(
            1,
            "a",
            Change {
                path: "n".into(),
                rev: 0,
                content: "y".into(),
                from: 0,
                to: 1,
                insert: "y".into(),
            },
        );
        drain(&mut a_rx);
        drain(&mut b_rx);
        assert!(hub
            .change(
                1,
                "b",
                Change {
                    path: "n".into(),
                    rev: 0,
                    content: "z".into(),
                    from: 0,
                    to: 1,
                    insert: "z".into(),
                },
            )
            .is_none());
        assert!(drain(&mut b_rx)
            .iter()
            .any(|m| matches!(m, ServerMsg::Resync { rev: 1, content, .. } if content == "y")));
    }

    #[test]
    fn other_user_isolated() {
        let hub = LiveHub::new();
        let (a_tx, mut a_rx) = mpsc::unbounded_channel();
        let (c_tx, mut c_rx) = mpsc::unbounded_channel();
        hub.connect(1, "a", a_tx);
        hub.connect(2, "c", c_tx);
        drain(&mut a_rx);
        drain(&mut c_rx);
        hub.open(1, "a", "n", Some("x"), "x");
        hub.open(2, "c", "n", Some("x"), "x");
        drain(&mut a_rx);
        drain(&mut c_rx);
        hub.change(
            1,
            "a",
            Change {
                path: "n".into(),
                rev: 0,
                content: "y".into(),
                from: 0,
                to: 1,
                insert: "y".into(),
            },
        );
        assert!(drain(&mut c_rx).is_empty());
    }

    #[test]
    fn disconnect_sends_gone() {
        let (hub, mut a_rx, mut b_rx) = pair();
        drain(&mut a_rx);
        drain(&mut b_rx);
        hub.open(1, "a", "n", Some("x"), "x");
        hub.open(1, "b", "n", Some("x"), "x");
        drain(&mut a_rx);
        drain(&mut b_rx);
        hub.disconnect(1, "a");
        assert!(drain(&mut b_rx)
            .iter()
            .any(|m| matches!(m, ServerMsg::Gone { client_id } if client_id == "a")));
    }

    #[test]
    fn push_merges_offline_forks() {
        let (hub, mut a_rx, mut b_rx) = pair();
        drain(&mut a_rx);
        drain(&mut b_rx);
        hub.open(1, "a", "n", Some("one\ntwo\n"), "one\ntwo\n");
        drain(&mut a_rx);
        let persist = hub.push(1, "a", "n", "one\ntwo\n", "ONE\ntwo\n").unwrap();
        assert!(persist.content.contains("ONE"));
        hub.open(1, "b", "n", None, "one\nTWO\n");
        drain(&mut b_rx);
        let persist = hub.push(1, "b", "n", "one\ntwo\n", "one\nTWO\n").unwrap();
        assert!(persist.content.contains("ONE"));
        assert!(persist.content.contains("TWO"));
        assert!(!persist.content.contains("<<<<<<<"));
    }
}
