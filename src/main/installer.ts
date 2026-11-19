// Installation / désinstallation des hooks FollowMyAgents dans un settings.json
// de Claude Code. Le chemin est toujours passé explicitement : les tests
// utilisent un fichier factice, jamais ~/.claude/settings.json.
//
// Règles :
// - sauvegarde horodatée du fichier avant toute écriture ;
// - fusion : on n'ajoute que nos propres groupes, à la fin de chaque événement ;
//   les hooks de l'utilisateur ne sont jamais modifiés ;
// - nos hooks sont reconnus à leur en-tête X-FMA-Token (HTTP) ou à la présence
//   de « X-FMA-Token » dans la commande (hooks command/curl) ;
// - écriture atomique (fichier temporaire + rename) ;
// - JSON invalide → on refuse d'écrire.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const TOKEN_HEADER = "X-FMA-Token";

export type QuestionMode = "permission" | "pretooluse";

export interface HookTarget {
  port: number;
  token: string;
  platform?: NodeJS.Platform;
  /** "permission" (défaut, D3) ou "pretooluse" (mécanisme du brief) */
  questionMode?: QuestionMode;
}

type HookDef = Record<string, unknown>;
interface MatcherGroup {
  matcher?: string;
  hooks: HookDef[];
  [k: string]: unknown;
}
type HooksMap = Record<string, MatcherGroup[]>;

/** Événements relayés en HTTP (échec silencieux quand l'app est fermée, vérifié en Phase 0). */
export const HTTP_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "UserPromptSubmit"] as const;
/** Événements relayés par un hook command + curl (HTTP non supporté ou erreur visible, voir D4). */
export const COMMAND_EVENTS = [
  "SessionStart",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd",
  "Notification",
  "TaskCreated",
  "TaskCompleted",
] as const;

export function defaultSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export function buildHookConfig(t: HookTarget): HooksMap {
  const base = `http://127.0.0.1:${t.port}`;
  const http = (route: string, timeout: number): HookDef => ({
    type: "http",
    url: `${base}${route}`,
    timeout,
    headers: { [TOKEN_HEADER]: t.token },
  });
  const curl = (t.platform ?? process.platform) === "win32" ? "curl.exe" : "curl";
  const command: HookDef = {
    type: "command",
    command: `${curl} -s -m 2 -X POST -H "Content-Type: application/json" -H "${TOKEN_HEADER}: ${t.token}" --data-binary "@-" ${base}/hook/event; exit 0`,
    timeout: 5,
  };
  const map: HooksMap = {
    PermissionRequest: [{ hooks: [http("/hook/permission", 600)] }],
  };
  for (const ev of HTTP_EVENTS) map[ev] = [{ hooks: [http("/hook/event", 5)] }];
  if (t.questionMode === "pretooluse") {
    map.PreToolUse = [{ matcher: "AskUserQuestion", hooks: [http("/hook/question", 600)] }, ...map.PreToolUse];
  }
  for (const ev of COMMAND_EVENTS) map[ev] = [{ hooks: [{ ...command }] }];
  return map;
}

export function isOurHook(h: unknown): boolean {
  if (!h || typeof h !== "object") return false;
  const hook = h as HookDef;
  const headers = hook.headers;
  if (headers && typeof headers === "object") {
    if (Object.keys(headers).some((k) => k.toLowerCase() === TOKEN_HEADER.toLowerCase())) return true;
  }
  return typeof hook.command === "string" && hook.command.includes(TOKEN_HEADER);
}

interface Loaded {
  exists: boolean;
  data: Record<string, unknown>;
  indent: string | number;
  raw: string;
}

function load(settingsPath: string): Loaded {
  if (!fs.existsSync(settingsPath)) return { exists: false, data: {}, indent: 2, raw: "" };
  const raw = fs.readFileSync(settingsPath, "utf8");
  if (raw.trim() === "") return { exists: true, data: {}, indent: 2, raw };
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`settings.json invalide (${(e as Error).message}) : aucune modification faite.`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("settings.json doit contenir un objet JSON : aucune modification faite.");
  }
  const m = /\n([ \t]+)"/.exec(raw);
  return { exists: true, data: data as Record<string, unknown>, indent: m ? m[1] : 2, raw };
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backup(settingsPath: string, raw: string, now: Date): string {
  let file = `${settingsPath}.fma-backup-${stamp(now)}`;
  for (let i = 1; fs.existsSync(file); i++) file = `${settingsPath}.fma-backup-${stamp(now)}-${i}`;
  fs.writeFileSync(file, raw);
  return file;
}

function writeAtomic(settingsPath: string, data: unknown, indent: string | number) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.fma-tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, indent) + "\n");
  fs.renameSync(tmp, settingsPath);
}

/** Retire nos hooks d'une carte de hooks. Renvoie le nombre de hooks retirés. */
function stripOurs(hooks: HooksMap): number {
  let removed = 0;
  for (const ev of Object.keys(hooks)) {
    const groups = hooks[ev];
    if (!Array.isArray(groups)) continue;
    const kept: MatcherGroup[] = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const ours = g.hooks.filter(isOurHook).length;
      if (ours === 0) {
        kept.push(g);
        continue;
      }
      removed += ours;
      const rest = g.hooks.filter((h) => !isOurHook(h));
      if (rest.length > 0) kept.push({ ...g, hooks: rest });
    }
    if (kept.length > 0) hooks[ev] = kept;
    else delete hooks[ev];
  }
  return removed;
}

export interface InstallResult {
  settingsPath: string;
  backupPath?: string;
  created: boolean;
}

export function installHooks(settingsPath: string, target: HookTarget, now = new Date()): InstallResult {
  const loaded = load(settingsPath);
  const data = loaded.data;
  if (data.hooks !== undefined && (typeof data.hooks !== "object" || data.hooks === null || Array.isArray(data.hooks))) {
    throw new Error("La clé \"hooks\" de settings.json n'est pas un objet : aucune modification faite.");
  }
  const hooks: HooksMap = (data.hooks as HooksMap) ?? {};
  stripOurs(hooks);
  const ours = buildHookConfig(target);
  for (const [ev, groups] of Object.entries(ours)) {
    hooks[ev] = [...(Array.isArray(hooks[ev]) ? hooks[ev] : []), ...groups];
  }
  data.hooks = hooks;
  const backupPath = loaded.exists ? backup(settingsPath, loaded.raw, now) : undefined;
  writeAtomic(settingsPath, data, loaded.indent);
  return { settingsPath, backupPath, created: !loaded.exists };
}

export interface UninstallResult {
  settingsPath: string;
  backupPath?: string;
  removed: number;
}

export function uninstallHooks(settingsPath: string, now = new Date()): UninstallResult {
  const loaded = load(settingsPath);
  if (!loaded.exists) return { settingsPath, removed: 0 };
  const data = loaded.data;
  const hooks = data.hooks as HooksMap | undefined;
  if (!hooks || typeof hooks !== "object") return { settingsPath, removed: 0 };
  const removed = stripOurs(hooks);
  if (removed === 0) return { settingsPath, removed: 0 };
  if (Object.keys(hooks).length === 0) delete data.hooks;
  const backupPath = backup(settingsPath, loaded.raw, now);
  writeAtomic(settingsPath, data, loaded.indent);
  return { settingsPath, backupPath, removed };
}

export interface HooksState {
  installed: boolean;
  /** installés avec le même port et le même token que l'app */
  upToDate: boolean;
  error?: string;
}

export function hooksState(settingsPath: string, target: HookTarget): HooksState {
  try {
    const { data } = load(settingsPath);
    const hooks = (data.hooks ?? {}) as HooksMap;
    const all = Object.values(hooks).flatMap((g) => (Array.isArray(g) ? g : [])).flatMap((g) => g?.hooks ?? []);
    const ours = all.filter(isOurHook);
    if (ours.length === 0) return { installed: false, upToDate: false };
    const expected = buildHookConfig(target);
    const expectedCount = Object.values(expected).reduce((n, g) => n + g.reduce((m, x) => m + x.hooks.length, 0), 0);
    const tokenOk = ours.every((h) => {
      const s = JSON.stringify(h);
      return s.includes(target.token) && s.includes(`:${target.port}/`);
    });
    return { installed: true, upToDate: tokenOk && ours.length === expectedCount };
  } catch (e) {
    return { installed: false, upToDate: false, error: (e as Error).message };
  }
}
