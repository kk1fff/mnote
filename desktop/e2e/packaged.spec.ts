import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopRoot } from "./env";

test.skip(process.env.MNOTE_PACKAGED !== "1", "set MNOTE_PACKAGED=1 after make desktop-mac");
test.skip(process.platform !== "darwin", "mac only");

function appBinary(kind: "full" | "remote"): string {
  const product = kind === "full" ? "mnote" : "mnote Remote";
  const roots = [
    path.join(desktopRoot(), "release", kind, "mac-arm64", `${product}.app`),
    path.join(desktopRoot(), "release", kind, "mac", `${product}.app`),
  ];
  for (const root of roots) {
    const bin = path.join(root, "Contents", "MacOS", product);
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error(`missing packaged ${product}.app`);
}

test("packaged apps open their first screen", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mnote-packaged-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "mnote-packaged-data-"));
  const remote = await electron.launch({
    executablePath: appBinary("remote"),
    args: ["--disable-gpu"],
    env: { ...process.env, MNOTE_E2E_USERDATA: userData, MNOTE_FLAVOR: "remote" },
  });
  const remotePage = await remote.firstWindow();
  await expect(remotePage.getByText("Connect to your server")).toBeVisible({ timeout: 20_000 });
  await remote.close();

  const full = await electron.launch({
    executablePath: appBinary("full"),
    args: ["--disable-gpu"],
    env: {
      ...process.env,
      MNOTE_E2E_USERDATA: `${userData}-full`,
      MNOTE_E2E_DATA: data,
      MNOTE_FLAVOR: "full",
    },
  });
  const fullPage = await full.firstWindow();
  await expect(fullPage.getByText("Notes live in a folder")).toBeVisible({ timeout: 20_000 });
  await full.close();
});
