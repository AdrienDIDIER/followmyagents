// Configuration persistante de l'app (token, port, préférences, position).
// Stockée dans <dossier de config>/config.json. Sans dépendance à Electron,
// pour être partagée avec le CLI de l'installeur.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Prefs } from "@shared/types";
import { DEFAULT_PORT } from "./server";

export const APP_NAME = "FollowMyAgents";

export interface AppConfig {
  token: string;
  port: number;
  prefs: Prefs;
  /** position du panneau détaché */
  detachedPos?: { x: number; y: number };
}

export const DEFAULT_PREFS: Prefs = {
  sound: true,
  detached: false,
  openAtLogin: false,
  notifications: true,
  pendingTimeoutSec: 580,
  autoRemoveDoneMin: 30,
};

/** Même dossier que app.getPath("userData") d'Electron. */
export function defaultConfigDir(): string {
  if (process.env.FMA_USER_DATA) return process.env.FMA_USER_DATA;
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), APP_NAME);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", APP_NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), APP_NAME);
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function loadConfig(dir = defaultConfigDir()): AppConfig {
  const file = path.join(dir, "config.json");
  let raw: Partial<AppConfig> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* premier lancement ou fichier illisible */
  }
  const cfg: AppConfig = {
    token: typeof raw.token === "string" && /^[0-9a-f]{32,}$/.test(raw.token) ? raw.token : newToken(),
    port: typeof raw.port === "number" && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULT_PORT,
    prefs: { ...DEFAULT_PREFS, ...(raw.prefs ?? {}) },
    detachedPos: raw.detachedPos,
  };
  if (raw.token !== cfg.token) saveConfig(cfg, dir);
  return cfg;
}

export function saveConfig(cfg: AppConfig, dir = defaultConfigDir()): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "config.json");
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, file);
}
