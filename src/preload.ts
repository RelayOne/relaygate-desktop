import { contextBridge } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

// Read embedded build metadata directly from the bundled package.json.
// process.env.npm_package_* is unset in packaged Electron apps (only set
// when launched via `npm run`), so we mirror src/main.ts's approach and
// read the file at preload time. Errors fall back to safe defaults.
type EmbeddedMeta = { version?: string; commit?: string; env?: string };

function readEmbeddedMeta(): EmbeddedMeta {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")) as EmbeddedMeta;
  } catch {
    return {};
  }
}

const meta = readEmbeddedMeta();

const desktopBridge = {
  version: meta.version ?? "0.1.0",
  commit: meta.commit ?? "unknown",
  env: meta.env === "dev" || meta.env === "staging" ? meta.env : "prod",
  platform: process.platform,
  arch: process.arch,
};

contextBridge.exposeInMainWorld("relaygate", desktopBridge);

export type DesktopBridge = typeof desktopBridge;
