// Mises à jour automatiques depuis les Releases GitHub (updater maison, D22).
//
// - Vérifie https://api.github.com/repos/<owner>/<repo>/releases/latest
// - Choisit le fichier de la plateforme : Windows = installeur NSIS (.exe),
//   macOS = archive .zip de l'app (universelle).
// - Vérifie l'empreinte SHA-256 publiée dans SHA256SUMS.txt.
// - Installe puis relance :
//   * Windows : installeur NSIS silencieux (/S --force-run), qui relance l'app ;
//   * macOS : script qui attend la fin de l'app, remplace le .app, le relance.
//     (Pas de Squirrel.Mac : il exige une app signée par Apple.)
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseInfo {
  version: string;
  notes: string;
  pageUrl: string;
  assets: ReleaseAsset[];
}

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; checkedAt: number }
  | { state: "available"; version: string; notes: string; pageUrl: string }
  | { state: "downloading"; version: string; progress: number }
  | { state: "installing"; version: string }
  | { state: "error"; message: string; version?: string };

// ---------- logique pure ----------

export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a > b ? */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export function parseRelease(json: unknown): ReleaseInfo | null {
  const r = json as Record<string, unknown>;
  if (!r || typeof r.tag_name !== "string" || r.draft === true || r.prerelease === true) return null;
  const assets = Array.isArray(r.assets) ? r.assets : [];
  return {
    version: r.tag_name.replace(/^v/, ""),
    notes: typeof r.body === "string" ? r.body : "",
    pageUrl: typeof r.html_url === "string" ? r.html_url : "",
    assets: assets
      .filter((a) => a && typeof a.name === "string" && typeof a.browser_download_url === "string")
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: Number(a.size) || 0 })),
  };
}

/** Fichier à télécharger pour cette plateforme. */
export function pickAsset(rel: ReleaseInfo, platform: NodeJS.Platform): ReleaseAsset | undefined {
  if (platform === "win32") return rel.assets.find((a) => /setup.*\.exe$/i.test(a.name));
  if (platform === "darwin") {
    const zips = rel.assets.filter((a) => /mac.*\.zip$/i.test(a.name));
    return zips.find((a) => /universal/i.test(a.name)) ?? zips.find((a) => (process.arch === "arm64" ? /arm64/i : /x64/i).test(a.name)) ?? zips[0];
  }
  return undefined;
}

/** "<sha256>  <nom>" par ligne → { nom: sha } */
export function parseSums(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

/** Dossier .app qui contient l'exécutable (macOS). */
export function macBundlePath(exePath: string): string | null {
  const m = /^(.*?\.app)\/Contents\/MacOS\//.exec(exePath);
  return m ? m[1] : null;
}

/** Script de remplacement du .app (macOS), exécuté une fois l'app quittée. */
export function macSwapScript(pid: number, bundle: string, newApp: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [
    "#!/bin/bash",
    "# Remplace FollowMyAgents.app par la nouvelle version, puis la relance.",
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done`,
    `BUNDLE=${q(bundle)}`,
    `NEW=${q(newApp)}`,
    'rm -rf "$BUNDLE.old"',
    'if mv "$BUNDLE" "$BUNDLE.old" && mv "$NEW" "$BUNDLE"; then',
    '  rm -rf "$BUNDLE.old"',
    "else",
    '  [ -d "$BUNDLE.old" ] && [ ! -d "$BUNDLE" ] && mv "$BUNDLE.old" "$BUNDLE"',
    "fi",
    'open "$BUNDLE"',
    "",
  ].join("\n");
}

// ---------- effets (réseau, fichiers, processus) ----------

export interface UpdaterDeps {
  owner: string;
  repo: string;
  currentVersion: string;
  platform?: NodeJS.Platform;
  /** l'app tourne depuis un build installé (sinon : pas d'installation, juste l'information) */
  packaged: boolean;
  exePath: string;
  apiBase?: string;
  fetch?: typeof fetch;
  tmpDir?: string;
  spawnDetached?: (file: string, args: string[]) => void;
  run?: (file: string, args: string[]) => Promise<void>;
  quit: () => void;
  onChange?: (s: UpdateState) => void;
  log?: (m: string) => void;
}

export class Updater {
  state: UpdateState = { state: "idle" };
  private release: ReleaseInfo | null = null;
  private readonly d: Required<Omit<UpdaterDeps, "onChange" | "log">> & Pick<UpdaterDeps, "onChange" | "log">;

  constructor(deps: UpdaterDeps) {
    this.d = {
      platform: process.platform,
      apiBase: "https://api.github.com",
      fetch: globalThis.fetch,
      tmpDir: os.tmpdir(),
      spawnDetached: (file, args) => spawn(file, args, { detached: true, stdio: "ignore" }).unref(),
      run: (file, args) =>
        new Promise((resolve, reject) => {
          const p = spawn(file, args, { stdio: "ignore" });
          p.on("error", reject);
          p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(file)} : code ${code}`))));
        }),
      // une option passée explicitement à undefined ne doit pas écraser la valeur par défaut
      // (bug 0.2.0 / 0.2.1 : apiBase undefined → « Failed to parse URL from undefined/repos/… »)
      ...(Object.fromEntries(Object.entries(deps).filter(([, v]) => v !== undefined)) as UpdaterDeps),
    };
  }

  private set(s: UpdateState) {
    this.state = s;
    this.d.onChange?.(s);
  }

  private headers() {
    return { Accept: "application/vnd.github+json", "User-Agent": "FollowMyAgents-updater" };
  }

  /** Vérifie s'il existe une version plus récente. */
  async check(): Promise<UpdateState> {
    if (this.state.state === "downloading" || this.state.state === "installing") return this.state;
    this.set({ state: "checking" });
    try {
      const res = await this.d.fetch(`${this.d.apiBase}/repos/${this.d.owner}/${this.d.repo}/releases/latest`, { headers: this.headers() });
      if (res.status === 404) {
        this.set({ state: "up-to-date", checkedAt: Date.now() }); // aucune release publiée
        return this.state;
      }
      if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
      const rel = parseRelease(await res.json());
      if (rel && isNewer(rel.version, this.d.currentVersion) && pickAsset(rel, this.d.platform)) {
        this.release = rel;
        this.set({ state: "available", version: rel.version, notes: rel.notes, pageUrl: rel.pageUrl });
      } else {
        this.set({ state: "up-to-date", checkedAt: Date.now() });
      }
    } catch (e) {
      this.set({ state: "error", message: `Vérification impossible : ${(e as Error).message}` });
    }
    return this.state;
  }

  /** Télécharge, vérifie, installe et relance. */
  async install(): Promise<void> {
    const rel = this.release;
    if (!rel) throw new Error("Aucune mise à jour disponible");
    if (!this.d.packaged) {
      this.set({ state: "error", version: rel.version, message: "App lancée depuis le code : mettez à jour avec git pull." });
      return;
    }
    const asset = pickAsset(rel, this.d.platform)!;
    try {
      const dir = fs.mkdtempSync(path.join(this.d.tmpDir, "fma-update-"));
      const file = path.join(dir, asset.name);
      await this.download(asset, file, rel.version);
      await this.verify(rel, asset, file);
      this.set({ state: "installing", version: rel.version });
      if (this.d.platform === "win32") {
        // NSIS : installation silencieuse dans le même dossier, puis relance de l'app
        this.d.spawnDetached(file, ["/S", "--force-run"]);
        this.d.quit();
        return;
      }
      if (this.d.platform === "darwin") {
        const bundle = macBundlePath(this.d.exePath);
        if (!bundle) throw new Error("emplacement de l'app introuvable");
        if (bundle.startsWith("/Volumes/")) throw new Error("l'app tourne depuis l'image disque : copiez-la d'abord dans Applications");
        fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
        const extract = path.join(dir, "extract");
        fs.mkdirSync(extract);
        await this.d.run("/usr/bin/ditto", ["-x", "-k", file, extract]);
        const app = fs.readdirSync(extract).find((f) => f.endsWith(".app"));
        if (!app) throw new Error("archive sans application");
        const newApp = path.join(extract, app);
        // fichier téléchargé par l'app : pas de quarantaine, mais on la retire par sécurité
        await this.d.run("/usr/bin/xattr", ["-cr", newApp]).catch(() => {});
        const script = path.join(dir, "swap.sh");
        fs.writeFileSync(script, macSwapScript(process.pid, bundle, newApp), { mode: 0o755 });
        this.d.spawnDetached("/bin/bash", [script]);
        this.d.quit();
        return;
      }
      throw new Error("plateforme non prise en charge");
    } catch (e) {
      this.set({ state: "error", version: rel.version, message: `Mise à jour impossible : ${(e as Error).message}` });
    }
  }

  private async download(asset: ReleaseAsset, file: string, version: string) {
    this.set({ state: "downloading", version, progress: 0 });
    const res = await this.d.fetch(asset.url, { headers: { "User-Agent": "FollowMyAgents-updater" } });
    if (!res.ok || !res.body) throw new Error(`téléchargement : ${res.status}`);
    const total = Number(res.headers.get("content-length")) || asset.size || 0;
    const out = fs.createWriteStream(file);
    let got = 0;
    let lastPct = -1;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (pct !== lastPct) {
          lastPct = pct;
          this.set({ state: "downloading", version, progress: pct });
        }
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()));
    }
  }

  private async verify(rel: ReleaseInfo, asset: ReleaseAsset, file: string) {
    const sumsAsset = rel.assets.find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name));
    if (!sumsAsset) throw new Error("empreintes SHA-256 absentes de la release");
    const res = await this.d.fetch(sumsAsset.url, { headers: { "User-Agent": "FollowMyAgents-updater" } });
    if (!res.ok) throw new Error(`empreintes : ${res.status}`);
    const expected = parseSums(await res.text())[asset.name];
    if (!expected) throw new Error(`pas d'empreinte pour ${asset.name}`);
    const actual = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== expected) throw new Error("empreinte SHA-256 incorrecte, fichier rejeté");
  }
}
