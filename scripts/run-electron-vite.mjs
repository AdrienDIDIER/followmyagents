// Lance electron-vite (dev / preview) en retirant ELECTRON_RUN_AS_NODE :
// cette variable, héritée du terminal intégré de VS Code, ferait tourner
// Electron comme un simple Node (pas de fenêtre, pas d'icône).
import { spawn } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn("npx", ["electron-vite", ...process.argv.slice(2)], { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
