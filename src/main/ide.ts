// Fenêtres VS Code connues de Claude Code : l'extension écrit un fichier
// ~/.claude/ide/<port>.lock par fenêtre, avec { pid, workspaceFolders, ideName }.
// On s'en sert pour savoir quelle fenêtre contient le dossier d'une session,
// même si la session tourne dans un sous-dossier ou un workspace multi-dossiers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface IdeWindow {
  pid: number;
  workspaceFolders: string[];
  ideName?: string;
}

export function ideDir(): string {
  return path.join(os.homedir(), ".claude", "ide");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM : le process existe mais appartient à un autre utilisateur
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readIdeWindows(dir = ideDir(), alive: (pid: number) => boolean = isAlive): IdeWindow[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".lock"));
  } catch {
    return [];
  }
  const out: IdeWindow[] = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (typeof d.pid !== "number" || !Array.isArray(d.workspaceFolders)) continue;
      if (!alive(d.pid)) continue; // fichier laissé par une fenêtre fermée
      out.push({ pid: d.pid, workspaceFolders: d.workspaceFolders.filter((x: unknown) => typeof x === "string"), ideName: d.ideName });
    } catch {
      /* fichier illisible */
    }
  }
  return out;
}

function norm(p: string, platform: NodeJS.Platform): string {
  let s = p.replace(/[\\/]+/g, "/").replace(/\/$/, "");
  // macOS et Windows : systèmes de fichiers insensibles à la casse par défaut
  if (platform === "win32" || platform === "darwin") s = s.toLowerCase();
  return s;
}

export function contains(root: string, cwd: string, platform: NodeJS.Platform = process.platform): boolean {
  const r = norm(root, platform);
  const c = norm(cwd, platform);
  return c === r || c.startsWith(r + "/");
}

/**
 * Dossier racine de la fenêtre VS Code qui contient `cwd` (le plus précis), ou undefined.
 * `folders` : tous les dossiers de cette fenêtre (workspace multi-dossiers).
 */
export function windowFor(cwd: string, windows: IdeWindow[], platform: NodeJS.Platform = process.platform): { root: string; folders: string[] } | undefined {
  let best: { root: string; folders: string[] } | undefined;
  for (const w of windows) {
    for (const f of w.workspaceFolders) {
      if (contains(f, cwd, platform) && (!best || f.length > best.root.length)) best = { root: f, folders: w.workspaceFolders };
    }
  }
  return best;
}

function base(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Noms à chercher dans les titres des fenêtres VS Code, du plus probable au moins probable :
 * dossier racine de la fenêtre (titre « fichier — racine »), puis dossier de la session,
 * puis ses dossiers parents.
 */
export function titleCandidates(cwd: string, windows: IdeWindow[], platform: NodeJS.Platform = process.platform): { names: string[]; root: string } {
  const w = windowFor(cwd, windows, platform);
  const names: string[] = [];
  const add = (n: string) => n && !names.includes(n) && names.push(n);
  if (w) add(base(w.root));
  add(base(cwd));
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  for (let i = parts.length - 2; i >= Math.max(0, parts.length - 4); i--) add(parts[i]);
  return { names, root: w?.root ?? cwd };
}
