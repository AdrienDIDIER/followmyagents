// Phase 0 Codex : prépare un CODEX_HOME TEMPORAIRE (e2e/tmp/codex-home) pour tester
// les hooks en mode app-server sans toucher à ~/.codex :
//   - copie de auth.json (connexion) — supprimée par `--clean` ;
//   - hooks.json pointant vers le serveur phase0 ;
//   - approbation des hooks (trusted_hash) écrite dans le config.toml TEMPORAIRE.
// Usage : node phase0/codex-home-setup.mjs        (préparer)
//         node phase0/codex-home-setup.mjs --clean (tout supprimer)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = path.join(root, "e2e", "tmp", "codex-home");
if (process.argv.includes("--clean")) {
  fs.rmSync(home, { recursive: true, force: true });
  console.log("CODEX_HOME temporaire supprimé");
  process.exit(0);
}
const PORT = Number(process.env.FMA_PORT || 47830);
const TOKEN = process.env.FMA_TOKEN || "sandbox-token";
const curl = process.platform === "win32" ? "curl.exe" : "curl";
const relay = (route) =>
  `${curl} -s --connect-timeout 0.5 -m 600 -X POST -H "Content-Type: application/json" -H "X-FMA-Token: ${TOKEN}" --data-binary "@-" http://127.0.0.1:${PORT}${route}; exit 0`;
const h = (route, timeout) => [{ hooks: [{ type: "command", command: relay(route), timeout }] }];

fs.mkdirSync(home, { recursive: true });
fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(home, "auth.json"));
const hooks = { hooks: { PermissionRequest: h("/hook/permission", 600) } };
for (const ev of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]) hooks.hooks[ev] = h("/hook/event", 10);
fs.writeFileSync(path.join(home, "hooks.json"), JSON.stringify(hooks, null, 2));
fs.writeFileSync(path.join(home, "config.toml"), 'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "low"\n');

function findCodex() {
  const ext = path.join(os.homedir(), ".vscode", "extensions");
  const dir = fs.readdirSync(ext).filter((d) => d.startsWith("openai.chatgpt-")).sort().at(-1);
  const plat = process.platform === "win32" ? "windows-x86_64" : process.arch === "arm64" ? "macos-aarch64" : "macos-x86_64";
  return path.join(ext, dir, "bin", plat, process.platform === "win32" ? "codex.exe" : "codex");
}
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE"))), CODEX_HOME: home };
const child = spawn(findCodex(), ["app-server"], { cwd: path.join(root, "sandbox"), env, stdio: ["pipe", "pipe", "inherit"] });
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
      if (m.id !== undefined && waiters.has(m.id)) waiters.get(m.id)(m);
    } catch {}
  }
});
const rpc = (id, method, params) =>
  new Promise((r) => {
    waiters.set(id, r);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
await rpc(1, "initialize", { clientInfo: { name: "fma-setup", version: "0.1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
const res = await rpc(2, "hooks/list", { cwds: [path.join(root, "sandbox")] });
child.kill();
const entries = (res.result?.data ?? []).flatMap((e) => e.hooks);
const mine = entries.filter((x) => x.source === "user");
let toml = fs.readFileSync(path.join(home, "config.toml"), "utf8");
for (const x of mine) toml += `\n[hooks.state.${JSON.stringify(x.key)}]\ntrusted_hash = ${JSON.stringify(x.currentHash)}\n`;
fs.writeFileSync(path.join(home, "config.toml"), toml);
console.log(`${mine.length} hooks approuvés dans le config.toml temporaire :`);
for (const x of mine) console.log(`  ${x.eventName} ${x.trustStatus} → trusted  (clé ${x.key})`);
console.log(`CODEX_HOME=${home}`);
