// CLI de l'installeur de hooks (sans Electron).
//
//   node out/main/cli.js status    --settings <chemin>  | --user
//   node out/main/cli.js install   --settings <chemin>  | --user  [--question-mode pretooluse]
//   node out/main/cli.js uninstall --settings <chemin>  | --user
//   node out/main/cli.js todos on|off --settings <chemin> | --user   (outil de plan TodoWrite)
//
// --user cible ~/.claude/settings.json : il doit être donné explicitement,
// pour qu'aucun test ou script ne touche à la vraie config par accident.
// Le token et le port sont ceux de l'app (config.json dans --config-dir ou
// le dossier de config par défaut ; créé s'il n'existe pas).
import { defaultSettingsPath, hooksState, installHooks, setTodoTools, todoToolsEnabled, uninstallHooks, type QuestionMode } from "./installer";
import { defaultConfigDir, loadConfig } from "./config";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const cmd = process.argv[2];
  if (!cmd || !["status", "install", "uninstall", "todos"].includes(cmd)) {
    console.log("Usage : cli.js <status|install|uninstall|todos on|off> (--settings <chemin> | --user) [--config-dir <dir>] [--question-mode permission|pretooluse]");
    return 2;
  }
  const settings = process.argv.includes("--user") ? defaultSettingsPath() : arg("--settings");
  if (!settings) {
    console.error("Précisez --settings <chemin> (ou --user pour ~/.claude/settings.json).");
    return 2;
  }
  const configDir = arg("--config-dir") ?? defaultConfigDir();
  const cfg = loadConfig(configDir);
  const target = {
    port: Number(arg("--port") ?? cfg.port),
    token: cfg.token,
    questionMode: (arg("--question-mode") as QuestionMode) ?? "permission",
  };
  try {
    if (cmd === "status") {
      const st = hooksState(settings, target);
      console.log(JSON.stringify({ settings, ...st, todoTools: todoToolsEnabled(settings) }, null, 2));
      return 0;
    }
    if (cmd === "todos") {
      const on = process.argv[3] === "on";
      if (!["on", "off"].includes(process.argv[3] ?? "")) {
        console.error("Usage : cli.js todos on|off (--settings <chemin> | --user)");
        return 2;
      }
      const r = setTodoTools(settings, on);
      console.log(r.changed ? `Plans des agents ${on ? "activés" : "désactivés"} dans ${settings}` : "Aucun changement");
      if (r.backupPath) console.log(`Sauvegarde : ${r.backupPath}`);
      return 0;
    }
    if (cmd === "install") {
      const r = installHooks(settings, target);
      console.log(`Hooks installés dans ${r.settingsPath}`);
      if (r.backupPath) console.log(`Sauvegarde : ${r.backupPath}`);
      return 0;
    }
    const r = uninstallHooks(settings);
    console.log(r.removed ? `${r.removed} hooks retirés de ${r.settingsPath}` : `Aucun hook FollowMyAgents dans ${r.settingsPath}`);
    if (r.backupPath) console.log(`Sauvegarde : ${r.backupPath}`);
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

process.exitCode = main();
