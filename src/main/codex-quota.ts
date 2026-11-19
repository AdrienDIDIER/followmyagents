// Quota Codex (D25) : demandé à Codex lui-même via son app-server
// (`account/rateLimits/read`, protocole JSON-RPC documenté par
// `codex app-server generate-json-schema`). L'app ne lit pas la connexion Codex.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QuotaLimit, QuotaView } from "@shared/types";

// ---------- logique pure ----------

interface Window {
  usedPercent?: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

/** Libellé d'une fenêtre, identique pour Claude et Codex : « 5 h », « Semaine », « 30 jours »… */
export function windowLabel(mins: number | null | undefined): string {
  if (!mins) return "Limite";
  if (mins <= 24 * 60) return `${Math.round(mins / 60)} h`;
  if (mins === 7 * 24 * 60) return "Semaine";
  return `${Math.round(mins / 1440)} jours`;
}

/** Réponse de account/rateLimits/read → limites affichables. */
export function parseCodexRateLimits(res: unknown): { limits: QuotaLimit[]; plan?: string } {
  const r = (res ?? {}) as Record<string, any>;
  const snap = r.rateLimits ?? r.rateLimitsByLimitId?.codex;
  if (!snap || typeof snap !== "object") return { limits: [] };
  const reached = Boolean(snap.rateLimitReachedType) || r.ordinaryUsageAllowed === false;
  const limits: (QuotaLimit & { mins: number })[] = [];
  for (const [key, w] of [
    ["primary", snap.primary as Window | null],
    ["secondary", snap.secondary as Window | null],
  ] as const) {
    if (!w || typeof w.usedPercent !== "number") continue;
    const pct = Math.max(0, Math.min(100, w.usedPercent));
    limits.push({
      mins: w.windowDurationMins ?? Number.MAX_SAFE_INTEGER,
      kind: `codex_${key}`,
      label: windowLabel(w.windowDurationMins),
      percent: pct,
      severity: reached || pct >= 90 ? "critical" : pct >= 75 ? "warning" : "normal",
      resetsAt: typeof w.resetsAt === "number" ? w.resetsAt * 1000 : undefined,
    });
  }
  // fenêtre la plus courte d'abord (5 h, puis semaine…)
  limits.sort((a, b) => a.mins - b.mins);
  return { limits: limits.map(({ mins: _m, ...l }) => l), plan: typeof snap.planType === "string" ? snap.planType : undefined };
}

/** Emplacements possibles du binaire codex (extension VS Code, app Codex, PATH). */
export function codexBinaryCandidates(home = os.homedir(), platform: NodeJS.Platform = process.platform): string[] {
  const exe = platform === "win32" ? "codex.exe" : "codex";
  const out: string[] = [];
  const ext = path.join(home, ".vscode", "extensions");
  try {
    for (const d of fs.readdirSync(ext).filter((x) => x.startsWith("openai.chatgpt-")).sort().reverse()) {
      const bin = path.join(ext, d, "bin");
      try {
        for (const plat of fs.readdirSync(bin)) out.push(path.join(bin, plat, exe));
      } catch {
        /* pas de bin */
      }
    }
  } catch {
    /* pas d'extensions */
  }
  if (platform === "darwin") {
    out.push("/Applications/Codex.app/Contents/Resources/codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex", path.join(home, ".local", "bin", "codex"));
  } else if (platform === "win32") {
    out.push(path.join(home, "AppData", "Roaming", "npm", "codex.cmd"));
  } else {
    out.push("/usr/local/bin/codex", "/usr/bin/codex", path.join(home, ".local", "bin", "codex"));
  }
  return out;
}

// ---------- effets ----------

export type RateLimitsReader = (bin: string) => Promise<unknown>;

/** Lance `codex app-server`, initialise, lit les limites, puis arrête le processus. */
export const readViaAppServer: RateLimitsReader = (bin) =>
  new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE"));
    const child = spawn(bin, ["app-server"], { env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const timer = setTimeout(() => finish(new Error("délai dépassé")), 15000);
    let buf = "";
    let done = false;
    const finish = (err: Error | null, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      err ? reject(err) : resolve(value);
    };
    const send = (o: object) => child.stdin.write(JSON.stringify(o) + "\n");
    child.on("error", (e) => finish(e));
    child.on("exit", () => finish(new Error("codex s'est arrêté")));
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 1) {
          send({ jsonrpc: "2.0", method: "initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: { excludeResetCreditDetails: true } });
        } else if (m.id === 2) {
          m.error ? finish(new Error(m.error.message ?? "erreur Codex")) : finish(null, m.result);
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "followmyagents", version: "1" } } });
  });

export interface CodexQuotaDeps {
  candidates?: () => string[];
  exists?: (p: string) => boolean;
  read?: RateLimitsReader;
  now?: () => number;
  onChange?: (q: QuotaView) => void;
}

export class CodexQuotaWatcher {
  view: QuotaView = { state: "loading", limits: [] };
  private busy = false;
  constructor(private deps: CodexQuotaDeps = {}) {}

  private set(v: QuotaView) {
    this.view = v;
    this.deps.onChange?.(v);
  }

  /** Binaire Codex utilisable, ou undefined si Codex n'est pas installé. */
  binary(): string | undefined {
    const exists = this.deps.exists ?? fs.existsSync;
    return (this.deps.candidates ?? codexBinaryCandidates)().find((p) => exists(p));
  }

  async refresh(): Promise<QuotaView> {
    if (this.busy) return this.view;
    this.busy = true;
    try {
      const bin = this.binary();
      if (!bin) {
        this.set({ state: "disabled", limits: [] }); // Codex absent : rien à afficher
        return this.view;
      }
      const { limits, plan } = parseCodexRateLimits(await (this.deps.read ?? readViaAppServer)(bin));
      if (limits.length === 0) this.set({ state: "unavailable", limits: [], message: "Quota Codex non disponible (connecté à Codex ?)" });
      else this.set({ state: "ok", limits, plan, fetchedAt: (this.deps.now ?? Date.now)() });
    } catch (e) {
      this.set({ ...this.view, state: this.view.limits.length ? "stale" : "unavailable", message: `Quota Codex indisponible (${(e as Error).message})` });
    } finally {
      this.busy = false;
    }
    return this.view;
  }
}
