import { contextBridge } from "electron";

const desktopBridge = {
  version: process.env.npm_package_version ?? "0.1.0",
  platform: process.platform,
  arch: process.arch,
};

contextBridge.exposeInMainWorld("relaygate", desktopBridge);

export type DesktopBridge = typeof desktopBridge;
