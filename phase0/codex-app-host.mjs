// Phase 0 Codex — « hôte app-server » qui imite l'extension VS Code de Codex :
// lance `codex app-server` (JSON-RPC sur stdio), démarre un fil, envoie un prompt
// et traite les demandes d'approbation (le « dialogue » de VS Code).
// Les hooks sont passés en -c pour cette exécution seulement (rien n'est écrit dans ~/.codex).
//
// Usage : node phase0/codex-app-host.mjs "<prompt>" [hostPolicy]
//   hostPolicy : never | accept:<ms> | decline:<ms>
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [prompt, hostPolicy = "never"] = process.argv.slice(2);
const PORT = Number(process.env.FMA_PORT || 47830);
const TOKEN = process.env.FMA_TOKEN || "sandbox-token";
const logFile = path.join(root, "phase0", "logs", "codex-app-host.jsonl");

function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const ext = path.join(os.homedir(), ".vscode", "extensions");
  const dir = fs.readdirSync(ext).filter((d) => d.startsWith("openai.chatgpt-")).sort().at(-1);
  const plat = process.platform === "win32" ? "windows-x86_64" : process.arch === "arm64" ? "macos-aarch64" : "macos-x86_64";
  return path.join(ext, dir, "bin", plat, process.platform === "win32" ? "codex.exe" : "codex");
}
const curl = process.platform === "win32" ? "curl.exe" : "curl";
const relay = (route) =>
  `${curl} -s -m 600 -X POST -H "Content-Type: application/json" -H "X-FMA-Token: ${TOKEN}" --data-binary "@-" http://127.0.0.1:${PORT}${route}`;
const hook = (route, timeout) => `{hooks=[{type="command",command='${relay(route)}',timeout=${timeout}}]}`;
// avec CODEX_HOME (préparé par codex-home-setup.mjs), les hooks viennent de son hooks.json
const cfg = process.env.CODEX_HOME ? [] : [
  ...(process.env.NO_BYPASS ? [] : ["-c", "bypass_hook_trust=true"]),
  "-c", `hooks.PermissionRequest=[${hook("/hook/permission", 600)}]`,
];
if (!process.env.CODEX_HOME) for (const ev of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]) cfg.push("-c", `hooks.${ev}=[${hook("/hook/event", 10)}]`);

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")));
const child = spawn(findCodex(), ["app-server", ...cfg], { cwd: path.join(root, "sandbox"), env, stdio: ["pipe", "pipe", "pipe"] });
const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (dir, o) => fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), dir, o }) + "\n");
let nextId = 1;
const pending = new Map();
const send = (o) => {
  log("out", o);
  child.stdin.write(JSON.stringify(o) + "\n");
};
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });

let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      console.log(ts(), "RAW", line.slice(0, 160));
      continue;
    }
    log("in", m);
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method && m.id !== undefined) onServerRequest(m);
    else if (m.method) onNotification(m);
  }
});
child.stderr.on("data", (d) => fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), stderr: String(d) }) + "\n"));
child.on("exit", (c) => {
  console.log(ts(), "EXIT", c);
  process.exit(0);
});
setTimeout(() => {
  console.log(ts(), "KILL (timeout)");
  child.kill();
}, Number(process.env.KILL_AFTER_MS || 180000));

function onServerRequest(m) {
  const p = m.params ?? {};
  console.log(ts(), "HOST DIALOG", m.method, JSON.stringify(p.command ?? p.reason ?? p.questions ?? "").slice(0, 140));
  const [kind, ms] = hostPolicy.split(":");
  if (kind === "never") return;
  setTimeout(() => {
    const decision = kind === "accept" ? "accept" : "decline";
    console.log(ts(), "HOST ANSWERS", decision);
    send({ jsonrpc: "2.0", id: m.id, result: { decision } });
  }, Number(ms) || 0);
}

let threadId;
function onNotification(m) {
  const p = m.params ?? {};
  if (m.method === "item/started" || m.method === "item/completed") {
    const it = p.item ?? {};
    if (["commandExecution", "agentMessage", "fileChange"].includes(it.type)) {
      console.log(ts(), m.method, it.type, JSON.stringify(it.command ?? it.text ?? it.status ?? "").slice(0, 140));
    }
  } else if (m.method === "turn/completed") {
    console.log(ts(), "TURN COMPLETED", JSON.stringify(p.turn?.status ?? "").slice(0, 60));
    child.stdin.end();
    setTimeout(() => child.kill(), 1500);
  } else if (/hook|error|serverRequest\/resolved/i.test(m.method)) {
    console.log(ts(), "NOTIF", m.method, JSON.stringify(p).slice(0, 180));
  }
}

(async () => {
  await request("initialize", { clientInfo: { name: "fma-phase0", version: "0.1" } });
  send({ jsonrpc: "2.0", method: "initialized" });
  const th = await request("thread/start", {
    cwd: path.join(root, "sandbox"),
    approvalPolicy: "on-request",
    sandbox: "read-only",
    model: process.env.CODEX_MODEL || "gpt-5.6-luna",
  });
  threadId = th.thread?.id;
  console.log(ts(), "THREAD", threadId);
  await request("turn/start", { threadId, input: [{ type: "text", text: prompt }] });
})().catch((e) => {
  console.log(ts(), "ERREUR", e.message);
  child.kill();
});
