# Interface icons

Used icons share a 24 × 24 canvas, 1.75-unit rounded strokes, and optical padding.
Keep stroke/fill attributes on the drawing elements or their group: `NavIcon.vue`
extracts the SVG contents and supplies its own outer SVG.

Outlines inherit `currentColor`; details use `--icon-accent` and
`--icon-accent-soft`, falling back to the app's light/dark theme tokens. Primary
buttons override both tokens so icons remain legible on accent backgrounds.
Avoid fixed colors, filters, and SVG IDs shared between component instances.

## Semantic distinctions

- `note`: written page; `notes`: page collection; `folder`: filesystem location.
- `new-note`: page + plus; `tab` / `add-tab`: browser tab / tab + plus.
- `image`: images navigation; `insert-image`: image + plus; `images`: collection.
- `journal`: bound notebook; `calendar`: date navigation.
- `park-a-thought`: capture a thought; `history`: previous revisions.
- `appearance`: light/dark split; `system-mode`: follow device settings.
- `edit`: source brackets (the action is labeled Source); `preview`: eye.
- `backlinks`: incoming links; `split-view`: open in the adjacent pane.
- `move`: change local folder; `sidebar-open` / `sidebar-close`: panel controls.
- `favorites`, `tags`, `search`, `trash`, `user`: familiar content/action symbols.
- `menu`, `more`, `close`, and chevrons: neutral control geometry.

`NavIcon.vue` retains aliases such as `star` / `favorites` and mirrored calendar
chevrons. The visual-review inventory in `web/scripts/icon-review.mjs` covers
every used name, including dynamic references and Electron-only folder icons.
It renders the actual component at 14, 16, 20, and 64px, checks for missing or
out-of-canvas drawings, and captures both themes and representative states.

The remaining legacy assets are reserved and not referenced by current UI:
about, attachment, collapse, duplicate, filter, help, inbox, link, rename,
settings, sort, and view-options. Review their geometry before introducing them
into a new surface.

Run `make test`, then inspect the `40-icons-*` sheets and the in-context web and
Electron screenshots. Automated checks do not replace inspection of curves,
stroke joins, optical alignment, contrast, and semantic distinctions.
