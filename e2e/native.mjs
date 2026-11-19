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
  await check("raccourci global Ctrl+Alt+A : ouvre le panneau, Entrée autorise la 1re demande, Échap ferme", async () => {
    const req = post("/hook/permission", {
      session_id: "scout",
      cwd: "C:\\work\\scout",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "echo clavier" },
    });
    await page.waitForSelector('[data-testid="permission"]');
    await sleep(400);
    await app.evaluate(() => globalThis.__fma.hide());
    await sleep(300);
    // Ctrl (0x11) + Alt (0x12) + A (0x41)
    ps(`${WIN32} $k = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);' -Name K -PassThru; foreach ($v in 0x11,0x12,0x41) { $k::keybd_event($v,0,0,[UIntPtr]::Zero) }; foreach ($v in 0x41,0x12,0x11) { $k::keybd_event($v,0,2,[UIntPtr]::Zero) }`);
    await sleep(700);
    assert.equal(await app.evaluate(() => globalThis.__fma.panel.visible), true, "panneau non affiché");
    assert.equal(await app.evaluate(() => globalThis.__fma.panel.win.isFocused()), true, "le raccourci doit donner le focus au panneau");
    ps(`$k = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);' -Name K2 -PassThru; $k::keybd_event(0x0D,0,0,[UIntPtr]::Zero); $k::keybd_event(0x0D,0,2,[UIntPtr]::Zero)`);
    const res = await Promise.race([req, sleep(3000).then(() => "timeout")]);
    assert.notEqual(res, "timeout", "Entrée n'a pas autorisé");
    assert.equal(res.hookSpecificOutput.decision.behavior, "allow");
    await sleep(300);
    ps(`$k = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);' -Name K3 -PassThru; $k::keybd_event(0x1B,0,0,[UIntPtr]::Zero); $k::keybd_event(0x1B,0,2,[UIntPtr]::Zero)`);
    await sleep(400);
    assert.equal(await app.evaluate(() => globalThis.__fma.panel.visible), false, "Échap doit fermer le panneau");
  });

  await check("détacher : le panneau se déplace à la souris et sa position est mémorisée", async () => {
    await app.evaluate(() => globalThis.__fma.show("click"));
    await sleep(400);
    await page.getByRole("button", { name: "Détacher le panneau", exact: true }).click();
    await sleep(400);
    const b0 = await app.evaluate(() => globalThis.__fma.panel.win.getBounds());
    const hx = Math.round((b0.x + 60) * dpr);
    const hy = Math.round((b0.y + 22) * dpr);
    ps(
      `${WIN32} $p = New-Object N+POINT; [void][N]::GetCursorPos([ref]$p); [void][N]::SetCursorPos(${hx}, ${hy}); Start-Sleep -Milliseconds 150; [N]::mouse_event(2,0,0,0,[UIntPtr]::Zero); ` +
        `for ($i = 1; $i -le 20; $i++) { [void][N]::SetCursorPos(${hx} - 15 * $i, ${hy} - 10 * $i); Start-Sleep -Milliseconds 15 }; [N]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 300; [void][N]::SetCursorPos($p.X, $p.Y)`,
    );
    await sleep(500);
    const b1 = await app.evaluate(() => globalThis.__fma.panel.win.getBounds());
    assert.ok(b0.x - b1.x > 200 && b0.y - b1.y > 120, `déplacement insuffisant : ${JSON.stringify(b0)} → ${JSON.stringify(b1)}`);
    const cfg = await app.evaluate(() => globalThis.__fma.cfg());
    assert.deepEqual(cfg.detachedPos, { x: b1.x, y: b1.y });
    await app.evaluate(() => globalThis.__fma.hide());
    await app.evaluate(() => globalThis.__fma.show("click"));
    await sleep(300);
    const b2 = await app.evaluate(() => globalThis.__fma.panel.win.getBounds());
    assert.deepEqual([b2.x, b2.y], [b1.x, b1.y], "position non conservée");
    await page.getByRole("button", { name: "Rattacher à l'icône", exact: true }).click();
    await sleep(300);
    const b3 = await app.evaluate(() => globalThis.__fma.panel.win.getBounds());
    assert.deepEqual([b3.x, b3.y], [b0.x, b0.y], "le rattachement doit ramener le panneau sous l'icône");
  });
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(shots, "native-results.json"), JSON.stringify(results, null, 2));
}
const failed = results.filter((r) => r[0] === "❌").length;
console.log(`\n${results.length - failed}/${results.length} vérifications natives OK`);
process.exitCode = failed ? 1 : 0;
