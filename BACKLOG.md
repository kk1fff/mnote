# Backlog

Decided for this live-update slice, not built now.

## Out of scope

- Multi-user presence, sharing, or seeing another person's cursor
- CRDT / Yjs / operational transform
- Last-write-wins when two devices edited offline (we keep both sides instead)
- Live sidebar / search / backlinks refresh when another window creates a note
- Automated two-browser or two-phone e2e
- Sibling `*.conflict-*.md` copies (conflicts stay in the same file as markers)
- Rename / move / delete while another window has the note open
- Rebasing remote cursors across a merge (carets are dropped; next cursor event redraws them)

## Edge cases to revisit

- Safari / iOS killing the socket in the background; long offline, then both devices reconnect at once
- Very large notes (line-merge DP is capped; oversized diffs become one conflict block)
- One tab in preview and one in source during a conflicted merge
- PUT from a non-live client (CLI, old tab) while two live tabs are mid-merge
- `localStorage` draft quota / leftover drafts after path rename
- WebSocket proxy failures behind something other than the Vite `/api` proxy
