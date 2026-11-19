// Vérifications « natives » sous Windows, impossibles via Playwright seul :
// - verre acrylique réel (capture de l'écran, pas de la page web) ;
// - l'ouverture automatique ne vole pas le focus (fenêtre au premier plan inchangée) ;
// - un VRAI clic souris sur « Autoriser » fonctionne sur le panneau non focalisable
//   et ne vole pas le focus non plus.
// Usage : node e2e/native.mjs   (après npm run build)
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("native.mjs : Windows uniquement (macOS : voir docs/REVIEW.md, tests manuels).");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "docs", "screenshots");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fma-native-"));
const PORT = 47897;
const TOKEN = "f".repeat(64);
fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ token: TOKEN, port: PORT, prefs: { sound: false, notifications: false } }));

const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
const WIN32 = `Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class N {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  public struct POINT { public int X; public int Y; }
  public static string Fg() { var sb = new StringBuilder(512); GetWindowText(GetForegroundWindow(), sb, 512); return sb.ToString(); }
}
"@;`;
const foreground = () => ps(`${WIN32} [N]::Fg()`);

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("CLAUDE") || k === "ELECTRON_RUN_AS_NODE") delete env[k];
Object.assign(env, { FMA_USER_DATA: tmp, FMA_CLAUDE_SETTINGS: path.join(tmp, "settings.json"), FMA_NO_TRANSCRIPTS: "1", FMA_E2E: "1", FMA_NO_JUMP: "1" });

function post(route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: route, method: "POST", headers: { "Content-Type": "application/json", "X-FMA-Token": TOKEN } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve(b ? JSON.parse(b) : null));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(["✅", name]);
    console.log("✅", name);
  } catch (e) {
    results.push(["❌", name, e.message]);
    console.log("❌", name, "\n   ", e.message);
  }
};

const app = await electron.launch({ args: [root], env, cwd: root });
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
try {
  const ev = (sid, name, extra = {}) => post("/hook/event", { session_id: sid, cwd: `C:\\work\\${sid}`, hook_event_name: name, ...extra });
  await ev("polish", "SessionStart", { session_title: "Polish · Watch Videos" });
  await ev("polish", "PostToolUse", {
    tool_name: "TodoWrite",
    tool_input: { todos: ["a", "b", "c", "d", "e", "f", "g"].map((c, i) => ({ content: c, status: i < 5 ? "completed" : i === 5 ? "in_progress" : "pending" })) },
  });
  await ev("polish", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npx hyperframes render", description: "Rendu des animations" } });
  await ev("breakdown", "SessionStart", { session_title: "Breakdown reel" });
  await ev("breakdown", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "C:\\work\\breakdown\\transcript.md" } });

  const before = foreground();
  console.log("   fenêtre au premier plan avant :", before);
  const permReq = post("/hook/permission", {
    session_id: "scout",
    cwd: "C:\\work\\scout",
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "npx hyperframes render . -o out.mp4" },
  });
  await page.waitForSelector('[data-testid="permission"]');
  await sleep(900);

  await check("ouverture automatique : le focus clavier reste sur l'application active", async () => {
    assert.equal(foreground(), before);
    assert.equal(await app.evaluate(() => globalThis.__fma.panel.win.isFocused()), false);
  });

  const b = await app.evaluate(() => globalThis.__fma.panel.win.getBounds());
  const dpr = await page.evaluate(() => devicePixelRatio);
  await check("capture écran réelle (verre acrylique)", async () => {
    const file = path.join(shots, "10-verre-natif-windows.png");
    const m = 24;
    ps(
      `Add-Type -AssemblyName System.Drawing; $bmp = New-Object Drawing.Bitmap ${Math.round((b.width + 2 * m) * dpr)}, ${Math.round((b.height + 2 * m) * dpr)}; ` +
        `$g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${Math.round((b.x - m) * dpr)}, ${Math.round((b.y - m) * dpr)}, 0, 0, $bmp.Size); $bmp.Save('${file}')`,
    );
    assert.ok(fs.existsSync(file));
  });

  await check("vrai clic souris sur « Autoriser » : décision envoyée, focus non volé", async () => {
    const r = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((x) => x.textContent === "Autoriser");
      const rc = btn.getBoundingClientRect();
      return { x: rc.x + rc.width / 2, y: rc.y + rc.height / 2 };
    });
    const sx = Math.round((b.x + r.x) * dpr);
    const sy = Math.round((b.y + r.y) * dpr);
    ps(`${WIN32} $p = New-Object N+POINT; [void][N]::GetCursorPos([ref]$p); [void][N]::SetCursorPos(${sx}, ${sy}); Start-Sleep -Milliseconds 120; [N]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [N]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 200; [void][N]::SetCursorPos($p.X, $p.Y)`);
    const res = await Promise.race([permReq, sleep(3000).then(() => "timeout")]);
    assert.notEqual(res, "timeout", "le clic n'a pas atteint le bouton");
    assert.equal(res.hookSpecificOutput.decision.behavior, "allow");
    await sleep(300);
    assert.equal(foreground(), before);
  });
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(shots, "native-results.json"), JSON.stringify(results, null, 2));
}
const failed = results.filter((r) => r[0] === "❌").length;
console.log(`\n${results.length - failed}/${results.length} vérifications natives OK`);
process.exitCode = failed ? 1 : 0;
