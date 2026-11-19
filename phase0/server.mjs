// Phase 0 — serveur HTTP minimal pour valider les hooks Claude Code.
// - Journalise chaque requête de hook dans phase0/logs/events.jsonl
// - /hook/permission et /hook/question répondent selon phase0/logs/policy.json
//   (relu à chaque requête, donc modifiable entre deux sessions de test).
//
// Politiques possibles (policy.json) :
//   { "permission": "allow" | "deny" | "empty" | "hold:<ms>",
//     "question":   "answer:<label>" | "empty" | "first" | "hold:<ms>" }
//
// Usage : node phase0/server.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(here, "logs");
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, "events.jsonl");
const policyFile = path.join(logDir, "policy.json");
const PORT = Number(process.argv[2] || process.env.FMA_PORT || 47821);
const TOKEN = process.env.FMA_TOKEN || "sandbox-token";

function policy() {
  try {
    return JSON.parse(fs.readFileSync(policyFile, "utf8"));
  } catch {
    return { permission: "allow", question: "first" };
  }
}

function log(entry) {
  fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...entry }) + "\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  let body = "";
  const t0 = Date.now();
  res.on("close", () => {
    if (!res.writableFinished) {
      log({ aborted: req.url, afterMs: Date.now() - t0 });
      console.log(`client closed ${req.url} after ${Date.now() - t0} ms (before our reply)`);
    }
  });
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {}
    const tokenOk = req.headers["x-fma-token"] === TOKEN;
    log({ url: req.url, tokenOk, headers: { "x-fma-token": req.headers["x-fma-token"] ? "<present>" : null }, body: json ?? body });
    if (!tokenOk) {
      res.writeHead(401).end();
      return;
    }
    const p = policy();
    let out = null;
    if (req.url === "/hook/permission") {
      let mode = p.permission || "allow";
      // "qanswer:<label>:<ms>" : répondre à AskUserQuestion via PermissionRequest (allow + updatedInput.answers)
      const qa = /^qanswer:([^:]+):(\d+)$/.exec(mode);
      if (qa && json?.tool_name === "AskUserQuestion") {
        await sleep(Number(qa[2]));
        const answers = {};
        for (const q of json.tool_input.questions || []) answers[q.question] = qa[1];
        mode = "custom";
        out = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedInput: { ...json.tool_input, answers } } } };
      }
      // "allow:<ms>" / "deny:<ms>" : décision différée
      const m = /^(allow|deny):(\d+)$/.exec(mode);
      if (m) { await sleep(Number(m[2])); mode = m[1]; }
      if (mode.startsWith("hold:")) {
        await sleep(Number(mode.slice(5)));
        out = null;
      } else if (mode === "allow") {
        out = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
      } else if (mode === "deny") {
        out = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Refusé depuis FollowMyAgents" } } };
      }
    } else if (req.url === "/hook/question") {
      const mode = p.question || "first";
      const questions = json?.tool_input?.questions ?? [];
      if (mode.startsWith("hold:")) {
        await sleep(Number(mode.slice(5)));
      } else if (mode === "first" || mode.startsWith("answer:")) {
        const answers = {};
        for (const q of questions) {
          answers[q.question] = mode === "first" ? q.options?.[0]?.label ?? "" : mode.slice(7);
        }
        out = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: { ...json.tool_input, questions, answers },
          },
        };
      }
    }
    if (res.destroyed) { log({ replyDropped: req.url }); return; }
    log({ reply: req.url, out });
    if (out) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    } else {
      res.writeHead(200).end();
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`phase0 listening on 127.0.0.1:${PORT}`));
