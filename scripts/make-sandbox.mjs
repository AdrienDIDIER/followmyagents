// Crée (ou recrée) le projet bac à sable ./sandbox utilisé pour tester les hooks
// sans jamais toucher à ~/.claude/settings.json.
//
// Les hooks sont écrits dans sandbox/.claude/settings.local.json : ils ne
// s'appliquent qu'aux sessions Claude Code lancées avec cwd = ./sandbox.
// Le dossier est un dépôt git indépendant, pour que Claude Code le traite
// comme une racine de projet à part entière.
//
// Usage : node scripts/make-sandbox.mjs [port] [token]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = path.join(root, "sandbox");
const port = Number(process.argv[2] || 47830); // ≠ 47821 (port de la vraie app)
const token = process.argv[3] || "sandbox-token";

const base = `http://127.0.0.1:${port}`;
const h = (route, timeout) => ({
  type: "http",
  url: `${base}${route}`,
  timeout,
  headers: { "X-FMA-Token": token },
});
const ev = () => [{ hooks: [h("/hook/event", 5)] }];
// Événements dont l'échec HTTP serait visible (ou HTTP non supporté) : hook
// "command" qui relaie l'entrée avec curl et sort toujours en 0 (silencieux).
const curlBin = process.platform === "win32" ? "curl.exe" : "curl";
const cmd = () => [{ hooks: [{ type: "command", timeout: 5,
  command: `${curlBin} -s -m 2 -X POST -H "Content-Type: application/json" -H "X-FMA-Token: ${token}" --data-binary "@-" ${base}/hook/event; exit 0` }] }];

const settings = {
  hooks: {
    PermissionRequest: [{ hooks: [h("/hook/permission", 600)] }],
    PreToolUse: [
      { matcher: "AskUserQuestion", hooks: [h("/hook/question", 600)] },
      { hooks: [h("/hook/event", 5)] },
    ],
    SessionStart: cmd(),
    UserPromptSubmit: ev(),
    PostToolUse: ev(),
    PostToolUseFailure: ev(),
    TaskCreated: cmd(),
    TaskCompleted: cmd(),
    Notification: cmd(),
    Stop: cmd(),
    StopFailure: cmd(),
    SubagentStart: cmd(),
    SubagentStop: cmd(),
    SessionEnd: cmd(),
  },
};

fs.mkdirSync(path.join(sandbox, ".claude"), { recursive: true });
fs.writeFileSync(path.join(sandbox, ".claude", "settings.local.json"), JSON.stringify(settings, null, 2));
if (!fs.existsSync(path.join(sandbox, ".git"))) {
  execFileSync("git", ["init", "-q"], { cwd: sandbox });
}
const readme = path.join(sandbox, "README.md");
if (!fs.existsSync(readme)) fs.writeFileSync(readme, "# Sandbox FollowMyAgents\n\nProjet jetable pour tester les hooks.\n");
console.log(`sandbox ready at ${sandbox} (hooks -> ${base})`);
