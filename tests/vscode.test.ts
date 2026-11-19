import { describe, expect, it, vi } from "vitest";
import { cleanEnv, folderName, isAccessibilityError, jumpToSession, sessionUri, type RunResult } from "../src/main/vscode";

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });

function setup(platform: NodeJS.Platform, result: RunResult, existing: string[] = [], ideWindows: { pid: number; workspaceFolders: string[] }[] = []) {
  const calls: { run: [string, string[]][]; launch: [string, string[]][]; open: string[]; waits: number[] } = {
    run: [],
    launch: [],
    open: [],
    waits: [],
  };
  const onAccessibilityDenied = vi.fn();
  const deps = {
    platform,
    scriptsDir: "/res/scripts",
    run: async (f: string, a: string[]) => {
      calls.run.push([f, a]);
      return result;
    },
    launch: (f: string, a: string[]) => void calls.launch.push([f, a]),
    exists: (p: string) => existing.includes(p),
    openExternal: async (u: string) => void calls.open.push(u),
    delay: async (ms: number) => void calls.waits.push(ms),
    onAccessibilityDenied,
    ideWindows,
  };
  return { deps, calls, onAccessibilityDenied };
}

describe("jump macOS", () => {
  const cwd = "/Users/me/work/mon-projet";

  it("fenêtre trouvée par AppleScript : pas de `code`, puis l'URI de la session", async () => {
    const { deps, calls } = setup("darwin", ok("FOCUSED app.ts — mon-projet"));
    const outcome = await jumpToSession("abc-123", cwd, deps);
    expect(outcome).toBe("focused");
    const [file, args] = calls.run[0];
    expect(file).toBe("osascript");
    expect(args[0]).toMatch(/focus-window-mac\.applescript$/);
    expect(args[1]).toBe(cwd); // chemin racine (aucune fenêtre déclarée : le cwd)
    expect(args[2]).toBe("mon-projet");
    expect(calls.launch).toEqual([]);
    expect(calls.open).toEqual([sessionUri("abc-123")]);
    expect(calls.waits[0]).toBeGreaterThanOrEqual(400);
  });

  it("dossier pas ouvert dans VS Code : `code <dossier>` puis attente plus longue", async () => {
    const code = "/opt/homebrew/bin/code";
    const { deps, calls } = setup("darwin", ok("NOTFOUND"), [cwd, code]);
    expect(await jumpToSession("abc", cwd, deps)).toBe("opened-folder");
    expect(calls.launch).toEqual([[code, [cwd]]]);
    expect(calls.waits[0]).toBeGreaterThanOrEqual(1000);
  });

  it("sans commande `code` : repli sur open -a", async () => {
    const { deps, calls } = setup("darwin", ok("NOAPP"), [cwd]);
    await jumpToSession("abc", cwd, deps);
    expect(calls.launch).toEqual([["open", ["-a", "Visual Studio Code", cwd]]]);
  });

  it("accès Accessibilité refusé : demande l'accès et active seulement VS Code (pas de nouvelle fenêtre)", async () => {
    const { deps, calls, onAccessibilityDenied } = setup("darwin", {
      code: 1,
      stdout: "",
      stderr: "execution error: System Events got an error: osascript is not allowed assistive access. (-1719)",
    }, [cwd, "/usr/local/bin/code"]);
    expect(await jumpToSession("abc", cwd, deps)).toBe("activated-app");
    expect(onAccessibilityDenied).toHaveBeenCalledOnce();
    expect(calls.launch).toEqual([["open", ["-a", "Visual Studio Code"]]]);
    expect(calls.open).toHaveLength(1);
  });
});

describe("jump : fenêtre retrouvée grâce à ~/.claude/ide/*.lock", () => {
  it("session dans un sous-dossier : cherche d'abord le dossier racine de la fenêtre", async () => {
    const wins = [
      { pid: 1, workspaceFolders: ["/Users/me/work/autre"] },
      { pid: 2, workspaceFolders: ["/Users/me/work/mono"] },
    ];
    const { deps, calls } = setup("darwin", ok("FOCUSED app.ts — mono"), [], wins);
    await jumpToSession("s", "/Users/me/work/mono/packages/api", deps);
    const [, args] = calls.run[0];
    expect(args[1]).toBe("/Users/me/work/mono");
    expect(args.slice(2, 4)).toEqual(["mono", "api"]);
  });

  it("dossier non ouvert : `code` rouvre le dossier RACINE (pas le sous-dossier)", async () => {
    const wins = [{ pid: 2, workspaceFolders: ["/Users/me/work/mono"] }];
    const code = "/usr/local/bin/code";
    const { deps, calls } = setup("darwin", ok("NOTFOUND"), ["/Users/me/work/mono", "/Users/me/work/mono/packages/api", code], wins);
    await jumpToSession("s", "/Users/me/work/mono/packages/api", deps);
    expect(calls.launch).toEqual([[code, ["/Users/me/work/mono"]]]);
  });

  it("Windows : FALLBACK (aucune fenêtre correspondante) → activated-app", async () => {
    const { deps } = setup("win32", ok("FALLBACK x - autre - Visual Studio Code"));
    expect(await jumpToSession("s", String.raw`C:\w\p`, deps)).toBe("activated-app");
  });
});

describe("jump Windows", () => {
  it("script PowerShell avec le nom du dossier, puis l'URI", async () => {
    const { deps, calls } = setup("win32", ok("FOCUSED x - mon-projet - Visual Studio Code"));
    expect(await jumpToSession("s1", "C:\\work\\mon-projet", deps)).toBe("focused");
    const [file, args] = calls.run[0];
    expect(file).toBe("powershell.exe");
    expect(args.slice(-4, -1)).toEqual(["-Process", "Code", "-Candidates"]);
    expect(args.at(-1)!.split("|")[0]).toBe("mon-projet");
    expect(calls.open).toEqual([sessionUri("s1")]);
  });
});

describe("utilitaires", () => {
  it("cleanEnv retire ELECTRON_RUN_AS_NODE et VSCODE_*", () => {
    expect(cleanEnv({ PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", VSCODE_IPC_HOOK_CLI: "/tmp/x.sock", VSCODE_GIT_ASKPASS_MAIN: "y", HOME: "/h" })).toEqual({
      PATH: "/bin",
      HOME: "/h",
    });
  });
  it("folderName", () => {
    expect(folderName("C:\\work\\a\\b")).toBe("b");
    expect(folderName("/Users/me/proj/")).toBe("proj");
  });
  it("isAccessibilityError", () => {
    expect(isAccessibilityError({ code: 1, stdout: "", stderr: "(-25211)" })).toBe(true);
    expect(isAccessibilityError({ code: 1, stdout: "", stderr: "syntax error" })).toBe(false);
  });
});
