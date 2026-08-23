# mnote

Personal markdown notes for a small, locally hosted group (~10 users). Each person has a private vault. The daily note is the inbox; other pages are freeform markdown with `[[wiki-links]]`.

```
Vue SPA  --(cookie, same origin / Vite proxy)-->  Rust API  -->  /data (db, vaults, logs)
Admin CLI ----------------------------------------------------^
```

## Features

- Password accounts. Admin CLI creates users and issues a temporary password.
- First login always asks the user to set their own password
- Daily notes (`YYYY-MM-DD.md`), freeform pages, backlinks, full-text search
- Source-first editor (CodeMirror) with a preview toggle
- Paste or drop images into a note
- Notes stored as markdown on disk so you can backup or edit them elsewhere

## Data directory

All persistent state lives under one folder (`MNOTE_DATA`, default `./data`). Mount this path as a Docker volume.

```
data/                      # bind-mount this
  db/mnote.db              # users + sessions
  vaults/<user>/notes/     # markdown
  vaults/<user>/assets/    # pasted images
  vaults/<user>/history/   # edit snapshots per note id
  logs/mnote.log.YYYY-MM-DD
```

## First-time users

1. Admin creates an account and sends the printed invite to the person:

   ```bash
   cargo run -- --data data user add alice
   ```

   ```
   Created account 'alice'.

   Send them this:
     Open:                 http://127.0.0.1:3000
     Username:             alice
     Temporary password:   ...............

   They must choose a new password on first login.
   ```

2. They log in with that username and temporary password.
3. They are sent to **Set your password**. Notes stay locked until they choose a new one. Reusing the temporary password is rejected.

Forgot password: `cargo run -- --data data user reset-password alice` — same invite, same forced reset.

`MNOTE_PUBLIC_URL` (default `http://127.0.0.1:3000`) is what the invite prints as the open link.

## Requirements

- Rust 1.90+ (`cargo`)
- Node 22+ (`npm`)

## Development

From the repo root, run the API and the web app in two terminals.

```bash
# terminal 1 — API (http://127.0.0.1:3000)
cargo run -- --data data serve

# terminal 2 — Vue + Vite BFF proxy (http://127.0.0.1:5173)
cd web
npm install
npm run dev
```

Vite proxies `/api` to the Rust server and forwards the session cookie. Use the web app at http://127.0.0.1:5173.

```bash
cargo run -- --data data user list
```

## Tests

```bash
cargo test
cd web && npm test
cd web && npm run test:coverage
cd web && npm run typecheck
```

## Production (single process)

```bash
cd web && npm install && npm run build
cargo run --release -- --data data serve --bind 127.0.0.1:3000
```

Open http://127.0.0.1:3000. Set `MNOTE_SECURE_COOKIE=1` if you terminate TLS in front of the process.

## Docker

One volume, `/data`:

```bash
docker compose up --build -d
docker compose exec mnote mnote user add alice
```

Then open http://localhost:3000.

## API (cookie session)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness |
| POST | `/api/auth/login` | `{ username, password }` |
| POST | `/api/auth/logout` | clear session |
| GET | `/api/auth/me` | current user |
| POST | `/api/auth/password` | `{ password }` |
| GET | `/api/notes` | list |
| POST | `/api/notes` | `{ title, folder?, content? }` |
| GET/PUT | `/api/notes/daily/:date` | daily note |
| GET/PUT | `/api/notes/:id` | page |
| GET | `/api/notes/:id/history` | snapshot list |
| GET | `/api/notes/:id/history/:rev` | snapshot |
| POST | `/api/notes/:id/restore` | `{ rev }` restore body |
| GET | `/api/notes/recent` | recently opened notes |
| GET | `/api/notes/title-search?q=` | search notes by title, then folder |
| GET | `/api/favorites` | favorite notes |
| PUT/DELETE | `/api/favorites/:id` | favorite a note |
| GET | `/api/search?q=` | search |
| GET | `/api/backlinks/:id` | backlinks |
| POST | `/api/assets` | multipart field `file` |
| GET | `/api/assets/:id` | image |

Wiki links use `[[title]]` or `[[title|label]]`. Titles are unique. Daily notes are titled `YYYY-MM-DD`. File names stay on the server.
