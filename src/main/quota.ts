// Quota Claude en direct (D23) : les mêmes chiffres que `/usage` dans Claude Code.
//
// Source : https://api.anthropic.com/api/oauth/usage — service INTERNE et non
// documenté d'Anthropic, utilisé par Claude Code. Il peut changer sans préavis :
// tout échec donne un état « indisponible », jamais une erreur bloquante.
//
// Jeton : celui de Claude Code, LU SEULEMENT (jamais écrit ni rafraîchi, pour ne
// pas perturber Claude Code) :
//   - Windows / Linux : ~/.claude/.credentials.json → claudeAiOauth.accessToken
//   - macOS : trousseau, élément « Claude Code-credentials » (macOS demande l'accès)
// Le jeton ne quitte la machine que vers api.anthropic.com, comme pour Claude Code.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QuotaLimit, QuotaView } from "@shared/types";

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface ClaudeToken {
  accessToken: string;
  expiresAt?: number;
  subscription?: string;
}

function fromCredentialsJson(text: string): ClaudeToken | null {
  try {
    const o = JSON.parse(text)?.claudeAiOauth;
    if (!o || typeof o.accessToken !== "string" || !o.accessToken) return null;
    return {
      accessToken: o.accessToken,
      expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : undefined,
      subscription: typeof o.subscriptionType === "string" ? o.subscriptionType : undefined,
    };
  } catch {
    return null;
  }
}

export interface TokenSourceDeps {
  platform?: NodeJS.Platform;
  home?: string;
  readFile?: (p: string) => string;
  /** macOS : lit le trousseau (security find-generic-password) */
  keychain?: () => Promise<string>;
}

const defaultKeychain = () =>
  new Promise<string>((resolve, reject) =>
    execFile("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { timeout: 15000 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    ),
  );

/** Jeton de Claude Code, ou null s'il est introuvable. */
export async function readClaudeToken(deps: TokenSourceDeps = {}): Promise<ClaudeToken | null> {
  const platform = deps.platform ?? process.platform;
  const home = deps.home ?? os.homedir();
  const read = deps.readFile ?? ((p: string) => fs.readFileSync(p, "utf8"));
  // le fichier existe sur Windows / Linux (et parfois sur macOS)
  try {
    const t = fromCredentialsJson(read(path.join(home, ".claude", ".credentials.json")));
    if (t) return t;
  } catch {
    /* pas de fichier */
  }
  if (platform === "darwin") {
    try {
      return fromCredentialsJson((await (deps.keychain ?? defaultKeychain)()).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Réponse de l'API → limites affichables (tableau `limits`, sinon five_hour / seven_day). */
export function parseUsage(json: unknown): QuotaLimit[] {
  const b = json as Record<string, any>;
  if (!b || typeof b !== "object") return [];
  const out: QuotaLimit[] = [];
  if (Array.isArray(b.limits) && b.limits.length > 0) {
    for (const l of b.limits) {
      if (!l || typeof l.percent !== "number") continue;
      out.push({
        kind: String(l.kind ?? l.group ?? "limit"),
        label: labelFor(String(l.kind ?? ""), String(l.group ?? "")),
        percent: Math.max(0, Math.min(100, l.percent)),
        severity: typeof l.severity === "string" ? l.severity : "normal",
        resetsAt: typeof l.resets_at === "string" ? Date.parse(l.resets_at) || undefined : undefined,
      });
    }
    return out;
  }
  for (const [key, label] of [
    ["five_hour", "Session"],
    ["seven_day", "Semaine"],
    ["seven_day_opus", "Semaine Opus"],
    ["seven_day_sonnet", "Semaine Sonnet"],
  ] as const) {
    const v = b[key];
    if (v && typeof v.utilization === "number") {
      const pct = Math.max(0, Math.min(100, v.utilization));
      out.push({
        kind: key,
        label,
        percent: pct,
        severity: pct >= 90 ? "critical" : pct >= 75 ? "warning" : "normal",
        resetsAt: typeof v.resets_at === "string" ? Date.parse(v.resets_at) || undefined : undefined,
      });
    }
  }
  return out;
}

function labelFor(kind: string, group: string): string {
  if (kind === "session" || group === "session") return "Session";
  if (kind === "weekly_all") return "Semaine";
  if (kind.startsWith("weekly_")) return `Semaine ${kind.slice(7).replace(/_/g, " ")}`;
  if (group === "weekly") return "Semaine";
  return kind.replace(/_/g, " ") || "Limite";
}

export interface QuotaDeps extends TokenSourceDeps {
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: (q: QuotaView) => void;
}

export class QuotaWatcher {
  view: QuotaView = { state: "loading", limits: [] };
  private token: ClaudeToken | null = null;
  private busy = false;
  constructor(private deps: QuotaDeps = {}) {}

  private set(v: QuotaView) {
    this.view = v;
    this.deps.onChange?.(v);
  }

  async refresh(): Promise<QuotaView> {
    if (this.busy) return this.view;
    this.busy = true;
    const now = (this.deps.now ?? Date.now)();
    try {
      // relit le jeton s'il manque ou s'il a expiré (Claude Code le renouvelle de son côté)
      if (!this.token || (this.token.expiresAt && this.token.expiresAt <= now)) this.token = await readClaudeToken(this.deps);
      if (!this.token) {
        this.set({ state: "unavailable", limits: [], message: "Connexion Claude Code introuvable" });
        return this.view;
      }
      if (this.token.expiresAt && this.token.expiresAt <= now) {
        this.set({ ...this.view, state: "expired", message: "Session Claude Code expirée : ouvrez Claude Code pour la renouveler" });
        return this.view;
      }
      const res = await (this.deps.fetch ?? fetch)(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${this.token.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "FollowMyAgents",
        },
      });
      if (res.status === 401 || res.status === 403) {
        this.token = null; // relu au prochain essai
        this.set({ ...this.view, state: "expired", message: "Session Claude Code expirée : ouvrez Claude Code pour la renouveler" });
        return this.view;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const limits = parseUsage(await res.json());
      if (limits.length === 0) {
        this.set({ state: "unavailable", limits: [], message: "Format de quota non reconnu" });
      } else {
        this.set({ state: "ok", limits, fetchedAt: now, plan: this.token.subscription });
      }
    } catch (e) {
      // garde les derniers chiffres connus, signale seulement l'échec
      this.set({ ...this.view, state: this.view.limits.length ? "stale" : "unavailable", message: `Quota indisponible (${(e as Error).message})` });
    } finally {
      this.busy = false;
    }
    return this.view;
  }
}
