import { contextBridge, ipcRenderer } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

import type {
  BinaryValidation,
  GatewayStatus,
  LogLine,
} from "./gateway/types";

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

// Gateway namespace: thin async shims over ipcMain handlers in src/main.ts.
// The renderer never sees ipcRenderer directly thanks to contextIsolation;
// it only gets the wrapped functions through contextBridge.
const gatewayBridge = {
  start: (configPath?: string): Promise<void> =>
    ipcRenderer.invoke("gateway:start", configPath) as Promise<void>,
  stop: (): Promise<void> =>
    ipcRenderer.invoke("gateway:stop") as Promise<void>,
  status: (): Promise<GatewayStatus> =>
    ipcRenderer.invoke("gateway:status") as Promise<GatewayStatus>,
  setBinaryPath: (absPath: string): Promise<BinaryValidation> =>
    ipcRenderer.invoke("gateway:setBinaryPath", absPath) as Promise<BinaryValidation>,
  getBinaryPath: (): Promise<string | null> =>
    ipcRenderer.invoke("gateway:getBinaryPath") as Promise<string | null>,
  pickBinary: (): Promise<BinaryValidation | null> =>
    ipcRenderer.invoke("gateway:pickBinary") as Promise<BinaryValidation | null>,
  onLog: (handler: (line: LogLine) => void): (() => void) => {
    const wrapped = (_evt: unknown, line: LogLine): void => handler(line);
    ipcRenderer.on("gateway:log", wrapped);
    return () => ipcRenderer.removeListener("gateway:log", wrapped);
  },
  onStateChange: (handler: (s: GatewayStatus) => void): (() => void) => {
    const wrapped = (_evt: unknown, s: GatewayStatus): void => handler(s);
    ipcRenderer.on("gateway:state", wrapped);
    return () => ipcRenderer.removeListener("gateway:state", wrapped);
  },
};

const desktopBridge = {
  version: meta.version ?? "0.1.0",
  commit: meta.commit ?? "unknown",
  env: meta.env === "dev" || meta.env === "staging" ? meta.env : "prod",
  platform: process.platform,
  arch: process.arch,
  gateway: gatewayBridge,
};

contextBridge.exposeInMainWorld("relaygate", desktopBridge);

export type DesktopBridge = typeof desktopBridge;
