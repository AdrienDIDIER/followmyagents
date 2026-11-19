// Phase 0 Codex : lance `codex exec` dans ./sandbox avec des hooks définis
// UNIQUEMENT pour cette exécution (option -c), sans rien écrire dans ~/.codex.
// Les hooks relaient leur entrée au serveur phase0 (port 47830) avec curl.
//
// Usage : node phase0/codex-run.mjs "<prompt>" [approval_policy] [sandbox_mode]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [prompt, approval = "untrusted", sandbox = "read-only"] = process.argv.slice(2);
const PORT = Number(process.env.FMA_PORT || 47830);
const TOKEN = process.env.FMA_TOKEN || "sandbox-token";

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
// TOML littéral : '…' (pas d'échappement des guillemets doubles)
const hook = (route, timeout) => `{hooks=[{type="command",command='${relay(route)}',timeout=${timeout}}]}`;
const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"];
const args = [
  "exec",
  "--skip-git-repo-check",
  "--dangerously-bypass-hook-trust",
  "--json",
  "-C", path.join(root, "sandbox"),
  "-s", sandbox,
  "-c", `approval_policy="${approval}"`,
  "-c", 'model_reasoning_effort="low"',
  "-m", process.env.CODEX_MODEL || "gpt-5.6-luna",
  "-c", `hooks.PermissionRequest=[${hook("/hook/permission", 600)}]`,
];
for (const ev of events) args.push("-c", `hooks.${ev}=[${hook("/hook/event", 10)}]`);
args.push(prompt);

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")));
const t0 = Date.now();
const child = spawn(findCodex(), args, { cwd: path.join(root, "sandbox"), env, stdio: ["ignore", "pipe", "pipe"] });
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      const o = JSON.parse(line);
      const item = o.item ?? {};
      const desc = item.type ? `${item.type} ${(item.command ?? item.text ?? item.message ?? "").toString().slice(0, 160)}` : JSON.stringify(o).slice(0, 160);
      console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${o.type} ${desc}`);
    } catch {
      console.log("RAW", line.slice(0, 200));
    }
  }
});
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("exit", (code) => console.log(`EXIT ${code}`));
setTimeout(() => child.kill(), Number(process.env.KILL_AFTER_MS || 180000));
