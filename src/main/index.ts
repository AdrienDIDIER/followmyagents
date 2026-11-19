// Process principal : serveur de hooks + store + icône système + panneau.
import { app, clipboard, dialog, globalShortcut, ipcMain, Menu, Notification, shell, systemPreferences, Tray } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { AppSnapshot, PendingAnswer, Prefs } from "@shared/types";
import { loadConfig, saveConfig, type AppConfig } from "./config";
import { createHookServer, type HookServer } from "./server";
import { SessionStore, type HookInput } from "./store";
import { defaultSettingsPath, hooksState, installHooks, setTodoTools, todoToolsEnabled, uninstallHooks } from "./installer";
import { Panel, rendererPaths } from "./panel";
import { trayImage } from "./tray-icon";
import { jumpToSession, listVsCodeWindowTitles } from "./vscode";
import { readIdeWindows } from "./ide";
import { Updater } from "./updater";
import { projectsDir, readTranscriptInfo, scanRecentTranscripts } from "./transcripts";
import { describeTool, messagePreview, titleFromPrompt } from "./describe";
import { folderTitle } from "./store";

// ---------- isolation (tests / captures) ----------
if (process.env.FMA_USER_DATA) app.setPath("userData", process.env.FMA_USER_DATA);
const SETTINGS_PATH = process.env.FMA_CLAUDE_SETTINGS || defaultSettingsPath();
const SCAN_TRANSCRIPTS = process.env.FMA_NO_TRANSCRIPTS !== "1";
const NO_GLASS = process.env.FMA_NO_GLASS === "1";
const SHORTCUT = "CommandOrControl+Alt+A";
// Dépôt GitHub dont les Releases fournissent les mises à jour (FMA_UPDATE_REPO=owner/repo pour tester)
const UPDATE_REPO = (process.env.FMA_UPDATE_REPO || "AdrienDIDIER/followmyagents").split("/");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
if (process.platform === "win32") app.setAppUserModelId("dev.followmyagents.app");

let cfg: AppConfig;
let store: SessionStore;
let server: HookServer;
let serverError: string | undefined;
let tray: Tray | null = null;
let panel: Panel;
let quitting = false;
let updater: Updater;
const log = (m: string) => {
  if (process.env.FMA_DEBUG) console.log(`[fma] ${m}`);
};

function scriptsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "resources", "scripts") : path.join(app.getAppPath(), "resources", "scripts");
}

// ---------- état → renderer ----------
// État des hooks mis en cache : settings.json n'est relu que toutes les 10 s
// (ou juste après une installation / désinstallation), pas à chaque événement.
let hooksCache: { at: number; st: ReturnType<typeof hooksState> } | null = null;
function cachedHooksState(force = false) {
  if (force || !hooksCache || Date.now() - hooksCache.at > 10_000) {
    hooksCache = { at: Date.now(), st: hooksState(SETTINGS_PATH, { port: cfg.port, token: cfg.token }) };
  }
  return hooksCache.st;
}

function snapshot(): AppSnapshot {
  const st = cachedHooksState();
  return {
    sessions: store.getSessions(),
    pendings: store.getPendings(),
    prefs: cfg.prefs,
    hooks: { installed: st.installed && st.upToDate, settingsPath: SETTINGS_PATH, error: st.error },
    serverError,
    maxHeight: panel.maxHeight(),
    update: updater.state,
    version: app.getVersion(),
    glass: !NO_GLASS && (process.platform === "darwin" || process.platform === "win32"),
    now: Date.now(),
    platform: process.platform,
  };
}

let pushTimer: NodeJS.Timeout | null = null;
function pushSnapshot() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (!panel?.win.isDestroyed()) panel.win.webContents.send("snapshot", snapshot());
    updateTray();
  }, 16);
}

// ---------- icône système ----------
function updateTray() {
  if (!tray) return;
  const waiting = store.getPendings().length;
  const working = store
    .getSessions()
    .some((s) => s.state === "working" || (s.state === "idle" && (s.background.length > 0 || s.subagents.some((a) => a.status === "running"))));
  const face = waiting > 0 ? "alert" : working ? "work" : "idle";
  tray.setImage(trayImage(face, waiting));
  if (process.platform === "darwin") tray.setTitle(waiting > 0 ? String(waiting) : "", { fontType: "monospacedDigit" });
  const n = store.getSessions().filter((s) => s.state !== "done").length;
  tray.setToolTip(
    serverError
      ? `FollowMyAgents : ${serverError}`
      : `FollowMyAgents — ${n} agent${n > 1 ? "s" : ""}${waiting ? `, ${waiting} en attente` : ""}`,
  );
}

function trayMenu(): Menu {
  const st = cachedHooksState(true);
  const hooksLabel = st.error
    ? `Hooks : ${st.error}`
    : st.installed && st.upToDate
      ? "Hooks installés ✓"
      : st.installed
        ? "Hooks à mettre à jour"
        : "Hooks non installés";
  return Menu.buildFromTemplate([
    { label: panel.visible ? "Masquer le panneau" : "Afficher le panneau", accelerator: SHORTCUT, click: () => togglePanel("click") },
    { type: "separator" },
    { label: "Son", type: "checkbox", checked: cfg.prefs.sound, click: (i) => setPref("sound", i.checked) },
    { label: "Notifications", type: "checkbox", checked: cfg.prefs.notifications, click: (i) => setPref("notifications", i.checked) },
    { label: "Lancer au démarrage", type: "checkbox", checked: cfg.prefs.openAtLogin, click: (i) => setPref("openAtLogin", i.checked) },
    { type: "separator" },
    { label: hooksLabel, enabled: false },
    { label: st.installed ? "Réinstaller les hooks…" : "Installer les hooks…", click: () => void doInstall() },
    { label: "Désinstaller les hooks…", enabled: st.installed, click: () => void doUninstall() },
    {
      label: "Plans des agents (active TodoWrite)",
      type: "checkbox",
      checked: todoToolsEnabled(SETTINGS_PATH),
      click: (i) => void toggleTodoTools(i.checked),
    },
    ...(process.platform === "darwin"
      ? [
          {
            label: systemPreferences.isTrustedAccessibilityClient(false)
              ? "Autorisations macOS… (Accessibilité ✓)"
              : "Autorisations macOS… (pour ↗)",
            click: () => void showMacPermissions(),
          },
        ]
      : []),
    {
      label: "Copier le diagnostic du dernier ↗",
      enabled: lastJumpDiag !== null,
      click: () => {
        clipboard.writeText(JSON.stringify(lastJumpDiag, null, 2));
        void dialog.showMessageBox({ type: "info", title: "FollowMyAgents", message: "Diagnostic copié dans le presse-papiers.", detail: "Collez-le dans votre message." });
      },
    },
    { label: "Ouvrir le dossier de configuration", click: () => void shell.openPath(app.getPath("userData")) },
    { type: "separator" },
    ...updateMenuItems(),
    { type: "separator" },
    { label: "Quitter FollowMyAgents", role: "quit" },
  ]);
}

async function doInstall() {
  const r = await dialog.showMessageBox({
    type: "question",
    buttons: ["Installer", "Annuler"],
    defaultId: 0,
    cancelId: 1,
    title: "FollowMyAgents",
    message: "Installer les hooks FollowMyAgents ?",
    detail: `Fichier modifié : ${SETTINGS_PATH}\nUne sauvegarde horodatée est créée à côté. Vos autres hooks ne sont pas touchés.`,
  });
  if (r.response !== 0) return;
  try {
    const res = installHooks(SETTINGS_PATH, { port: cfg.port, token: cfg.token });
    void dialog.showMessageBox({
      type: "info",
      title: "FollowMyAgents",
      message: "Hooks installés.",
      detail: `${res.settingsPath}${res.backupPath ? `\nSauvegarde : ${res.backupPath}` : ""}\n\nLes sessions Claude Code déjà ouvertes les prendront en compte au prochain démarrage de session.`,
    });
  } catch (e) {
    dialog.showErrorBox("FollowMyAgents", (e as Error).message);
  }
  cachedHooksState(true);
  pushSnapshot();
}

async function toggleTodoTools(enabled: boolean) {
  const r = await dialog.showMessageBox({
    type: "question",
    buttons: [enabled ? "Activer" : "Désactiver", "Annuler"],
    defaultId: 0,
    cancelId: 1,
    title: "FollowMyAgents",
    message: enabled ? "Activer les plans des agents ?" : "Désactiver les plans des agents ?",
    detail:
      (enabled
        ? "Claude Code a un outil de plan (TodoWrite) désactivé par défaut. Une fois activé, les agents tiennent une liste d'étapes pour les tâches longues : elle s'affiche dans le panneau (étapes cochées + anneau de progression).\n\n"
        : "") +
      `Fichier modifié : ${SETTINGS_PATH} (clé env.CLAUDE_CODE_ENABLE_TODO_TOOLS), avec sauvegarde. Effet sur les nouvelles sessions Claude Code.`,
  });
  if (r.response === 0) {
    try {
      setTodoTools(SETTINGS_PATH, enabled);
    } catch (e) {
      dialog.showErrorBox("FollowMyAgents", (e as Error).message);
    }
  }
  pushSnapshot();
}

async function doUninstall() {
  const r = await dialog.showMessageBox({
    type: "question",
    buttons: ["Désinstaller", "Annuler"],
    defaultId: 0,
    cancelId: 1,
    title: "FollowMyAgents",
    message: "Retirer les hooks FollowMyAgents ?",
    detail: `Fichier modifié : ${SETTINGS_PATH}\nSeuls les hooks FollowMyAgents sont retirés.`,
  });
  if (r.response !== 0) return;
  try {
    const res = uninstallHooks(SETTINGS_PATH);
    void dialog.showMessageBox({
      type: "info",
      title: "FollowMyAgents",
      message: res.removed ? `${res.removed} hooks retirés.` : "Aucun hook FollowMyAgents trouvé.",
      detail: res.backupPath ? `Sauvegarde : ${res.backupPath}` : undefined,
    });
  } catch (e) {
    dialog.showErrorBox("FollowMyAgents", (e as Error).message);
  }
  cachedHooksState(true);
  pushSnapshot();
}

// ---------- mises à jour (D22) ----------
function updateMenuItems(): Electron.MenuItemConstructorOptions[] {
  const st = updater.state;
  const items: Electron.MenuItemConstructorOptions[] = [{ type: "separator" }];
  if (st.state === "available") items.push({ label: `Installer la version ${st.version}…`, click: () => void confirmUpdate() });
  else if (st.state === "downloading") items.push({ label: `Téléchargement de ${st.version}… ${st.progress} %`, enabled: false });
  else items.push({ label: `Rechercher une mise à jour (v${app.getVersion()})`, click: () => void checkUpdate(true) });
  items.push({
    label: "Vérifier automatiquement",
    type: "checkbox",
    checked: cfg.prefs.autoUpdateCheck,
    click: (i) => setPref("autoUpdateCheck", i.checked),
  });
  return items;
}

async function checkUpdate(manual = false) {
  const st = await updater.check();
  if (!manual) return;
  if (st.state === "up-to-date") {
    void dialog.showMessageBox({ type: "info", title: "FollowMyAgents", message: `FollowMyAgents est à jour (v${app.getVersion()}).` });
  } else if (st.state === "error") {
    void dialog.showMessageBox({ type: "warning", title: "FollowMyAgents", message: st.message });
  } else if (st.state === "available") {
    void confirmUpdate();
  }
}

async function confirmUpdate() {
  const st = updater.state;
  if (st.state !== "available") return;
  const waiting = store.getPendings().length;
  const r = await dialog.showMessageBox({
    type: "question",
    title: "FollowMyAgents",
    message: `Installer FollowMyAgents ${st.version} ?`,
    detail:
      (st.notes ? `${st.notes.slice(0, 600)}\n\n` : "") +
      "L'app se ferme quelques secondes puis redémarre toute seule." +
      (waiting ? `\n\n${waiting} demande(s) en attente repasseront dans le dialogue de VS Code.` : ""),
    buttons: ["Installer et redémarrer", "Plus tard"],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) await updater.install();
}

// ---------- panneau ----------
let autoHideTimer: NodeJS.Timeout | null = null;
function togglePanel(reason: "click" | "shortcut") {
  if (panel.visible) panel.hide();
  else {
    panel.show(reason);
    if (reason === "shortcut") panel.win.webContents.send("focus-pending", store.getPendings()[0]?.id ?? null);
  }
}

function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  cfg.prefs = { ...cfg.prefs, [key]: value };
  saveConfig(cfg, app.getPath("userData"));
  if (key === "openAtLogin") app.setLoginItemSettings({ openAtLogin: Boolean(value) });
  if (key === "detached") panel.place();
  pushSnapshot();
}

// ---------- notifications (D9) ----------
const notifyTimers = new Map<string, NodeJS.Timeout>();
function scheduleNotification(pendingId: string) {
  notifyTimers.set(
    pendingId,
    setTimeout(() => {
      notifyTimers.delete(pendingId);
      const p = store.getPending(pendingId);
      if (!p || !cfg.prefs.notifications || !Notification.isSupported()) return;
      const s = store.getSession(p.sessionId);
      const n = new Notification({
        title: s?.title ?? "FollowMyAgents",
        body: p.kind === "permission" ? `${p.headline}\n${p.detail}` : p.questions[0]?.question ?? "Une question pour toi",
        silent: true,
      });
      n.on("click", () => {
        panel.show("shortcut");
        panel.win.webContents.send("focus-pending", pendingId);
      });
      n.show();
    }, 30_000),
  );
}

// ---------- titres depuis les transcripts ----------
const titleTimers = new Map<string, NodeJS.Timeout>();
function refreshTitle(sessionId: string, transcriptPath: string, delay = 1500) {
  if (!transcriptPath) return;
  clearTimeout(titleTimers.get(sessionId));
  titleTimers.set(
    sessionId,
    setTimeout(() => {
      titleTimers.delete(sessionId);
      const info = readTranscriptInfo(transcriptPath);
      store.applyTranscriptTitle(sessionId, info.title);
    }, delay),
  );
}

function reconstructSessions() {
  const recent = scanRecentTranscripts(projectsDir(), 30 * 60_000);
  for (const r of recent) {
    const i = r.info;
    if (!i.sessionId || !i.cwd) continue;
    const fresh = Date.now() - r.mtimeMs < 2 * 60_000;
    store.addReconstructed({
      id: i.sessionId,
      cwd: i.cwd,
      transcriptPath: r.file,
      title: i.title ?? (i.lastPrompt ? titleFromPrompt(i.lastPrompt) : folderTitle(i.cwd)),
      titleSource: i.title ? "transcript" : "prompt",
      state: fresh && i.openToolUse ? "working" : "idle",
      subtitle:
        fresh && i.openToolUse
          ? describeTool(i.openToolUse.name, i.openToolUse.input)
          : i.lastAssistantText
            ? messagePreview(i.lastAssistantText)
            : "Session en cours",
      lastMessage: i.lastAssistantText,
      startedAt: r.mtimeMs,
      lastEventAt: r.mtimeMs,
    });
  }
}

// ---------- démarrage ----------
async function start() {
  if (process.platform === "darwin") app.dock?.hide();
  cfg = loadConfig(app.getPath("userData"));
  updater = new Updater({
    owner: UPDATE_REPO[0],
    repo: UPDATE_REPO[1],
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    exePath: app.getPath("exe"),
    ...(process.env.FMA_UPDATE_API ? { apiBase: process.env.FMA_UPDATE_API } : {}),
    quit: () => app.quit(),
    onChange: () => pushSnapshot(),
    log,
  });
  store = new SessionStore({
    pendingTimeoutSec: () => cfg.prefs.pendingTimeoutSec,
    autoRemoveDoneMin: () => cfg.prefs.autoRemoveDoneMin,
    onEvent: (ev: HookInput, s) => {
      if (s.titleSource !== "session" && ["UserPromptSubmit", "Stop", "SessionStart"].includes(ev.hook_event_name ?? "")) {
        refreshTitle(s.id, s.transcriptPath, ev.hook_event_name === "Stop" ? 300 : 2500);
      }
    },
  });

  const { preload, rendererFile } = rendererPaths(__dirname);
  panel = new Panel({
    preload,
    rendererFile,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    getTrayBounds: () => tray?.getBounds() ?? null,
    detached: () => cfg.prefs.detached,
    detachedPos: () => cfg.detachedPos,
    onMoved: (pos) => {
      cfg.detachedPos = pos;
      saveConfig(cfg, app.getPath("userData"));
    },
    onHidden: () => pushSnapshot(),
    noGlass: NO_GLASS,
  });

  store.onChange((reason) => {
    pushSnapshot();
    if (reason.type === "pending-added") {
      if (autoHideTimer) clearTimeout(autoHideTimer);
      if (!panel.visible) panel.show("auto");
      panel.win.webContents.send("attention", reason.pending.id);
      scheduleNotification(reason.pending.id);
    } else if (reason.type === "pending-removed") {
      clearTimeout(notifyTimers.get(reason.pending.id));
      notifyTimers.delete(reason.pending.id);
      if (panel.openedBy === "auto" && store.getPendings().length === 0) {
        if (autoHideTimer) clearTimeout(autoHideTimer);
        // laisse voir la coche de confirmation, puis referme
        autoHideTimer = setTimeout(() => {
          autoHideTimer = null;
          if (panel.openedBy === "auto" && store.getPendings().length === 0) panel.hide();
        }, 1600);
      }
    }
  });

  server = createHookServer({ store, token: cfg.token, port: cfg.port, log });
  try {
    await server.listen();
    serverError = undefined;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    serverError = err.code === "EADDRINUSE" ? `le port ${cfg.port} est déjà utilisé` : err.message;
  }

  tray = new Tray(trayImage("idle", 0));
  tray.on("click", () => togglePanel("click"));
  tray.on("right-click", () => tray?.popUpContextMenu(trayMenu()));
  updateTray();

  if (!globalShortcut.register(SHORTCUT, () => togglePanel("shortcut"))) log(`raccourci ${SHORTCUT} indisponible`);

  if (SCAN_TRANSCRIPTS) {
    try {
      reconstructSessions();
    } catch (e) {
      log(`transcripts: ${(e as Error).message}`);
    }
  }

  setInterval(() => store.tick(), 1000);

  // mises à jour : 15 s après le démarrage puis toutes les 6 h (pas en test, sauf API simulée)
  if (process.env.FMA_E2E !== "1" || process.env.FMA_UPDATE_API) {
    const auto = () => cfg.prefs.autoUpdateCheck && void updater.check();
    setTimeout(auto, 15_000);
    setInterval(auto, 6 * 3600_000);
  }

  // ---------- IPC ----------
  ipcMain.on("ready", () => pushSnapshot());
  ipcMain.on("answer", (_e, id: string, answer: PendingAnswer) => {
    const p = store.getPending(id);
    store.answer(id, answer);
    if (p && answer.kind === "vscode") {
      const s = store.getSession(p.sessionId);
      if (s) void jump(s.id);
    }
  });
  ipcMain.on("dismiss", (_e, id: string) => store.dismiss(id));
  ipcMain.on("jump", (_e, id: string) => void jump(id));
  ipcMain.on("set-pref", (_e, key: keyof Prefs, value: Prefs[keyof Prefs]) => setPref(key, value as never));
  ipcMain.on("hide", () => panel.hide());
  ipcMain.on("toggle-detach", () => setPref("detached", !cfg.prefs.detached));
  ipcMain.on("resize", (_e, h: number) => panel.setContentHeight(h));
  ipcMain.on("want-focus", () => panel.takeFocus());
  ipcMain.on("update-install", () => void confirmUpdate());
  ipcMain.on("update-check", () => void checkUpdate(true));
  ipcMain.on("context-menu", () => trayMenu().popup({ window: panel.win }));

  // Mode capture (e2e) : expose quelques actions au script Playwright.
  if (process.env.FMA_E2E === "1") {
    (globalThis as Record<string, unknown>).__fma = {
      store,
      panel,
      cfg: () => cfg,
      show: (r: "auto" | "click" | "shortcut") => panel.show(r),
      hide: () => panel.hide(),
      port: () => server.port,
      lastJump: () => lastJump,
      updater: () => updater,
    };
  }
}

// macOS : choisir la bonne fenêtre VS Code demande deux autorisations :
// « Accessibilité » (lire et lever les fenêtres) et « Automatisation » (piloter Événements Système).
const MAC_SETTINGS = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
};
let permissionAsked = false;
function askAccessibility(kind: "accessibility" | "automation") {
  if (process.platform !== "darwin" || permissionAsked) return;
  permissionAsked = true;
  void showMacPermissions(kind);
}

async function showMacPermissions(kind?: "accessibility" | "automation") {
  if (process.platform !== "darwin") return;
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);
  const r = await dialog.showMessageBox({
    type: kind ? "warning" : "info",
    title: "FollowMyAgents",
    message: "Autorisations pour ramener la bonne fenêtre VS Code",
    detail:
      [
        kind === "automation"
          ? "macOS a refusé à FollowMyAgents le contrôle de « Événements Système »."
          : kind === "accessibility"
            ? "macOS a refusé l'accès « Accessibilité » à FollowMyAgents."
            : "",
        `1. Accessibilité : activer FollowMyAgents${trusted ? " (déjà accordé ✓)" : ""}.`,
        "2. Automatisation : sous FollowMyAgents, cocher « Événements Système ».",
        "Lancée avec npm start, autorisez plutôt Terminal (ou Visual Studio Code si vous lancez depuis son terminal). Puis quittez et relancez FollowMyAgents.",
        "En attendant, ↗ active seulement VS Code.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    buttons: ["Ouvrir Accessibilité", "Ouvrir Automatisation", "Plus tard"],
    defaultId: kind === "automation" ? 1 : 0,
    cancelId: 2,
  });
  if (r.response === 0) {
    // ajoute l'app à la liste Accessibilité (case à cocher), puis ouvre la page au premier plan
    systemPreferences.isTrustedAccessibilityClient(true);
    setTimeout(() => void shell.openExternal(MAC_SETTINGS.accessibility), 400);
  } else if (r.response === 1) {
    void shell.openExternal(MAC_SETTINGS.automation);
  }
}

let lastJump: { sessionId: string; cwd: string } | null = null;
let lastJumpDiag: Record<string, unknown> | null = null;
async function jump(sessionId: string) {
  const s = store.getSession(sessionId);
  if (!s) return;
  lastJump = { sessionId: s.id, cwd: s.cwd };
  if (process.env.FMA_NO_JUMP === "1") return; // tests : pas d'action sur le vrai VS Code
  try {
    const diag: Record<string, unknown> = {
      at: new Date().toISOString(),
      version: app.getVersion(),
      platform: process.platform,
      session: s.id,
      title: s.title,
      accessibility: process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(false) : undefined,
      ideWindows: readIdeWindows().map((w) => w.workspaceFolders),
    };
    const outcome = await jumpToSession(s.id, s.cwd, {
      openExternal: (u) => shell.openExternal(u),
      scriptsDir: scriptsDir(),
      log,
      onAccessibilityDenied: askAccessibility,
      onDiag: (d) => Object.assign(diag, d),
    });
    diag.outcome = outcome;
    diag.vscodeWindows = await listVsCodeWindowTitles().catch((e) => String(e));
    lastJumpDiag = diag;
    log(`jump ${s.id} → ${outcome}`);
  } catch (e) {
    log(`jump: ${(e as Error).message}`);
  }
}

app.on("second-instance", () => panel && togglePanel("click"));
app.on("window-all-closed", () => {
  /* reste dans la barre des menus / zone de notification */
});
app.on("before-quit", (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  globalShortcut.unregisterAll();
  void (server ? server.close() : Promise.resolve()).finally(() => app.exit(0));
});

app.whenReady().then(start);

// Vérifie que les ressources existent (aide au debug du packaging)
app.whenReady().then(() => {
  if (process.env.FMA_DEBUG && !fs.existsSync(scriptsDir())) console.warn(`scripts introuvables : ${scriptsDir()}`);
});
