// Test RÉEL de la mise à jour automatique sous Windows :
// 1. installe release/FollowMyAgents-Setup-<v>.exe (silencieux) ;
// 2. sert une fausse release <v+1> (release-test/) via un faux GitHub local ;
// 3. lance l'app installée, déclenche la mise à jour (téléchargement, SHA-256,
//    installeur silencieux, relance) ;
// 4. vérifie que la version installée est <v+1> et que l'app s'est relancée ;
// 5. réinstalle <v> pour laisser une installation propre.
//
// Prérequis : npx electron-builder --win
//             npx electron-builder --win -c.extraMetadata.version=<v+1> -c.directories.output=release-test
// Usage     : node e2e/update-win.mjs
import { _electron as electron } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") process.exit(0);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oldExe = fs.readdirSync(path.join(root, "release")).find((f) => /^FollowMyAgents-Setup-.*\.exe$/.test(f));
const newExe = fs.readdirSync(path.join(root, "release-test")).find((f) => /^FollowMyAgents-Setup-.*\.exe$/.test(f));
const oldV = /Setup-(.*)\.exe/.exec(oldExe)[1];
const newV = /Setup-(.*)\.exe/.exec(newExe)[1];
const installDir = path.join(process.env.LOCALAPPDATA, "Programs", "FollowMyAgents");
const installedExe = path.join(installDir, "FollowMyAgents.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (c) => execFileSync("powershell.exe", ["-NoProfile", "-Command", c], { encoding: "utf8" }).trim();
const installedVersion = () =>
  fs.existsSync(installedExe) ? ps(`(Get-Item '${installedExe}').VersionInfo.ProductVersion`).replace(/\.0$/, "") : ""; // "0.2.0.0" → "0.2.0"
const running = () => ps("(Get-Process FollowMyAgents -ErrorAction SilentlyContinue | Measure-Object).Count") !== "0";
const killApp = () => spawnSync("taskkill", ["/IM", "FollowMyAgents.exe", "/F"]);
const silentInstall = (exe) => spawnSync(exe, ["/S"], { stdio: "ignore" });

console.log(`installé avant : ${installedVersion() || "(rien)"} ; test ${oldV} → ${newV}`);
killApp();
silentInstall(path.join(root, "release", oldExe));
assert.equal(installedVersion(), oldV, "installation initiale");
console.log(`✅ ${oldV} installée silencieusement`);

// faux GitHub
const newPath = path.join(root, "release-test", newExe);
const sha = createHash("sha256").update(fs.readFileSync(newPath)).digest("hex");
const server = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url === "/repos/t/f/releases/latest") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        tag_name: `v${newV}`,
        body: "Version de test",
        html_url: base,
        assets: [
          { name: newExe, browser_download_url: `${base}/dl/${newExe}`, size: fs.statSync(newPath).size },
          { name: "SHA256SUMS.txt", browser_download_url: `${base}/dl/sums`, size: 100 },
        ],
      }),
    );
  }
  if (req.url === "/dl/sums") return res.end(`${sha}  ${newExe}\n`);
  if (req.url === `/dl/${newExe}`) {
    res.writeHead(200, { "Content-Length": fs.statSync(newPath).size });
    return fs.createReadStream(newPath).pipe(res);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fma-upd-"));
fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ token: "d".repeat(64), port: 47891, prefs: { sound: false, notifications: false } }));
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("CLAUDE") || k === "ELECTRON_RUN_AS_NODE") delete env[k];
Object.assign(env, {
  FMA_E2E: "1",
  FMA_USER_DATA: tmp,
  FMA_CLAUDE_SETTINGS: path.join(tmp, "settings.json"),
  FMA_NO_TRANSCRIPTS: "1",
  FMA_UPDATE_API: `http://127.0.0.1:${server.address().port}`,
  FMA_UPDATE_REPO: "t/f",
});

let ok = false;
try {
  const app = await electron.launch({ executablePath: installedExe, env, timeout: 30000 });
  await app.firstWindow();
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), oldV);
  const st = await app.evaluate(() => globalThis.__fma.updater().check());
  assert.equal(st.state, "available", JSON.stringify(st));
  console.log(`✅ ${oldV} détecte la version ${newV}`);
  // déclenche l'installation (sans la boîte de confirmation)
  await app.evaluate(() => void globalThis.__fma.updater().install()).catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if (installedVersion() === newV && running()) break;
    await sleep(1000);
  }
  assert.equal(installedVersion(), newV, "la nouvelle version n'est pas installée");
  assert.ok(running(), "l'app ne s'est pas relancée après la mise à jour");
  console.log(`✅ mise à jour installée (${newV}) et app relancée en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  ok = true;
} catch (e) {
  console.log("❌", e.message);
} finally {
  server.close();
  killApp();
  await sleep(1000);
  // laisse une installation propre de la version réelle
  silentInstall(path.join(root, "release", oldExe));
  console.log(`réinstallé : ${installedVersion()}`);
  killApp();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exitCode = ok ? 0 : 1;
