// Test de bout en bout + captures d'écran (Playwright pilote Electron).
// L'app est lancée isolée : dossier de config temporaire, settings.json factice,
// port dédié, pas de lecture des transcripts réels.
//
// Usage : npm run e2e          (build + tests + captures dans docs/screenshots/)
import { _electron as electron } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "docs", "screenshots");
fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fma-e2e-"));
const userData = path.join(tmp, "userData");
const fakeSettings = path.join(tmp, "claude", "settings.json");
const PORT = 47899;
const TOKEN = "e".repeat(64);
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ token: TOKEN, port: PORT, prefs: { sound: false, notifications: false, autoUpdateCheck: false } }));

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("CLAUDE") || k === "ELECTRON_RUN_AS_NODE") delete env[k];
Object.assign(env, {
  FMA_USER_DATA: userData,
  FMA_CLAUDE_SETTINGS: fakeSettings,
  FMA_NO_TRANSCRIPTS: "1",
  FMA_E2E: "1",
  FMA_NO_JUMP: "1",
  FMA_NO_GLASS: process.env.FMA_GLASS === "1" ? "0" : "1",
});

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

function post(route, body, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: route, method: "POST", headers: { "Content-Type": "application/json", "X-FMA-Token": token } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
      },
    );
    const t0 = Date.now();
    req.on("error", (e) => {
      console.log(`   [post ${route} erreur après ${Date.now() - t0} ms : ${e.message}]`);
      reject(e);
    });
    req.end(data);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// attend l'apparition d'un bloc d'attention et la fin de son animation de dépliage (220 ms)
let page;
const waitBlock = async (kind) => {
  await page.waitForSelector(`[data-testid="${kind}"]`, { timeout: 5000 });
  await sleep(350);
};
const ev = (sid, name, extra = {}) =>
  post("/hook/event", { session_id: sid, transcript_path: "", cwd: `C:\\work\\${sid}`, hook_event_name: name, ...extra });

// faux GitHub : une release 9.9.9 pour vérifier le bandeau de mise à jour
const fakeGh = http.createServer((req, res) => {
  if (req.url === "/repos/test/fma/releases/latest") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      tag_name: "v9.9.9", body: "Notes", html_url: "https://example.invalid", draft: false, prerelease: false,
      assets: [
        { name: "FollowMyAgents-Setup-9.9.9.exe", browser_download_url: "http://127.0.0.1/x.exe", size: 1 },
        { name: "FollowMyAgents-9.9.9-mac-universal.zip", browser_download_url: "http://127.0.0.1/x.zip", size: 1 },
        { name: "SHA256SUMS.txt", browser_download_url: "http://127.0.0.1/s", size: 1 },
      ],
    }));
  } else res.writeHead(404).end();
});
await new Promise((r) => fakeGh.listen(0, "127.0.0.1", r));
env.FMA_UPDATE_API = `http://127.0.0.1:${fakeGh.address().port}`;
env.FMA_UPDATE_REPO = "test/fma";

const app = await electron.launch({ args: [root], env, cwd: root, timeout: 30000 });
const mainLog = fs.createWriteStream(path.join(root, "e2e", "tmp", "main.log"));
fs.mkdirSync(path.join(root, "e2e", "tmp"), { recursive: true });
app.process().stdout?.pipe(mainLog);
app.process().stderr?.pipe(mainLog);
app.process().on("exit", (code) => console.log("electron exit", code));
page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
const show = (r = "click") => app.evaluate((_e, r) => globalThis.__fma.show(r), r);
const hide = () => app.evaluate(() => globalThis.__fma.hide());
const visible = () => app.evaluate(() => globalThis.__fma.panel.visible);
const shot = async (name) => {
  await sleep(450);
  await page.screenshot({ path: path.join(shots, `${name}.png`), omitBackground: true });
};

try {
  await check("au repos : aucune fenêtre visible", async () => {
    await sleep(800);
    assert.equal(await visible(), false);
  });

  await check("serveur : 401 sans token valide", async () => {
    const r = await post("/hook/event", { session_id: "x", hook_event_name: "Stop" }, "bad");
    assert.equal(r.status, 401);
  });

  // ---- état vide ----
  await show("click");
  await page.waitForSelector('[data-testid="panel"]');
  await shot("01-vide");
  await check("état vide + avertissement hooks non installés", async () => {
    assert.match(await page.locator(".empty").innerText(), /Aucun agent/);
    assert.match(await page.locator(".notice").innerText(), /Hooks non installés/);
  });
  await hide();

  // ---- 4 sessions (données de la maquette A) ----
  await ev("idea-scout", "SessionStart", { session_title: "Idea Scout" });
  await ev("polish", "SessionStart", { session_title: "Polish · Watch Videos" });
  await ev("breakdown", "SessionStart", { session_title: "Breakdown reel" });
  await ev("cheat", "SessionStart", { session_title: "Cheat sheet · Tokens" });
  const todos = (labels, doneCount) =>
    labels.map((l, i) => ({ content: l, activeForm: l, status: i < doneCount ? "completed" : i === doneCount ? "in_progress" : "pending" }));
  await ev("polish", "UserPromptSubmit", { prompt: "polish" });
  await ev("polish", "PostToolUse", {
    tool_name: "TodoWrite",
    tool_input: { todos: todos(["Read final-cut-transcript.md", "Write style-sheet.md", "Render 01-hook.mp4", "Render 02-problem.mp4", "Render 03-huddle.mp4", "Render 04-outro.mp4", "Build CapCut project"], 5) },
  });
  await ev("polish", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npx hyperframes render . -o 03-huddle.mp4", description: "Rendu des animations" } });
  await ev("polish", "PostToolUse", {
    tool_name: "Bash",
    tool_input: { command: "npx hyperframes render . -o 03-huddle.mp4", description: "Rendu des animations" },
    tool_response: { stdout: "loading composition…\nrendering frame 83/139…\nrendering frame 84/139…", stderr: "" },
  });
  await ev("polish", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npx hyperframes render . -o 04-outro.mp4", description: "Rendu des animations" } });
  await ev("breakdown", "UserPromptSubmit", { prompt: "breakdown" });
  await ev("breakdown", "PostToolUse", { tool_name: "TodoWrite", tool_input: { todos: todos(["Watch", "Transcribe", "Outline", "Draft", "Review"], 2) } });
  await ev("breakdown", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "C:\\work\\breakdown\\transcript.md" } });
  await ev("cheat", "UserPromptSubmit", { prompt: "cheat" });
  await ev("cheat", "PostToolUse", { tool_name: "TodoWrite", tool_input: { todos: todos(["Collect", "Group", "Draft", "Polish", "Export"], 3) } });
  await ev("cheat", "PreToolUse", { tool_name: "Write", tool_input: { file_path: "C:\\work\\cheat\\brouillon.md" } });
  await ev("idea-scout", "UserPromptSubmit", { prompt: "scout" });

  // ---- permission : ouverture auto sans focus ----
  const permBody = {
    session_id: "idea-scout",
    transcript_path: "",
    cwd: "C:\\work\\idea-scout",
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "npx hyperframes render . -o out.mp4", description: "Render" },
    permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npx hyperframes render:*" }], behavior: "allow", destination: "localSettings" }],
  };
  let permReq = post("/hook/permission", permBody);
  await page.waitForSelector('[data-testid="permission"]', { timeout: 5000 });
  await check("une demande ouvre le panneau automatiquement (showInactive, sans focus)", async () => {
    assert.equal(await visible(), true);
    assert.equal(await app.evaluate(() => globalThis.__fma.panel.openedBy), "auto");
    assert.equal(await app.evaluate(() => globalThis.__fma.panel.win.isFocused()), false);
  });
  await check("mise à jour du panneau < 1 s après un événement", async () => {
    const t0 = Date.now();
    await ev("cheat", "PreToolUse", { tool_name: "Grep", tool_input: { pattern: "token-latency" } });
    await page.waitForSelector('text=Recherche de « token-latency »', { timeout: 1000 });
    const dt = Date.now() - t0;
    assert.ok(dt < 1000, `${dt} ms`);
    await ev("cheat", "PreToolUse", { tool_name: "Write", tool_input: { file_path: "C:\\work\\cheat\\brouillon.md" } });
  });
  await shot("02-permission");

  await check("permission : clic Autoriser → réponse allow + flash + fermeture auto", async () => {
    await page.getByRole("button", { name: "Autoriser", exact: true }).click();
    const r = await permReq;
    assert.deepEqual(r.body, { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    await page.waitForSelector("text=Autorisé", { timeout: 1000 });
    await shot("03-flash-autorise");
    await sleep(1800);
    assert.equal(await visible(), false, "le panneau ouvert automatiquement doit se refermer");
  });

  await check("permission : Refuser → deny", async () => {
    permReq = post("/hook/permission", permBody);
    await waitBlock('permission');
    await page.getByRole("button", { name: "Refuser", exact: true }).click();
    const r = await permReq;
    assert.equal(r.body.hookSpecificOutput.decision.behavior, "deny");
  });

  await check("permission : Toujours autoriser → updatedPermissions", async () => {
    permReq = post("/hook/permission", permBody);
    await waitBlock('permission');
    await page.getByRole("button", { name: "Toujours autoriser", exact: true }).click();
    const r = await permReq;
    assert.deepEqual(r.body.hookSpecificOutput.decision.updatedPermissions, permBody.permission_suggestions);
  });

  await check("panneau ouvert par clic : reste ouvert après la réponse", async () => {
    await sleep(1700);
    await show("click");
    permReq = post("/hook/permission", permBody);
    await waitBlock('permission');
    await page.getByRole("button", { name: "Autoriser", exact: true }).click();
    await permReq;
    await sleep(1900);
    assert.equal(await visible(), true);
  });

  await check("réponse donnée dans VS Code (requête fermée) → demande retirée du widget", async () => {
    const ac = new AbortController();
    const req = http.request({
      host: "127.0.0.1",
      port: PORT,
      path: "/hook/permission",
      method: "POST",
      headers: { "Content-Type": "application/json", "X-FMA-Token": TOKEN },
      signal: ac.signal,
    });
    req.on("error", () => {});
    req.end(JSON.stringify(permBody));
    await waitBlock('permission');
    ac.abort();
    await page.waitForSelector('[data-testid="permission"]', { state: "detached", timeout: 2000 });
  });

  // ---- question ----
  const qBody = {
    ...permBody,
    session_id: "breakdown",
    cwd: "C:\\work\\breakdown",
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [
        {
          question: "Quel hook utiliser ?",
          header: "Hook",
          multiSelect: false,
          options: [
            { label: "Celui sur la douleur", description: "Ouvre sur le problème" },
            { label: "Celui avec un chiffre" },
            { label: "Celui en question" },
          ],
        },
      ],
    },
  };
  delete qBody.permission_suggestions;
  let qReq = post("/hook/permission", qBody);
  await waitBlock('question');
  await shot("04-question");
  await check("question : choix + Envoyer → updatedInput.answers", async () => {
    await page.getByRole("radio", { name: /Celui sur la douleur/ }).click();
    await shot("05-question-choisie");
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    const r = await qReq;
    assert.deepEqual(r.body.hookSpecificOutput.decision.updatedInput.answers, { "Quel hook utiliser ?": "Celui sur la douleur" });
    assert.deepEqual(r.body.hookSpecificOutput.decision.updatedInput.questions, qBody.tool_input.questions);
    await page.waitForSelector("text=Réponse : « Celui sur la douleur »", { timeout: 1000 });
  });

  await check("question : réponse libre « Autre… »", async () => {
    qReq = post("/hook/permission", qBody);
    await waitBlock('question');
    await page.getByPlaceholder("Autre…").fill("Une accroche sur la vitesse");
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    const r = await qReq;
    assert.deepEqual(r.body.hookSpecificOutput.decision.updatedInput.answers, { "Quel hook utiliser ?": "Une accroche sur la vitesse" });
  });

  await check("questions multiples + multiSelect : Envoyer actif seulement quand tout est répondu", async () => {
    const multi = {
      ...qBody,
      tool_input: {
        questions: [
          qBody.tool_input.questions[0],
          { question: "Quels formats ?", header: "Export", multiSelect: true, options: [{ label: "mp4" }, { label: "gif" }, { label: "webm" }] },
        ],
      },
    };
    qReq = post("/hook/permission", multi);
    await waitBlock('question');
    await page.getByRole("radio", { name: /Celui avec un chiffre/ }).click();
    assert.equal(await page.getByRole("button", { name: "Envoyer", exact: true }).isDisabled(), true);
    await page.getByRole("checkbox", { name: /mp4/ }).click();
    await page.getByRole("checkbox", { name: /gif/ }).click();
    await shot("06-questions-multiples");
    assert.equal(await page.getByRole("button", { name: "Envoyer", exact: true }).isDisabled(), false);
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    const r = await qReq;
    assert.deepEqual(r.body.hookSpecificOutput.decision.updatedInput.answers, { "Quel hook utiliser ?": "Celui avec un chiffre", "Quels formats ?": "mp4, gif" });
  });

  await check("« Répondre dans VS Code » → réponse vide (dialogue habituel)", async () => {
    qReq = post("/hook/permission", qBody);
    await waitBlock('question');
    await page.getByRole("button", { name: "Répondre dans VS Code", exact: true }).click();
    const r = await qReq;
    assert.equal(r.status, 200);
    assert.equal(r.body, null);
    // et VS Code est mis au premier plan sur cette session (jump neutralisé en test)
    assert.deepEqual(await app.evaluate(() => globalThis.__fma.lastJump()), { sessionId: "breakdown", cwd: qBody.cwd });
  });

  // ---- vue détail ----
  await sleep(1700);
  await ev("breakdown", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "C:\\work\\breakdown\\transcript.md" } });
  await shot("07-liste");
  await check("vue détail : étapes, terminal, mini-avatars", async () => {
    await page.locator('[data-testid="agent-row"]', { hasText: "Polish" }).click();
    await page.waitForSelector('[data-testid="detail"]');
    await sleep(300);
    assert.match(await page.locator(".d-prog").innerText(), /5\/7/);
    assert.equal(await page.locator(".step").count(), 7);
    assert.match(await page.locator(".term").innerText(), /hyperframes render/);
    assert.ok((await page.locator(".mini-agents button").count()) >= 2);
  });
  await shot("08-detail");
  await page.getByRole("button", { name: "Agents", exact: true }).click();

  // ---- session sans plan : activité récente ----
  await check("sans plan (TodoWrite désactivé) : la vue détail montre l'activité récente cochée", async () => {
    const sid = "activite";
    await ev(sid, "SessionStart", { session_title: "Refacto auth" });
    await ev(sid, "UserPromptSubmit", { prompt: "refacto" });
    const tools = [
      ["Read", { file_path: "C:\\work\\activite\\src\\auth.ts" }],
      ["Grep", { pattern: "createSession" }],
      ["Edit", { file_path: "C:\\work\\activite\\src\\auth.ts" }],
      ["Bash", { command: "npm test", description: "Lance les tests" }],
    ];
    for (const [i, [tool, input]] of tools.entries()) {
      await ev(sid, "PreToolUse", { tool_name: tool, tool_input: input, tool_use_id: `t${i}` });
      if (i < tools.length - 1) await ev(sid, "PostToolUse", { tool_name: tool, tool_input: input, tool_use_id: `t${i}`, tool_response: {} });
    }
    await page.locator('[data-testid="agent-row"]', { hasText: "Refacto auth" }).click();
    await page.waitForSelector('[data-testid="activity"]');
    await sleep(300);
    const items = page.locator('[data-testid="activity"] .step');
    assert.equal(await items.count(), 4);
    assert.equal(await page.locator('[data-testid="activity"] .step.completed').count(), 3);
    assert.equal(await page.locator('[data-testid="activity"] .step.in_progress').count(), 1);
    assert.match(await page.locator('[data-testid="activity"]').innerText(), /Lance les tests/);
    await shot("14-activite-recente");
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await app.evaluate(() => globalThis.__fma.store.dismiss("activite"));
  });

  // ---- sous-agents et tâches en arrière-plan (format réel, voir tests/fixtures) ----
  await check("arrière-plan : la ligne indique le travail en fond, la vue détail liste sous-agents et tâches", async () => {
    await ev("polish", "PostToolUse", {
      tool_name: "Bash",
      tool_input: { command: "npm run render:all", description: "Rendu complet", run_in_background: true },
      tool_response: { stdout: "", stderr: "", backgroundTaskId: "bg1" },
    });
    await ev("polish", "PostToolUse", {
      tool_name: "Agent",
      tool_input: { description: "Vérifier les sous-titres", subagent_type: "Explore", run_in_background: true },
      tool_response: { isAsync: true, status: "async_launched", agentId: "ag1" },
    });
    await ev("polish", "SubagentStart", { agent_id: "ag1", agent_type: "Explore" });
    await ev("polish", "SubagentStart", { agent_id: "ag0", agent_type: "general-purpose" });
    await ev("polish", "SubagentStop", { agent_id: "ag0", agent_type: "general-purpose", last_assistant_message: "Les 7 clips ont la bonne durée." });
    await ev("polish", "Stop", {
      last_assistant_message: "Rendu lancé en arrière-plan.",
      background_tasks: [
        { id: "bg1", type: "shell", status: "running", description: "Rendu complet", command: "npm run render:all" },
        { id: "ag1", type: "subagent", status: "running", description: "Vérifier les sous-titres", agent_type: "Explore" },
      ],
    });
    await ev("polish", "PreToolUse", { agent_id: "ag1", agent_type: "Explore", tool_name: "Read", tool_input: { file_path: "C:\\work\\polish\\subs.srt" } });
    const row = page.locator('[data-testid="agent-row"]', { hasText: "Polish" });
    await row.locator("text=En arrière-plan · Explore · Lecture de subs.srt").waitFor({ timeout: 2000 });
    // (Polish a une liste d'étapes : l'anneau reste affiché à droite plutôt que « 2 en fond »)
    await row.click();
    await page.waitForSelector('[data-testid="tasks"]');
    await sleep(300);
    const txt = await page.locator('[data-testid="tasks"]').innerText();
    assert.match(txt, /Explore/);
    assert.match(txt, /npm run render:all/);
    assert.match(txt, /Les 7 clips ont la bonne durée/);
    await shot("12-arriere-plan");
    await page.getByRole("button", { name: "Agents", exact: true }).click();
  });

  // ---- fin de tour, erreur, terminé ----
  await ev("cheat", "Stop", { last_assistant_message: "Le brouillon de la cheat sheet est prêt dans brouillon.md.\nIl reste à valider la section latence." });
  await ev("idea-scout", "SessionEnd", { reason: "other" });
  await ev("breakdown", "StopFailure", { error: "rate_limit", last_assistant_message: "API Error: Rate limit reached" });
  await page.getByRole("button", { name: /Terminés/ }).click();
  await shot("09-etats");
  await check("× retire une session", async () => {
    const before = await page.locator('[data-testid="agent-row"]').count();
    const row = page.locator('[data-testid="agent-row"]', { hasText: "Breakdown" });
    await row.hover();
    await row.getByRole("button", { name: "Retirer de la liste", exact: true }).click();
    await sleep(200);
    assert.equal(await page.locator('[data-testid="agent-row"]').count(), before - 1);
  });

  await check("mise à jour : une release plus récente affiche le bandeau « Version disponible »", async () => {
    const st = await app.evaluate(() => globalThis.__fma.updater().check());
    assert.equal(st.state, "available");
    await page.waitForSelector('[data-testid="update"]', { timeout: 2000 });
    assert.match(await page.locator('[data-testid="update"]').innerText(), /Version 9\.9\.9 disponible/);
    await shot("15-mise-a-jour");
  });

  await check("bouton son : préférence mémorisée", async () => {
    await page.getByRole("button", { name: "Activer le son", exact: true }).click();
    await sleep(200);
    const cfg = JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8"));
    assert.equal(cfg.prefs.sound, true);
  });

  await check("Échap ferme le panneau", async () => {
    await app.evaluate(() => globalThis.__fma.panel.takeFocus());
    await page.keyboard.press("Escape");
    await sleep(300);
    assert.equal(await visible(), false);
  });

  await check("prefers-reduced-motion : animations coupées", async () => {
    await show("click");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dur = await page.evaluate(() => {
      const el = document.querySelector(".mascot .body");
      return el ? getComputedStyle(el).animationName : "none";
    });
    assert.equal(dur, "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  await check("le settings.json factice n'a pas été créé (aucune installation implicite)", async () => {
    assert.equal(fs.existsSync(fakeSettings), false);
  });
} finally {
  await app.close().catch(() => {});
  fakeGh.close();
  fs.writeFileSync(path.join(shots, "e2e-results.json"), JSON.stringify(results, null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => r[0] === "❌").length;
console.log(`\n${results.length - failed}/${results.length} vérifications OK`);
process.exitCode = failed ? 1 : 0;
