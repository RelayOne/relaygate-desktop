import {
  app,
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  Tray,
  dialog,
  nativeImage,
} from "electron";
import * as path from "node:path";
import { GatewayController } from "./gateway/controller";
import type { GatewayStatus } from "./gateway/types";

export interface CreateTrayOpts {
  gateway: GatewayController;
  mainWindow: () => BrowserWindow | null;
  quit: () => void;
}

function trayIconFilename(): string {
  switch (process.platform) {
    case "darwin":
      return "tray-iconTemplate.png";
    case "win32":
      return "tray-icon.png";
    default:
      return "tray-icon-linux.png";
  }
}

function statusLabel(status: GatewayStatus): string {
  if (!status.binaryPath) return "Gateway: not configured";
  switch (status.state) {
    case "running":
      return status.listenAddr
        ? `Gateway: running on ${status.listenAddr}`
        : "Gateway: running";
    case "starting":
      return "Gateway: starting...";
    case "stopping":
      return "Gateway: stopping...";
    case "errored":
      return status.lastError
        ? `Gateway: errored — ${truncate(status.lastError, 60)}`
        : "Gateway: errored";
    case "stopped":
    default:
      return status.binaryVersion
        ? `Gateway: stopped (v${status.binaryVersion})`
        : "Gateway: stopped";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function buildTrayMenu(
  status: GatewayStatus,
  opts: CreateTrayOpts,
): Menu {
  const isMac = process.platform === "darwin";
  const isStopped = status.state === "stopped" || status.state === "errored";
  const isRunning = status.state === "running";
  const hasBinary = !!status.binaryPath;

  const template: MenuItemConstructorOptions[] = [
    {
      label: "Show Dashboard",
      click: () => {
        const win = opts.mainWindow();
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    ...(isMac
      ? ([
          {
            label: "Hide Dashboard",
            click: () => opts.mainWindow()?.hide(),
          },
        ] as MenuItemConstructorOptions[])
      : []),
    { type: "separator" },
    {
      label: statusLabel(status),
      enabled: false,
    },
    {
      label: "Start Gateway",
      enabled: isStopped && hasBinary,
      click: () => {
        void opts.gateway.start().catch((err: Error) =>
          process.stderr.write(`[tray] gateway start failed: ${err.message}\n`),
        );
      },
    },
    {
      label: "Stop Gateway",
      enabled: isRunning,
      click: () => {
        void opts.gateway.stop().catch((err: Error) =>
          process.stderr.write(`[tray] gateway stop failed: ${err.message}\n`),
        );
      },
    },
    {
      label: "Open Logs...",
      click: () => {
        const win = opts.mainWindow();
        if (win) {
          win.show();
          win.webContents.send("tray:open-logs");
        }
      },
    },
    {
      label: "Configure Binary...",
      click: () => {
        const win = opts.mainWindow();
        const props = {
          properties: ["openFile"] as Array<"openFile">,
          title: "Select relaygate binary",
        };
        const promise = win
          ? dialog.showOpenDialog(win, props)
          : dialog.showOpenDialog(props);
        void promise.then((result) => {
          if (result.canceled || !result.filePaths[0]) return;
          opts.gateway.setBinaryPath(result.filePaths[0]);
        });
      },
    },
    { type: "separator" },
    {
      label: "Quit RelayGate",
      click: () => opts.quit(),
    },
  ];

  return Menu.buildFromTemplate(template);
}

export function createTray(opts: CreateTrayOpts): Tray | null {
  const iconPath = path.join(app.getAppPath(), "assets/tray", trayIconFilename());
  let tray: Tray;
  try {
    const image = nativeImage.createFromPath(iconPath);
    if (process.platform === "darwin") {
      image.setTemplateImage(true);
    }
    tray = new Tray(image);
  } catch (err) {
    // Linux without StatusNotifierItem support (some headless / minimal
    // GNOME setups), or other tray construction failure. Log and continue
    // without a tray; window-close should NOT then be intercepted (caller
    // checks return value).
    process.stderr.write(
      `[tray] construction failed (continuing without tray): ${(err as Error).message}\n`,
    );
    return null;
  }

  tray.setToolTip("RelayGate");
  tray.setContextMenu(buildTrayMenu(opts.gateway.getStatus(), opts));

  // Subscribe to gateway state changes to rebuild the menu.
  // GatewayControllerOpts.onStateChange already exists — we wire a listener
  // by extending the controller's existing emit in main.ts. Here we expose
  // a refresh hook the caller can invoke.
  (tray as Tray & { __refreshFromStatus?: (s: GatewayStatus) => void }).__refreshFromStatus =
    (status: GatewayStatus): void => {
      tray.setContextMenu(buildTrayMenu(status, opts));
    };

  // Single-click toggles dashboard visibility on Windows + Linux. macOS
  // expects tray icons to ONLY show the menu on click — toggling visibility
  // there creates jarring UX.
  if (process.platform !== "darwin") {
    tray.on("click", () => {
      const win = opts.mainWindow();
      if (!win) return;
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    });
  }

  return tray;
}
