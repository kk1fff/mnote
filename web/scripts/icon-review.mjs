import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the real Vue component and application theme tokens, not SVG copies.
const groups = {
  content: [
    ["note", "Note"], ["notes", "Notes collection"], ["plus", "New note"],
    ["journal", "Journal"], ["calendar", "Calendar"], ["image", "Images page"],
    ["insertImage", "Insert image"], ["images", "Manage images"],
    ["favorites", "Favorite"], ["tag", "Tags"], ["backlinks", "Backlinks"],
    ["park", "Park a thought"], ["history", "Revision history"],
  ],
  actions: [
    ["search", "Search"], ["menu", "Menu"], ["more", "More actions"],
    ["tab", "Tab"], ["addTab", "New tab"], ["close", "Close tab"],
    ["edit", "Source"], ["preview", "Preview"], ["splitView", "Open beside"],
    ["trash", "Delete"], ["panelClose", "Close sidebar"], ["panelOpen", "Open sidebar"],
    ["chevronLeft", "Previous month"], ["chevronRight", "Next month"], ["chevronDown", "Expand / collapse"],
  ],
  appearance: [
    ["appearance", "Appearance"], ["systemMode", "Follow system"],
    ["lightMode", "Light theme"], ["darkMode", "Dark theme"], ["user", "Account"],
    ["folder", "Notes folder"], ["move", "Change folder"], ["star", "Favorite tab"],
  ],
};

export async function auditIcons(page) {
  const defects = await page.locator("svg.nav-icon:visible").evaluateAll(icons => icons.flatMap(icon => {
    const name = icon.getAttribute("data-icon");
    const box = icon.getBBox();
    if (!icon.querySelector("path, rect, circle")) return [`${name}: missing drawing`];
    if (icon.getAttribute("viewBox") !== "0 0 24 24") return [`${name}: mismatched grid`];
    if (box.width <= 0 || box.height <= 0) return [`${name}: empty drawing`];
    if (box.x < 0 || box.y < 0 || box.x + box.width > 24 || box.y + box.height > 24) return [`${name}: drawing outside canvas`];
    return [];
  }));
  if (defects.length) throw new Error(defects.join("\n"));
}

export async function reviewIcons(browser, url, out) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`${url}/login`, { waitUntil: "networkidle" });
    // Every literal and dynamic icon reference must be represented on the sheets.
    const covered = new Set(Object.values(groups).flat().map(([name]) => name));
    const src = fileURLToPath(new URL("../src/", import.meta.url));
    for (const entry of fs.readdirSync(src, { recursive: true })) {
      if (!entry.endsWith(".vue") || entry.endsWith("NavIcon.vue")) continue;
      const code = fs.readFileSync(path.join(src, entry), "utf8");
      const names = [
        ...Array.from(code.matchAll(/<NavIcon\s+name="([^"]+)"/g), m => m[1]),
        ...Array.from(code.matchAll(/icon: "([^"]+)"/g), m => m[1]),
        ...Array.from(code.matchAll(/<NavIcon\s+:name="([^"]+)"/g))
          .flatMap(m => Array.from(m[1].matchAll(/'([^']+)'/g), part => part[1])),
      ];
      for (const name of names) {
        if (!covered.has(name)) throw new Error(`Icon review is missing ${name} from ${entry}`);
      }
    }

    await page.evaluate(async () => {
      const { createApp, h } = await import("/node_modules/.vite/deps/vue.js");
      const { default: NavIcon } = await import("/src/components/NavIcon.vue");
      document.getElementById("app").style.display = "none";
      const host = document.createElement("main");
      host.className = "icon-review";
      document.body.append(host);
      const style = document.createElement("style");
      style.textContent = `
        .icon-review { padding: 32px; background: var(--bg); min-height: 100vh; }
        .icon-review h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -.03em; }
        .icon-review p { margin: 0 0 24px; color: var(--text-muted); font-size: 13px; }
        .icon-review-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
        .icon-review-card { padding: 18px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
        .icon-review-large { display: flex; justify-content: center; margin-bottom: 12px; }
        .icon-review-label { font-size: 13px; font-weight: 600; text-align: center; }
        .icon-review-sizes, .icon-review-states { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; }
        .icon-review-sample { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 7px; }
        .icon-review-sample.hover { background: var(--accent-soft); }
        .icon-review-sample.selected { background: color-mix(in srgb, var(--text) 8%, transparent); }
        .icon-review-sample.primary { background: var(--accent); color: var(--accent-fg); }
        .icon-review-sample.primary .nav-icon { --icon-accent: currentColor; --icon-accent-soft: color-mix(in srgb, currentColor 22%, transparent); }
        .icon-review-sample.disabled { opacity: .5; }
        .icon-review-legend { font-size: 10px; color: var(--text-muted); text-align: center; margin-top: 8px; }
      `;
      document.head.append(style);
      let app;
      window.renderIconReview = (title, theme, items) => {
        app?.unmount();
        document.documentElement.dataset.theme = theme;
        app = createApp({
          render() {
            const icon = (name, size) => h(NavIcon, { name, style: { width: `${size}px`, height: `${size}px`, flex: `0 0 ${size}px` } });
            return [
              h("h1", `mnote · ${title} · ${theme}`),
              h("p", "Actual NavIcon component · 64px detail view · 14 / 16 / 20px production sizes · theme and state checks"),
              h("div", { class: "icon-review-grid" }, items.map(([name, label]) =>
                h("section", { class: "icon-review-card", "data-review-icon": name }, [
                  h("div", { class: "icon-review-large" }, icon(name, 64)),
                  h("div", { class: "icon-review-label" }, label),
                  h("div", { class: "icon-review-sizes" }, [14, 16, 20].map(size => icon(name, size))),
                  h("div", { class: "icon-review-states" }, ["hover", "selected", "primary", "disabled"].map(state =>
                    h("span", { class: `icon-review-sample ${state}` }, icon(name, 20)))),
                  h("div", { class: "icon-review-legend" }, "Hover · Selected · Primary · Disabled"),
                ]))),
            ];
          },
        });
        app.mount(host);
      };
    });
    for (const theme of ["light", "dark"]) {
      for (const [group, items] of Object.entries(groups)) {
        await page.evaluate(({ group, theme, items }) => window.renderIconReview(group, theme, items), { group, theme, items });
        await auditIcons(page);
        const file = path.join(out, `40-icons-${group}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
        console.log(file);
      }
    }
  } finally {
    await context.close();
  }
}
