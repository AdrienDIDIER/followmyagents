// « Jump » : met VS Code au premier plan sur l'onglet d'une session.
// 1. mettre au premier plan la bonne fenêtre VS Code (celle du dossier cwd) ;
// 2. ouvrir vscode://anthropic.claude-code/open?session=<id> (révèle l'onglet).
// Voir docs/phase0.md (d) et DECISIONS D6.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

const run = (file: string, args: string[], timeoutMs: number) =>
  new Promise<string>((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (_err, stdout) => resolve(String(stdout ?? "")));
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JumpDeps {
  openExternal: (url: string) => Promise<void>;
  /** dossier contenant focus-window.ps1 */
  scriptsDir: string;
  platform?: NodeJS.Platform;
  log?: (m: string) => void;
}

export async function focusVsCodeWindow(cwd: string, deps: JumpDeps): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    const script = path.join(deps.scriptsDir, "focus-window.ps1");
    const out = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Process", "Code", "-TitleContains", folderName(cwd)],
      4000,
    );
    deps.log?.(`focus-window: ${out.trim()}`);
    return out.startsWith("FOCUSED");
  }
  if (platform === "darwin") {
    if (cwd && fs.existsSync(cwd)) {
      const code = macCodeCandidates().find((p) => fs.existsSync(p));
      if (code) {
        // `code <dossier>` réutilise la fenêtre déjà ouverte sur ce dossier
        spawn(code, [cwd], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("open", ["-a", "Visual Studio Code", cwd], { detached: true, stdio: "ignore" }).unref();
      }
      return true;
    }
    spawn("open", ["-a", "Visual Studio Code"], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  return false;
}

export async function jumpToSession(sessionId: string, cwd: string, deps: JumpDeps): Promise<void> {
  await focusVsCodeWindow(cwd, deps);
  // laisse la fenêtre passer au premier plan avant d'ouvrir l'URI (brief §4.5)
  await sleep((deps.platform ?? process.platform) === "darwin" ? 350 : 150);
  await deps.openExternal(sessionUri(sessionId));
}
