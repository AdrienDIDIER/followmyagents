// « Jump » : met VS Code au premier plan sur l'onglet d'une session.
// 1. mettre au premier plan la bonne fenêtre VS Code (celle du dossier cwd) ;
// 2. ouvrir vscode://anthropic.claude-code/open?session=<id> : l'extension
//    révèle l'onglet de la session dans la fenêtre active.
// Voir docs/phase0.md (d) et DECISIONS D6 / D18.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readIdeWindows, titleCandidates, type IdeWindow } from "./ide";

export function sessionUri(sessionId: string): string {
  return `vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`;
}

export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Chemins possibles de la commande `code` sur macOS (une app lancée du Finder n'a pas le PATH du shell). */
export function macCodeCandidates(): string[] {
  return [
    "/usr/local/bin/code",
    "/opt/homebrew/bin/code",
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    path.join(process.env.HOME ?? "", "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
  ];
}

/**
 * Environnement des commandes lancées : sans ELECTRON_RUN_AS_NODE ni VSCODE_*.
 * Lancée depuis le terminal intégré de VS Code, l'app hérite de VSCODE_IPC_HOOK_CLI :
 * `code` parlerait alors à la fenêtre de ce terminal au lieu de choisir la bonne.
 */
export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "ELECTRON_RUN_AS_NODE" || k.startsWith("VSCODE_")) continue;
    out[k] = v;
  }
  return out;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (file: string, args: string[], timeoutMs: number) => Promise<RunResult>;
export type Launcher = (file: string, args: string[]) => void;

const defaultRun: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, env: cleanEnv() }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

const defaultLaunch: Launcher = (file, args) => {
  spawn(file, args, { detached: true, stdio: "ignore", env: cleanEnv() }).unref();
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JumpDeps {
  openExternal: (url: string) => Promise<void>;
  /** dossier contenant focus-window.ps1 / focus-window-mac.applescript */
  scriptsDir: string;
  platform?: NodeJS.Platform;
  log?: (m: string) => void;
  /** macOS : l'accès « Accessibilité » manque pour choisir la fenêtre */
  onAccessibilityDenied?: () => void;
  run?: Runner;
  launch?: Launcher;
  exists?: (p: string) => boolean;
  delay?: (ms: number) => Promise<void>;
  /** fenêtres VS Code déclarées dans ~/.claude/ide/*.lock (lues si absent) */
  ideWindows?: IdeWindow[];
}

export type FocusOutcome =
  | "focused" // la bonne fenêtre est au premier plan
  | "opened-folder" // le dossier a été (ré)ouvert dans VS Code
  | "activated-app" // VS Code activé sans pouvoir choisir la fenêtre
  | "failed";

export function isAccessibilityError(r: RunResult): boolean {
  return /-1719|-25211|-1743|assistive|accessibility|not allowed|n.est pas autoris/i.test(r.stderr + r.stdout);
}

export async function focusVsCodeWindow(cwd: string, deps: JumpDeps): Promise<FocusOutcome> {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  const launch = deps.launch ?? defaultLaunch;
  const exists = deps.exists ?? fs.existsSync;
  // dossier racine de la fenêtre VS Code qui contient la session (et noms à chercher dans les titres)
  const { names, root } = titleCandidates(cwd, deps.ideWindows ?? readIdeWindows(), platform);
  deps.log?.(`jump : racine ${root}, titres cherchés ${JSON.stringify(names)}`);

  if (platform === "win32") {
    const script = path.join(deps.scriptsDir, "focus-window.ps1");
    const r = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Process", "Code", "-Candidates", names.join("|")],
      4000,
    );
    deps.log?.(`focus-window.ps1 : ${r.stdout.trim() || r.stderr.trim()}`);
    if (r.stdout.startsWith("FOCUSED")) return "focused";
    if (r.stdout.startsWith("FALLBACK")) return "activated-app";
    return "failed";
  }

  if (platform === "darwin") {
    const openFolder = (): FocusOutcome => {
      if (cwd && exists(cwd)) {
        const code = macCodeCandidates().find((p) => exists(p));
        // `code <dossier>` réutilise la fenêtre déjà ouverte sur ce dossier, sinon en ouvre une
        // dossier racine de la fenêtre si connu (sinon `code` ouvrirait le sous-dossier dans une nouvelle fenêtre)
        const target = root && exists(root) ? root : cwd;
        if (code) launch(code, [target]);
        else launch("open", ["-a", "Visual Studio Code", target]);
        return "opened-folder";
      }
      launch("open", ["-a", "Visual Studio Code"]);
      return "activated-app";
    };
    const script = path.join(deps.scriptsDir, "focus-window-mac.applescript");
    const r = await run("osascript", [script, root, ...names], 4000);
    deps.log?.(`focus-window-mac : code=${r.code} ${r.stdout.trim()} ${r.stderr.trim()}`);
    if (r.stdout.startsWith("FOCUSED")) return "focused";
    if (r.stdout.startsWith("NOTFOUND") || r.stdout.startsWith("NOAPP")) return openFolder();
    if (isAccessibilityError(r)) {
      deps.onAccessibilityDenied?.();
      // sans Accessibilité on ne peut pas choisir la fenêtre : on active seulement VS Code
      // (ouvrir le dossier risquerait de créer une nouvelle fenêtre)
      launch("open", ["-a", "Visual Studio Code"]);
      return "activated-app";
    }
    return openFolder();
  }
  return "failed";
}

export async function jumpToSession(sessionId: string, cwd: string, deps: JumpDeps): Promise<FocusOutcome> {
  const platform = deps.platform ?? process.platform;
  const wait = deps.delay ?? sleep;
  const outcome = await focusVsCodeWindow(cwd, deps);
  // l'URI s'ouvre dans la fenêtre ACTIVE : laisser le temps au changement de fenêtre
  // (plus long si VS Code doit ouvrir le dossier)
  const ms = outcome === "opened-folder" ? 1200 : platform === "darwin" ? 450 : 200;
  await wait(ms);
  await deps.openExternal(sessionUri(sessionId));
  return outcome;
}
