// Test EN CONDITIONS RÉELLES avec de vraies sessions Claude Code (modèle haiku) :
// 1. l'installeur (CLI) écrit les hooks dans sandbox/.claude/settings.local.json
//    (jamais dans ~/.claude/settings.json) ;
// 2. l'app est lancée avec le même token / port ;
// 3. phase0/sdk-host.mjs lance des sessions comme l'extension VS Code
//    (stream-json + dialogue de permission côté hôte) ;
// 4. on répond depuis le widget (Playwright) et on vérifie l'effet réel.
//
// Usage : node e2e/live.mjs   (après npm run build ; consomme quelques requêtes haiku)
import { _electron as electron } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = path.join(root, "sandbox");
const sandboxSettings = path.join(sandbox, ".claude", "settings.local.json");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fma-live-"));
const PORT = 47896;
const TOKEN = "1".repeat(64);
fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ token: TOKEN, port: PORT, prefs: { sound: false, notifications: false } }));

// sandbox propre
if (!fs.existsSync(path.join(sandbox, ".git"))) execFileSync("node", [path.join(root, "scripts", "make-sandbox.mjs")]);
fs.rmSync(sandboxSettings, { force: true });
const cli = (...args) => execFileSync("node", [path.join(root, "out", "main", "cli.js"), ...args, "--config-dir", tmp], { encoding: "utf8" });
console.log(cli("install", "--settings", sandboxSettings).trim());

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("CLAUDE") || k === "ELECTRON_RUN_AS_NODE") delete env[k];
const appEnv = { ...env, FMA_USER_DATA: tmp, FMA_CLAUDE_SETTINGS: path.join(tmp, "unused-settings.json"), FMA_NO_TRANSCRIPTS: "1", FMA_E2E: "1", FMA_NO_JUMP: "1" };

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

/** Lance une session Claude Code comme l'extension VS Code. */
function session(prompt, hostPolicy = "never", extraEnv = {}) {
  const child = spawn("node", [path.join(root, "phase0", "sdk-host.mjs"), prompt, hostPolicy], {
    cwd: root,
    env: { ...env, KILL_AFTER_MS: "150000", ...extraEnv },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const done = new Promise((resolve) => child.on("exit", () => resolve(out)));
  return { done, out: () => out, kill: () => child.kill() };
}

const app = await electron.launch({ args: [root], env: appEnv, cwd: root });
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
const pendings = () => app.evaluate(() => globalThis.__fma.store.getPendings().map((p) => ({ id: p.id, kind: p.kind, sessionId: p.sessionId })));
const sessions = () => app.evaluate(() => globalThis.__fma.store.getSessions());
const waitPending = async (kind, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = (await pendings()).find((x) => x.kind === kind);
    if (p) {
      await page.waitForSelector(`[data-testid="${kind}"]`);
      await sleep(400);
      return p;
    }
    await sleep(200);
  }
  throw new Error(`aucune demande ${kind} reçue`);
};

try {
  await check("vraie session : permission Bash autorisée depuis le widget → la commande s'exécute", async () => {
    fs.rmSync(path.join(sandbox, "live-allow.txt"), { force: true });
    const s = session("Run exactly this bash command: echo live-allow > live-allow.txt . Then reply OK.");
    await waitPending("permission");
    assert.equal(await app.evaluate(() => globalThis.__fma.panel.visible), true, "le panneau doit s'ouvrir seul");
    await page.getByRole("button", { name: "Autoriser", exact: true }).click();
    const out = await s.done;
    assert.ok(fs.existsSync(path.join(sandbox, "live-allow.txt")), "fichier non créé\n" + out.slice(-600));
    assert.match(out, /HOST DIALOG CANCELLED/, "le dialogue de l'hôte (VS Code) doit être annulé");
  });

  await check("vraie session : permission refusée depuis le widget → la commande n'est pas exécutée", async () => {
    fs.rmSync(path.join(sandbox, "live-deny.txt"), { force: true });
    const s = session("Run exactly this bash command: echo live-deny > live-deny.txt . If refused, do not retry, reply REFUSED.");
    await waitPending("permission");
    await page.getByRole("button", { name: "Refuser", exact: true }).click();
    const out = await s.done;
    assert.equal(fs.existsSync(path.join(sandbox, "live-deny.txt")), false);
    assert.match(out, /RESULT success/);
  });

  await check("vraie session : question AskUserQuestion répondue depuis le widget → l'agent continue avec la bonne option", async () => {
    const s = session(
      "Use the AskUserQuestion tool to ask me ONE question: 'Quelle couleur ?' with header 'Couleur' and exactly three options: 'Rouge', 'Bleu', 'Vert'. After you get my answer, reply with exactly: ANSWER=<the answer I gave>.",
    );
    await waitPending("question");
    await page.getByRole("radio", { name: /Bleu/ }).click();
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    const out = await s.done;
    assert.match(out, /ANSWER=Bleu/, out.slice(-800));
  });

  await check("vraie session : réponse donnée dans VS Code (hôte) → la demande disparaît du widget", async () => {
    fs.rmSync(path.join(sandbox, "live-host.txt"), { force: true });
    const s = session("Run exactly this bash command: echo live-host > live-host.txt . Then reply OK.", "allow:4000");
    await waitPending("permission");
    const t0 = Date.now();
    while ((await pendings()).length > 0) {
      if (Date.now() - t0 > 15000) throw new Error("la demande est restée dans le widget");
      await sleep(100);
    }
    await s.done;
    assert.ok(fs.existsSync(path.join(sandbox, "live-host.txt")));
    assert.equal(await page.locator('[data-testid="permission"]').count(), 0);
  });

  await check("vraie session : commande + sous-agent en arrière-plan suivis jusqu'à leur fin", async () => {
    const cmd = process.platform === "win32" ? "ping -n 15 127.0.0.1 > ping.txt" : "sleep 15";
    const s = session(
      `Do these two things, in this order: (1) Start this bash command IN THE BACKGROUND using the Bash tool with run_in_background=true: ${cmd} . ` +
        "(2) Launch ONE subagent with the Agent tool, subagent_type general-purpose, run_in_background=true, with the task: " +
        "'Use Glob to list *.md files in the current directory, then Read README.md, and reply with a one-line summary.' " +
        "Then immediately end your turn by replying STARTED without waiting for anything.",
      "allow:0",
    );
    // après le 1er Stop : tour fini, travail en arrière-plan
    const end = Date.now() + 90000;
    let seenBackground = false;
    let seenSubagentDone = false;
    while (Date.now() < end) {
      const ss = (await sessions()).filter((x) => x.cwd.endsWith("sandbox") && x.state !== "done");
      for (const x of ss) {
        if (x.state === "idle" && x.background.length > 0) {
          if (!seenBackground) {
            const row = page.locator('[data-testid="agent-row"]', { hasText: x.title.slice(0, 12) });
            if (!(await app.evaluate(() => globalThis.__fma.panel.visible))) await app.evaluate(() => globalThis.__fma.show("click"));
            await row.locator("text=/En arrière-plan/").first().waitFor({ timeout: 3000 });
            await page.screenshot({ path: path.join(root, "docs", "screenshots", "13-arriere-plan-reel.png") }).catch(() => {});
          }
          seenBackground = true;
        }
        if (x.subagents.some((a) => a.status === "done" && a.lastMessage)) seenSubagentDone = true;
      }
      if (seenBackground && seenSubagentDone && s.out().includes("EXIT")) break;
      await sleep(250);
    }
    const out = await s.done;
    assert.ok(seenBackground, "aucune session vue « en arrière-plan »\n" + out.slice(-600));
    assert.ok(seenSubagentDone, "résultat du sous-agent non reçu");
    const last = (await sessions()).filter((x) => x.cwd.endsWith("sandbox")).at(-1);
    assert.deepEqual(last.background, [], "des tâches restent marquées en cours après la fin");
  });

  await check("4 sessions en parallèle : 4 lignes à jour, latence hook → panneau < 1 s", async () => {
    await app.evaluate(() => {
      for (const s of globalThis.__fma.store.getSessions()) globalThis.__fma.store.dismiss(s.id);
    });
    const runs = [1, 2, 3, 4].map((i) =>
      session(`Use the Read tool to read README.md, then use Glob to list *.md files, then reply with exactly: DONE-${i}.`, "allow:0"),
    );
    // mesure de latence : horodatage d'arrivée côté store vs affichage dans le DOM
    const lat = [];
    const end = Date.now() + 90000;
    let seen = 0;
    while (Date.now() < end && seen < 4) {
      const ss = (await sessions()).filter((s) => s.cwd.endsWith("sandbox"));
      seen = ss.length;
      for (const s of ss) {
        const t0 = Date.now();
        await page.waitForSelector(`[data-testid="agent-row"] >> text=${s.title.slice(0, 12)}`, { timeout: 1000 });
        lat.push(Date.now() - t0);
      }
      await sleep(300);
    }
    const outs = await Promise.all(runs.map((r) => r.done));
    assert.equal(seen, 4, `sessions vues : ${seen}`);
    outs.forEach((o, i) => assert.match(o, new RegExp(`DONE-${i + 1}`), o.slice(-400)));
    const ss = (await sessions()).filter((s) => s.cwd.endsWith("sandbox"));
    assert.ok(ss.every((s) => s.state === "idle" || s.state === "done"), JSON.stringify(ss.map((s) => s.state)));
    console.log(`    latence max affichage : ${Math.max(...lat)} ms sur ${lat.length} mesures`);
  });
  await app.evaluate(() => globalThis.__fma.show("click"));
  await sleep(500);
  await page.screenshot({ path: path.join(root, "docs", "screenshots", "11-sessions-reelles.png"), timeout: 5000 }).catch((e) => console.log("capture :", e.message));

  await check("SessionStart (hook command + curl) crée la session avec son titre", async () => {
    const ss = (await sessions()).filter((s) => s.cwd.endsWith("sandbox"));
    assert.ok(ss.length >= 4);
  });
} finally {
  await app.close().catch(() => {});
  console.log(cli("uninstall", "--settings", sandboxSettings).trim());
  const left = fs.existsSync(sandboxSettings) ? JSON.parse(fs.readFileSync(sandboxSettings, "utf8")) : {};
  console.log("settings.local.json après désinstallation :", JSON.stringify(left));
  for (const f of fs.readdirSync(path.dirname(sandboxSettings))) if (f.includes(".fma-backup-")) fs.rmSync(path.join(path.dirname(sandboxSettings), f));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(root, "docs", "screenshots", "live-results.json"), JSON.stringify(results, null, 2));
}
const failed = results.filter((r) => r[0] === "❌").length;
console.log(`\n${results.length - failed}/${results.length} vérifications en conditions réelles OK`);
process.exitCode = failed ? 1 : 0;
