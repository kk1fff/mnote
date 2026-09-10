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

Browser and **mnote Remote** always use that invite + password flow. `POST /api/auth/login` never accepts an empty password. `POST /api/setup` stays loopback + username/password.

## Electron

Two packaged apps share the Vue UI. “Desktop” in visual-review viewports means a wide browser window, not Electron.

- **mnote** (`full`) — local folder is the secret. First screen is `/setup` (folder + Open, no password or username). Reopen starts the sidecar on `127.0.0.1`, unlocks via `POST /api/desktop/session`, and shows notes. No sign-out, account, or password UI. Sidebar folder chip: Show in folder, Change folder.
- **mnote Remote** (`remote`) — `/connect` then the same login as the browser.

`POST /api/desktop/session` exists only when the sidecar is spawned with `MNOTE_SIDECAR_UNLOCK` **and** bind is loopback. Default `mnote serve` must 404 that route. A multi-user folder is rejected.

## Dev and checks

```bash
make dev

make test
```

API is Rust (`src/`). Web is Vue + Vite (`web/`). Vite proxies `/api` to `127.0.0.1:3000`. The `test` service is the required full validation path: it runs Rust tests and Clippy; web unit, coverage, typecheck, and browser E2E; unpackaged and packaged Electron E2E under Xvfb; Electron visual review; and web visual review. It fails if an E2E test is skipped. Mac packaging commands remain release checks, not a substitute for the container suite.

The test container bind-mounts the repo and overlays generated dirs with Compose volumes. Visual PNGs remain on the host at `web/artifacts/visual/` and `desktop/artifacts/visual/` and are chowned to the host user on exit. If `make dev` hits `EACCES`, run `make fix-perms`.

## Visual review

If a change is visual (UI, CSS, layout, theme, or chrome), show a preview in the proposal before implementing. Match the existing design language: typography, spacing, color, radius, motion, and component patterns already in the app. Do not invent a parallel look.

After any visual, CSS, layout, or theme change, capture screenshots and inspect them. Do not treat unit tests as enough.

For every new user-facing feature, add or update a corresponding visual-review scenario that opens its primary UI state. Every new page must have a visual-review scenario. Cover affected desktop and mobile states, plus light and dark themes when the feature has a surface, sheet, menu, or overlay. Add an interaction/e2e test when the feature submits data or changes persisted state.

1. Run the container suite, which starts isolated API and Vite processes and creates a throwaway `visual` account:
   ```bash
   make test
   ```
   The first visual login sets its password from `password1` to `visualpass1`.
2. Read every PNG in `web/artifacts/visual/` and `desktop/artifacts/visual/` with the image Read tool. Fix issues, then rerun the container suite.

Required shots: login light/dark, note desktop light/dark, title editing, history, park capture, parked list/detail, mobile note, mobile More menu, mobile nav, picker light/dark, picker recent light/dark, picker favorites light, picker mobile, picker recent mobile, images page light/dark, images page mobile, tags row light/dark/mobile, tags overflow, tags long folder, sidebar calendar folded light/dark/mobile, sidebar calendar mid-fold light/dark, mode toggle edit/preview/mid-drag light/dark.

Required Electron shots: connect light/dark, connect error light/dark, setup light/dark, note light/dark, folder popover light/dark, note mobile light/dark.

Check all of the following:

- Header height does not change when the title or folder becomes an input.
- Mobile top bar stays one row (Menu, title, More). Actions must not wrap.
- History and parked sheets have a fixed shell. Selecting a revision or parked item must not move the page underneath or resize the chrome.
- The picker overlay stays put when Recent or Favorites opens. Input chrome must not jump; the page underneath must not move.
- Light and dark both keep editor, sidebar, and dialog text readable against their backgrounds.
- Empty or short content still looks designed: no raw unstyled boxes, clipped buttons, or overlapping chrome.
- Folder-row tags are chips immediately after the folder. Hide the tags node when there are none, and while the title/folder are being edited (folder input takes the full row). A long folder ellipsizes (full path on hover) and is capped at ~50% width when chips are visible; extra chips scroll sideways with an edge fade. Tags must not overlap Preview or More. Header height must not change.
