// Phase 0 — « hôte SDK » minimal qui imite l'extension VS Code :
// lance `claude -p --input-format stream-json --output-format stream-json
// --permission-prompt-tool stdio` dans ./sandbox, envoie un prompt, et traite
// les demandes `can_use_tool` (le « dialogue » de l'hôte).
//
// Usage :
//   node phase0/sdk-host.mjs "<prompt>" [hostPolicy] [--model haiku]
// hostPolicy (réponse de l'hôte au dialogue de permission/question) :
//   never          : l'hôte ne répond jamais (utilisateur absent de VS Code)
//   allow:<ms>     : l'hôte autorise après <ms>
//   deny:<ms>      : l'hôte refuse après <ms>
//   answer:<label>:<ms> : l'hôte répond à AskUserQuestion avec <label> après <ms>
//
// Toutes les lignes échangées sont journalisées dans phase0/logs/sdk-host.jsonl.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const logFile = path.join(here, "logs", "sdk-host.jsonl");
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = (dir, obj) => fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), dir, obj }) + "\n");

const [prompt, hostPolicy = "never", ...rest] = process.argv.slice(2);
const model = rest.includes("--model") ? rest[rest.indexOf("--model") + 1] : "haiku";
const killAfter = Number(process.env.KILL_AFTER_MS || 240000);

function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const ext = path.join(os.homedir(), ".vscode", "extensions");
  const dirs = fs.readdirSync(ext).filter((d) => d.startsWith("anthropic.claude-code-")).sort();
  const nb = path.join(ext, dirs.at(-1), "resources", "native-binary");
  return path.join(nb, fs.readdirSync(nb).find((f) => f.startsWith("claude")));
}

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE") || k.startsWith("CLAUDE_CODE_ENABLE_T")));
const child = spawn(
  findClaude(),
  ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
   "--permission-prompt-tool", "stdio", "--model", model, ...(process.env.PERM_MODE ? ["--permission-mode", process.env.PERM_MODE] : [])],
  { cwd: path.join(root, "sandbox"), env, stdio: ["pipe", "pipe", "pipe"] },
);
const send = (obj) => { log("out", obj); child.stdin.write(JSON.stringify(obj) + "\n"); };
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

send({ type: "control_request", request_id: "init-1", request: { subtype: "initialize" } });
send({ type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null, session_id: "" });

let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { console.log(stamp(), "RAW", line.slice(0, 200)); continue; }
    log("in", msg);
    handle(msg);
  }
});
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("exit", (code) => { console.log(stamp(), "EXIT", code); process.exit(0); });
setTimeout(() => { console.log(stamp(), "KILL (timeout)"); child.kill(); }, killAfter);

function handle(msg) {
  if (msg.type === "system" && msg.subtype === "init") console.log(stamp(), "INIT session", msg.session_id, "tools:", (msg.tools || []).filter((t) => /Ask|Task|Todo/.test(t)).join(","));
  else if (msg.type === "control_request") {
    const r = msg.request;
    console.log(stamp(), "HOST DIALOG", r.subtype, r.tool_name, JSON.stringify(r.input).slice(0, 160));
    if (r.subtype !== "can_use_tool") return;
    const [kind, a, b] = hostPolicy.split(":");
    if (kind === "never") return;
    const delay = Number(kind === "answer" ? b : a) || 0;
    setTimeout(() => {
      let response;
      if (kind === "allow") response = { behavior: "allow", updatedInput: r.input };
      else if (kind === "deny") response = { behavior: "deny", message: "denied by host" };
      else if (kind === "answer") {
        const answers = {};
        for (const q of r.input.questions || []) answers[q.question] = a;
        response = { behavior: "allow", updatedInput: { ...r.input, answers } };
      }
      console.log(stamp(), "HOST ANSWERS", JSON.stringify(response).slice(0, 160));
      send({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response } });
    }, delay);
  } else if (msg.type === "control_cancel_request") console.log(stamp(), "HOST DIALOG CANCELLED", msg.request_id);
  else if (msg.type === "assistant") {
    for (const c of msg.message?.content || []) {
      if (c.type === "tool_use") console.log(stamp(), "TOOL_USE", c.name, JSON.stringify(c.input).slice(0, 160));
      if (c.type === "text") console.log(stamp(), "TEXT", c.text.slice(0, 200).replace(/\n/g, " "));
    }
  } else if (msg.type === "user") {
    for (const c of msg.message?.content || []) if (c.type === "tool_result") console.log(stamp(), "TOOL_RESULT", JSON.stringify(c.content).slice(0, 200));
  } else if (msg.type === "result") {
    console.log(stamp(), "RESULT", msg.subtype, (msg.result || "").slice(0, 200));
    child.stdin.end();
  }
}
