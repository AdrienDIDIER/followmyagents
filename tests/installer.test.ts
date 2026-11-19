import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODEX_ASYNC_EVENTS,
  COMMAND_EVENTS,
  buildCodexHookConfig,
  codexHooksState,
  installCodexHooks,
  HTTP_EVENTS,
  buildHookConfig,
  hooksState,
  installHooks,
  isOurHook,
  setTodoTools,
  todoToolsEnabled,
  uninstallHooks,
} from "../src/main/installer";

const target = { port: 47821, token: "a".repeat(64), platform: "darwin" as NodeJS.Platform };

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fma-inst-"));
  file = path.join(dir, ".claude", "settings.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (o: unknown, indent: number | string = 2) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(o, null, indent) + "\n");
};
const backups = () => fs.readdirSync(path.dirname(file)).filter((f) => f.includes(".fma-backup-"));

const userSettings = {
  model: "claude-opus-5-5",
  permissions: { allow: ["Bash(npm run *)"] },
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/guard.sh" }] }],
    Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
  },
};

describe("buildHookConfig", () => {
  it("installe PermissionRequest en HTTP bloquant (600 s) et les événements de fin en command+curl", () => {
    const cfg = buildHookConfig(target);
    const perm = cfg.PermissionRequest[0].hooks[0] as any;
    expect(perm).toMatchObject({ type: "http", url: "http://127.0.0.1:47821/hook/permission", timeout: 600 });
    expect(perm.headers["X-FMA-Token"]).toBe(target.token);
    expect(perm.allowedEnvVars).toBeUndefined(); // token en dur (brief §4.2)
    for (const ev of HTTP_EVENTS) expect((cfg[ev][0].hooks[0] as any).type).toBe("http");
    for (const ev of COMMAND_EVENTS) {
      const h = cfg[ev][0].hooks[0] as any;
      expect(h.type).toBe("command");
      expect(h.command).toMatch(/^curl -s -m 2 /);
      expect(h.command).toMatch(/; exit 0$/);
      expect(h.command).toContain(`X-FMA-Token: ${target.token}`);
    }
  });

  it("utilise curl.exe sous Windows", () => {
    const cfg = buildHookConfig({ ...target, platform: "win32" });
    expect((cfg.SessionStart[0].hooks[0] as any).command).toMatch(/^curl\.exe /);
  });

  it("n'installe pas le hook PreToolUse:AskUserQuestion par défaut (D3), mais sait le faire", () => {
    expect(buildHookConfig(target).PreToolUse.some((g) => g.matcher === "AskUserQuestion")).toBe(false);
    const alt = buildHookConfig({ ...target, questionMode: "pretooluse" });
    expect(alt.PreToolUse[0]).toMatchObject({ matcher: "AskUserQuestion" });
    expect((alt.PreToolUse[0].hooks[0] as any).url).toMatch(/\/hook\/question$/);
  });

  it("isOurHook reconnaît nos hooks et pas ceux de l'utilisateur", () => {
    const cfg = buildHookConfig(target);
    for (const groups of Object.values(cfg)) for (const g of groups) for (const h of g.hooks) expect(isOurHook(h)).toBe(true);
    expect(isOurHook({ type: "command", command: "say done" })).toBe(false);
    expect(isOurHook({ type: "http", url: "http://x", headers: { Authorization: "b" } })).toBe(false);
    expect(isOurHook({ type: "http", url: "http://x", headers: { "x-fma-token": "z" } })).toBe(true);
  });
});

describe("installHooks / uninstallHooks", () => {
  it("crée le fichier s'il n'existe pas (sans sauvegarde)", () => {
    const r = installHooks(file, target);
    expect(r.created).toBe(true);
    expect(r.backupPath).toBeUndefined();
    expect(read().hooks.PermissionRequest).toHaveLength(1);
  });

  it("fusionne sans toucher aux réglages ni aux hooks de l'utilisateur, et sauvegarde l'original", () => {
    write(userSettings);
    const original = fs.readFileSync(file, "utf8");
    const r = installHooks(file, target, new Date(2026, 10, 19, 12, 0, 0));
    expect(r.backupPath).toMatch(/settings\.json\.fma-backup-20261119-120000$/);
    expect(fs.readFileSync(r.backupPath!, "utf8")).toBe(original);
    const s = read();
    expect(s.model).toBe(userSettings.model);
    expect(s.permissions).toEqual(userSettings.permissions);
    // Le hook utilisateur reste en premier, intact
    expect(s.hooks.PreToolUse[0]).toEqual(userSettings.hooks.PreToolUse[0]);
    expect(s.hooks.Stop[0]).toEqual(userSettings.hooks.Stop[0]);
    expect(s.hooks.Stop).toHaveLength(2);
    expect(isOurHook(s.hooks.Stop[1].hooks[0])).toBe(true);
  });

  it("est idempotent : réinstaller ne duplique pas nos hooks et met à jour le token", () => {
    write(userSettings);
    installHooks(file, target);
    installHooks(file, { ...target, token: "b".repeat(64) });
    const s = read();
    expect(s.hooks.PermissionRequest).toHaveLength(1);
    expect(s.hooks.Stop).toHaveLength(2);
    expect(JSON.stringify(s)).not.toContain("a".repeat(64));
    expect(JSON.stringify(s)).toContain("b".repeat(64));
  });

  it("désinstaller restaure exactement l'objet d'origine", () => {
    write(userSettings);
    installHooks(file, target);
    const r = uninstallHooks(file);
    expect(r.removed).toBeGreaterThan(0);
    expect(r.backupPath).toBeDefined();
    expect(read()).toEqual(userSettings);
  });

  it("désinstaller retire la clé hooks si elle ne contenait que les nôtres", () => {
    write({ model: "x" });
    installHooks(file, target);
    uninstallHooks(file);
    expect(read()).toEqual({ model: "x" });
  });

  it("garde un hook utilisateur placé dans le même groupe que les nôtres", () => {
    write({});
    installHooks(file, target);
    const s = read();
    s.hooks.Stop[0].hooks.push({ type: "command", command: "say mine" });
    write(s);
    uninstallHooks(file);
    expect(read().hooks).toEqual({ Stop: [{ hooks: [{ type: "command", command: "say mine" }] }] });
  });

  it("désinstaller sans nos hooks ne réécrit rien et ne crée pas de sauvegarde", () => {
    write(userSettings);
    const before = fs.statSync(file).mtimeMs;
    const r = uninstallHooks(file);
    expect(r.removed).toBe(0);
    expect(backups()).toHaveLength(0);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it("refuse d'écrire si le JSON est invalide", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ invalid json");
    expect(() => installHooks(file, target)).toThrow(/invalide/);
    expect(fs.readFileSync(file, "utf8")).toBe("{ invalid json");
    expect(backups()).toHaveLength(0);
  });

  it("refuse si hooks n'est pas un objet", () => {
    write({ hooks: [] });
    expect(() => installHooks(file, target)).toThrow(/pas un objet/);
  });

  it("conserve l'indentation existante (tabulations)", () => {
    write(userSettings, "\t");
    installHooks(file, target);
    expect(fs.readFileSync(file, "utf8")).toMatch(/\n\t"model"/);
  });

  it("accepte un BOM UTF-8", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "﻿" + JSON.stringify({ model: "x" }));
    installHooks(file, target);
    expect(read().model).toBe("x");
  });

  it("ne laisse pas de fichier temporaire", () => {
    write(userSettings);
    installHooks(file, target);
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.includes("fma-tmp"))).toHaveLength(0);
  });

  it("hooksState détecte l'installation, le token et le port", () => {
    expect(hooksState(file, target).installed).toBe(false);
    installHooks(file, target);
    expect(hooksState(file, target)).toMatchObject({ installed: true, upToDate: true });
    expect(hooksState(file, { ...target, token: "c".repeat(64) })).toMatchObject({ installed: true, upToDate: false });
    expect(hooksState(file, { ...target, port: 1234 })).toMatchObject({ installed: true, upToDate: false });
  });
});

describe("option Plans des agents (TodoWrite)", () => {
  it("active puis désactive CLAUDE_CODE_ENABLE_TODO_TOOLS sans toucher au reste, avec sauvegarde", () => {
    write({ model: "x", env: { FOO: "bar" } });
    expect(todoToolsEnabled(file)).toBe(false);
    const r = setTodoTools(file, true);
    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeDefined();
    expect(read()).toEqual({ model: "x", env: { FOO: "bar", CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" } });
    expect(todoToolsEnabled(file)).toBe(true);
    expect(setTodoTools(file, true).changed).toBe(false);
    setTodoTools(file, false);
    expect(read()).toEqual({ model: "x", env: { FOO: "bar" } });
  });
  it("retire la clé env si elle devient vide ; crée le fichier si besoin", () => {
    setTodoTools(file, true);
    expect(read()).toEqual({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" } });
    setTodoTools(file, false);
    expect(read()).toEqual({});
  });
  it("la désinstallation des hooks ne touche pas à cette option", () => {
    write({});
    installHooks(file, target);
    setTodoTools(file, true);
    uninstallHooks(file);
    expect(read()).toEqual({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" } });
  });
});

describe("Codex : ~/.codex/hooks.json", () => {
  it("PermissionRequest synchrone avec message d'attente ; le reste en async ; curl rapide et silencieux", () => {
    const cfg = buildCodexHookConfig({ ...target, platform: "win32" });
    const perm = cfg.PermissionRequest[0].hooks[0] as any;
    expect(perm).toMatchObject({ type: "command", timeout: 600, statusMessage: "En attente de FollowMyAgents…" });
    expect(perm.async).toBeUndefined();
    expect(perm.command).toMatch(/^curl\.exe -s --connect-timeout 0\.5 /);
    expect(perm.command).toContain(`"http://127.0.0.1:47821/hook/permission?agent=codex"`);
    expect(perm.command).toMatch(/; exit 0$/);
    for (const ev of CODEX_ASYNC_EVENTS) expect(cfg[ev][0].hooks[0]).toMatchObject({ async: true });
    expect((cfg.SessionEnd[0].hooks[0] as any).timeout).toBeLessThanOrEqual(3); // maximum Codex
    for (const groups of Object.values(cfg)) for (const g of groups) for (const h of g.hooks) expect(isOurHook(h)).toBe(true);
  });

  it("fusionne avec des hooks Codex existants et désinstalle exactement", () => {
    const codexFile = path.join(dir, ".codex", "hooks.json");
    const mine = { description: "mes hooks", hooks: { PreToolUse: [{ matcher: "^Bash$", hooks: [{ type: "command", command: "python check.py" }] }] } };
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(codexFile, JSON.stringify(mine, null, 2));
    installCodexHooks(codexFile, target);
    const after = JSON.parse(fs.readFileSync(codexFile, "utf8"));
    expect(after.description).toBe("mes hooks");
    expect(after.hooks.PreToolUse[0]).toEqual(mine.hooks.PreToolUse[0]);
    expect(after.hooks.PermissionRequest).toHaveLength(1);
    expect(codexHooksState(codexFile, target)).toMatchObject({ installed: true, upToDate: true });
    uninstallHooks(codexFile);
    expect(JSON.parse(fs.readFileSync(codexFile, "utf8"))).toEqual(mine);
  });

  it("crée hooks.json s'il n'existe pas", () => {
    const codexFile = path.join(dir, "codex-home", "hooks.json");
    installCodexHooks(codexFile, target);
    expect(Object.keys(JSON.parse(fs.readFileSync(codexFile, "utf8")).hooks).sort()).toEqual(
      ["PermissionRequest", "SessionEnd", ...CODEX_ASYNC_EVENTS].sort(),
    );
  });
});
