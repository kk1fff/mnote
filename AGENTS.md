# Agent instructions

## Data directory

All persistent state is under one folder. Default `./data`. Override with `--data` or `MNOTE_DATA`. In Docker this is `/data` (the volume to mount).

```
$data/
  db/mnote.db
  vaults/<username>/notes/
  vaults/<username>/assets/
  vaults/<username>/history/<note-id>/
  logs/mnote.log.YYYY-MM-DD
```

Do not store notes, sqlite, or logs anywhere else. A legacy `$data/mnote.db` is moved to `$data/db/mnote.db` on startup.

## First-time user flow

There is no self-signup.

1. Admin creates the account and sends the printed invite:
   ```bash
   cargo run -- --data data user add alice
   # docker: docker compose exec mnote mnote user add alice
   ```
2. The person logs in with that username and temporary password.
3. If the password has never been set, or is still the temporary password (`must_change_password`), the app must send them to set a password. Notes stay locked until they choose a **different** password.
4. Password reset is the same invite + forced set:
   ```bash
   cargo run -- --data data user reset-password alice
   ```

`MNOTE_PUBLIC_URL` (default `http://127.0.0.1:3000`) is the URL printed in the invite.

## Dev and checks

```bash
cargo run -- --data data serve
cd web && npm run dev

cargo test
cargo clippy --all-targets -- -D warnings
cd web && npm test && npm run typecheck && npm run test:e2e
```

API is Rust (`src/`). Web is Vue + Vite (`web/`). Vite proxies `/api` to `127.0.0.1:3000`.
