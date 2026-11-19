import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Updater, isNewer, macBundlePath, macSwapScript, parseSums, pickAsset, parseRelease, type UpdateState } from "../src/main/updater";

const payload = Buffer.from("contenu de l'installeur v0.3.0");
const sha = createHash("sha256").update(payload).digest("hex");

function release(over: Record<string, unknown> = {}) {
  return {
    tag_name: "v0.3.0",
    body: "Nouveautés",
    html_url: "https://github.com/o/r/releases/tag/v0.3.0",
    draft: false,
    prerelease: false,
    assets: [
      { name: "FollowMyAgents-Setup-0.3.0.exe", browser_download_url: "https://dl/win.exe", size: payload.length },
      { name: "FollowMyAgents-0.3.0-mac-universal.zip", browser_download_url: "https://dl/mac.zip", size: payload.length },
      { name: "FollowMyAgents-0.3.0-universal.dmg", browser_download_url: "https://dl/mac.dmg", size: 1 },
      { name: "SHA256SUMS.txt", browser_download_url: "https://dl/sums", size: 1 },
    ],
    ...over,
  };
}

function fakeFetch(rel: unknown, opts: { status?: number; sums?: string } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes("/releases/latest")) {
      return new Response(JSON.stringify(rel), { status: opts.status ?? 200 });
    }
    if (url === "https://dl/sums") {
      return new Response(
        opts.sums ?? `${sha}  FollowMyAgents-Setup-0.3.0.exe\n${sha}  FollowMyAgents-0.3.0-mac-universal.zip\n`,
        { status: 200 },
      );
    }
    return new Response(payload, { status: 200, headers: { "content-length": String(payload.length) } });
  }) as unknown as typeof fetch;
}

let tmp: string;
beforeEach(() => (tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fma-upd-"))));
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function make(platform: NodeJS.Platform, f: typeof fetch, extra: Record<string, unknown> = {}) {
  const states: UpdateState[] = [];
  const spawnDetached = vi.fn();
  const quit = vi.fn();
  const run = vi.fn(async (file: string, args: string[]) => {
    // faux ditto : crée l'app extraite
    if (file.endsWith("ditto")) fs.mkdirSync(path.join(args[3], "FollowMyAgents.app", "Contents"), { recursive: true });
  });
  const u = new Updater({
    owner: "o",
    repo: "r",
    currentVersion: "0.2.0",
    platform,
    packaged: true,
    exePath: path.join(tmp, "Applications", "FollowMyAgents.app", "Contents", "MacOS", "FollowMyAgents").replace(/\\/g, "/"),
    fetch: f,
    tmpDir: tmp,
    spawnDetached,
    run,
    quit,
    onChange: (s) => states.push(s),
    ...extra,
  });
  return { u, states, spawnDetached, quit, run };
}

describe("logique pure", () => {
  it("compare les versions", () => {
    expect(isNewer("v0.3.0", "0.2.9")).toBe(true);
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
    expect(isNewer("garbage", "0.1.0")).toBe(false);
  });
  it("ignore les brouillons et pré-versions", () => {
    expect(parseRelease(release({ draft: true }))).toBeNull();
    expect(parseRelease(release({ prerelease: true }))).toBeNull();
  });
  it("choisit le bon fichier par plateforme", () => {
    const rel = parseRelease(release())!;
    expect(pickAsset(rel, "win32")?.name).toBe("FollowMyAgents-Setup-0.3.0.exe");
    expect(pickAsset(rel, "darwin")?.name).toBe("FollowMyAgents-0.3.0-mac-universal.zip");
    expect(pickAsset(rel, "linux")).toBeUndefined();
  });
  it("lit SHA256SUMS", () => {
    expect(parseSums(`${sha}  a.exe\r\n${sha} *b.zip\nbad line`)).toEqual({ "a.exe": sha, "b.zip": sha });
  });
  it("trouve le .app et prépare un script de remplacement sûr", () => {
    expect(macBundlePath("/Applications/FollowMyAgents.app/Contents/MacOS/FollowMyAgents")).toBe("/Applications/FollowMyAgents.app");
    expect(macBundlePath("/usr/bin/node")).toBeNull();
    const s = macSwapScript(42, "/Applications/Follow'My.app", "/tmp/x/FollowMyAgents.app");
    expect(s).toContain("while kill -0 42");
    expect(s).toContain(`BUNDLE='/Applications/Follow'\\''My.app'`);
    expect(s).toContain('open "$BUNDLE"');
  });
});

describe("vérification", () => {
  it("version plus récente → available", async () => {
    const { u } = make("win32", fakeFetch(release()));
    expect(await u.check()).toMatchObject({ state: "available", version: "0.3.0" });
  });
  it("même version → up-to-date ; aucune release (404) → up-to-date", async () => {
    expect((await make("win32", fakeFetch(release({ tag_name: "v0.2.0" }))).u.check()).state).toBe("up-to-date");
    expect((await make("win32", fakeFetch({}, { status: 404 })).u.check()).state).toBe("up-to-date");
  });
  it("erreur réseau → error, sans planter", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await make("win32", f).u.check()).toMatchObject({ state: "error" });
  });
});

describe("installation", () => {
  it("Windows : télécharge, vérifie l'empreinte, lance l'installeur silencieux puis quitte", async () => {
    const { u, states, spawnDetached, quit } = make("win32", fakeFetch(release()));
    await u.check();
    await u.install();
    expect(states.some((s) => s.state === "downloading" && s.progress === 100)).toBe(true);
    expect(spawnDetached).toHaveBeenCalledOnce();
    const [file, args] = spawnDetached.mock.calls[0];
    expect(path.basename(file)).toBe("FollowMyAgents-Setup-0.3.0.exe");
    expect(fs.readFileSync(file)).toEqual(payload);
    expect(args).toEqual(["/S", "--force-run"]);
    expect(quit).toHaveBeenCalledOnce();
  });

  it("empreinte incorrecte → rien n'est installé", async () => {
    const bad = "0".repeat(64);
    const { u, spawnDetached, quit } = make("win32", fakeFetch(release(), { sums: `${bad}  FollowMyAgents-Setup-0.3.0.exe` }));
    await u.check();
    await u.install();
    expect(u.state).toMatchObject({ state: "error" });
    expect((u.state as { message: string }).message).toMatch(/SHA-256 incorrecte/);
    expect(spawnDetached).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it("sans fichier d'empreintes → refus", async () => {
    const rel = release();
    rel.assets = rel.assets.filter((a: { name: string }) => !a.name.startsWith("SHA256"));
    const { u, spawnDetached } = make("win32", fakeFetch(rel));
    await u.check();
    await u.install();
    expect(u.state).toMatchObject({ state: "error" });
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it("macOS : extrait l'archive, écrit le script de remplacement, le lance puis quitte", async () => {
    fs.mkdirSync(path.join(tmp, "Applications", "FollowMyAgents.app"), { recursive: true });
    const { u, spawnDetached, quit, run } = make("darwin", fakeFetch(release()));
    await u.check();
    await u.install();
    expect(u.state).toMatchObject({ state: "installing" });
    expect(run.mock.calls[0][0]).toBe("/usr/bin/ditto");
    const [bash, [script]] = spawnDetached.mock.calls[0];
    expect(bash).toBe("/bin/bash");
    const text = fs.readFileSync(script, "utf8");
    expect(text).toContain("FollowMyAgents.app");
    expect(quit).toHaveBeenCalledOnce();
  });

  it("macOS : refuse si l'app tourne depuis l'image disque", async () => {
    const { u, spawnDetached } = make("darwin", fakeFetch(release()), { exePath: "/Volumes/FollowMyAgents/FollowMyAgents.app/Contents/MacOS/FollowMyAgents" });
    await u.check();
    await u.install();
    expect((u.state as { message: string }).message).toMatch(/image disque/);
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it("app lancée depuis le code (npm start) : pas d'installation, message git pull", async () => {
    const { u, spawnDetached } = make("win32", fakeFetch(release()), { packaged: false });
    await u.check();
    await u.install();
    expect((u.state as { message: string }).message).toMatch(/git pull/);
    expect(spawnDetached).not.toHaveBeenCalled();
  });
});
