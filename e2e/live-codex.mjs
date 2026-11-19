// Test EN CONDITIONS RÉELLES avec un vrai Codex (app-server, comme l'extension VS Code) :
// 1. CODEX_HOME temporaire (copie de la connexion, supprimée à la fin) — ~/.codex n'est pas touché ;
// 2. hooks écrits par l'installeur de l'app (CLI --codex) dans ce CODEX_HOME, puis approuvés
//    (trusted_hash) dans son config.toml temporaire ;
// 3. l'app tourne ; phase0/codex-app-host.mjs imite l'extension Codex ;
// 4. on répond depuis le widget et on vérifie l'effet réel.
// Usage : node e2e/live-codex.mjs   (après npm run build ; consomme quelques requêtes Codex)
import { _electron as electron } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = path.join(root, "sandbox");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fma-livecx-"));
const codexHome = path.join(tmp, "codex-home");
const PORT = 47888;
const TOKEN = "c".repeat(64);
fs.mkdirSync(codexHome, { recursive: true });
fs.writeFileSync(
  path.join(tmp, "config.json"),
  JSON.stringify({ token: TOKEN, port: PORT, prefs: { sound: false, notifications: false, autoUpdateCheck: false, showQuota: false, codexPendingTimeoutSec: 12 } }),
);
if (!fs.existsSync(path.join(sandbox, ".git"))) execFileSync("node", [path.join(root, "scripts", "make-sandbox.mjs")]);

// --- CODEX_HOME temporaire ---
fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(codexHome, "auth.json"));
fs.writeFileSync(path.join(codexHome, "config.toml"), 'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "low"\n');
const hooksFile = path.join(codexHome, "hooks.json");
console.log(execFileSync("node", [path.join(root, "out", "main", "cli.js"), "install", "--codex", "--settings", hooksFile, "--config-dir", tmp], { encoding: "utf8" }).trim());

function findCodex() {
  const ext = path.join(os.homedir(), ".vscode", "extensions");
  const dir = fs.readdirSync(ext).filter((d) => d.startsWith("openai.chatgpt-")).sort().at(-1);
  const plat = process.platform === "win32" ? "windows-x86_64" : process.arch === "arm64" ? "macos-aarch64" : "macos-x86_64";
  return path.join(ext, dir, "bin", plat, process.platform === "win32" ? "codex.exe" : "codex");
}
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE") && k !== "ELECTRON_RUN_AS_NODE"));

// approbation des hooks (comme « Review hooks » dans Codex), dans le config.toml TEMPORAIRE
async function trustHooks() {
  const child = spawn(findCodex(), ["app-server"], { cwd: sandbox, env: { ...baseEnv, CODEX_HOME: codexHome }, stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  const waiters = new Map();
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (waiters.has(m.id)) waiters.get(m.id)(m);
      } catch {}
    }
  });
  const rpc = (id, method, params) =>
    new Promise((r) => {
      waiters.set(id, r);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  await rpc(1, "initialize", { clientInfo: { name: "fma-trust", version: "0.1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
  const res = await rpc(2, "hooks/list", { cwds: [sandbox] });
  child.kill();
  const mine = (res.result?.data ?? []).flatMap((e) => e.hooks).filter((h) => h.source === "user");
  let toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  for (const h of mine) toml += `\n[hooks.state.${JSON.stringify(h.key)}]\ntrusted_hash = ${JSON.stringify(h.currentHash)}\n`;
  fs.writeFileSync(path.join(codexHome, "config.toml"), toml);
  return mine.length;
}

const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(["✅", name]);
    console.log("✅", name, `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push(["❌", name, e.message]);
    console.log("❌", name, "\n   ", e.message);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function session(prompt, hostPolicy = "never") {
  const child = spawn("node", [path.join(root, "phase0", "codex-app-host.mjs"), prompt, hostPolicy], {
    cwd: root,
    env: { ...baseEnv, CODEX_HOME: codexHome, FMA_PORT: String(PORT), KILL_AFTER_MS: "150000" },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  return { done: new Promise((r) => child.on("exit", () => r(out))) };
}
const P = (file) =>
  `Run this exact shell command to create a file: echo codex-ok > ${file} . If it fails because of the sandbox, request escalated permissions and retry. Then reply DONE.`;
const fileOk = (f) => fs.existsSync(path.join(sandbox, f)) && fs.readFileSync(path.join(sandbox, f)).toString("utf8").replace(/\0/g, "").includes("codex-ok");

const n = await trustHooks();
console.log(`${n} hooks Codex approuvés (config temporaire)`);
const app = await electron.launch({
  args: [root],
  env: { ...baseEnv, FMA_USER_DATA: tmp, FMA_CLAUDE_SETTINGS: path.join(tmp, "s.json"), FMA_NO_TRANSCRIPTS: "1", FMA_E2E: "1", FMA_NO_JUMP: "1", FMA_NO_GLASS: "1", FMA_EVENT_LOG: path.join(root, "e2e", "tmp", "codex-events.jsonl") },
  cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
const pendings = () => app.evaluate(() => globalThis.__fma.store.getPendings().map((p) => ({ id: p.id, sessionId: p.sessionId })));
const waitPending = async (ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = (await pendings())[0];
    if (p) {
      await page.waitForSelector('[data-testid="permission"]');
      await sleep(400);
      return p;
    }
    await sleep(200);
  }
  throw new Error("aucune demande Codex reçue");
};

try {
  await check("Codex réel : autorisé depuis le widget → la commande s'exécute, sans dialogue VS Code", async () => {
    fs.rmSync(path.join(sandbox, "cx-allow.txt"), { force: true });
    const s = session(P("cx-allow.txt"));
    const p = await waitPending();
    const sess = await app.evaluate((_e, id) => globalThis.__fma.store.getSession(id), p.sessionId);
    assert.equal(sess.agent, "codex");
    assert.match(await page.locator('[data-testid="permission"]').innerText(), /Codex/);
    await page.screenshot({ path: path.join(root, "docs", "screenshots", "17-codex-permission.png") });
    await page.getByRole("button", { name: "Autoriser", exact: true }).click();
    const out = await s.done;
    assert.ok(fileOk("cx-allow.txt"), "fichier non créé\n" + out.slice(-500));
    assert.doesNotMatch(out, /HOST DIALOG/, "le dialogue VS Code n'aurait pas dû apparaître");
  });

  await check("Codex réel : refusé depuis le widget → la commande n'est pas exécutée", async () => {
    fs.rmSync(path.join(sandbox, "cx-deny.txt"), { force: true });
    const s = session(P("cx-deny.txt").replace("and retry", "and retry once; if refused again, stop"));
    await waitPending();
    await page.getByRole("button", { name: "Refuser", exact: true }).click();
    // Codex peut redemander une fois : on refuse aussi
    const again = await Promise.race([waitPending(15000).then(() => true), sleep(15000).then(() => false)]).catch(() => false);
    if (again) await page.getByRole("button", { name: "Refuser", exact: true }).click();
    await s.done;
    assert.equal(fileOk("cx-deny.txt"), false);
  });

  await check("Codex réel : sans réponse dans le délai (12 s), la demande repasse dans le dialogue VS Code", async () => {
    fs.rmSync(path.join(sandbox, "cx-timeout.txt"), { force: true });
    const s = session(P("cx-timeout.txt"), "accept:500");
    await waitPending();
    const out = await s.done;
    assert.match(out, /HOST DIALOG/, "le dialogue VS Code aurait dû apparaître après le délai");
    assert.ok(fileOk("cx-timeout.txt"), "fichier non créé après acceptation dans VS Code");
    assert.equal((await pendings()).length, 0);
  });

  await check("Codex réel : la session apparaît avec son badge et son activité", async () => {
    await app.evaluate(() => globalThis.__fma.show("click"));
    await sleep(500);
    const ss = await app.evaluate(() => globalThis.__fma.store.getSessions().filter((s) => s.agent === "codex"));
    console.log("    sessions Codex :", JSON.stringify(ss.map((s) => ({ state: s.state, subtitle: s.subtitle, title: s.title, activity: s.activity.length, last: s.lastCommand?.command }))));
    assert.ok(ss.length >= 1);
    assert.ok(ss.some((s) => s.activity.length > 0), "aucune activité enregistrée");
    // sessions terminées : rangées dans « Terminés », section repliée par défaut
    const done = page.getByRole("button", { name: /Terminés/ });
    if (await done.count()) await done.click();
    await sleep(300);
    assert.ok((await page.locator(".agent-tag", { hasText: "Codex" }).count()) >= 1, "badge Codex absent");
    await page.screenshot({ path: path.join(root, "docs", "screenshots", "18-codex-sessions.png") });
  });
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true }); // supprime aussi la copie de la connexion Codex
  console.log("CODEX_HOME temporaire supprimé :", !fs.existsSync(codexHome));
}
const failed = results.filter((r) => r[0] === "❌").length;
console.log(`\n${results.length - failed}/${results.length} vérifications Codex OK`);
process.exitCode = failed ? 1 : 0;
