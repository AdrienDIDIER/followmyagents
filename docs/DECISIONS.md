# Décisions prises en autonomie

Format : **choix** · alternatives · raison.

## D1 — Développement sous Windows 11, pas sous macOS
- **Choix** : tout développer et tester sur ce poste (Windows 11). Le code macOS (vibrancy, `app.dock.hide()`, `tray.setTitle`, `setVisibleOnAllWorkspaces`, image *template*) est écrit mais **non testé**.
- Alternatives : aucune, pas de Mac disponible.
- Raison : les consignes parlent de « ce Mac », mais la machine est un PC Windows 11 (`win32`, Windows 11 Pro 10.0.26300). Les tests macOS sont listés dans `docs/REVIEW.md`.

## D2 — Binaire `claude` utilisé pour les tests
- **Choix** : le binaire de l'extension VS Code (`~/.vscode/extensions/anthropic.claude-code-2.1.322-win32-x64/resources/native-binary/claude.exe`). `claude` n'est pas dans le PATH, et les consignes interdisent toute installation globale.
- Les sessions de test utilisent `--model haiku` pour limiter le coût.

## D3 — Questions AskUserQuestion via `PermissionRequest`, pas via `PreToolUse`
- **Choix** : l'app répond aux questions dans le hook `PermissionRequest` (`tool_name = AskUserQuestion`) avec `behavior: allow` + `updatedInput: { questions, answers }`.
- Alternative : le mécanisme du brief (`PreToolUse` matcher `AskUserQuestion`). Il marche, mais **VS Code n'affiche la question qu'après la réponse du hook** : tant que le widget attend, l'utilisateur ne voit rien dans VS Code.
- Raison : avec `PermissionRequest`, la question s'affiche **en même temps** dans VS Code et dans le widget. Le premier qui répond l'emporte, l'autre est annulé automatiquement. Testé dans 5 modes de permission (Phase 0). La route `/hook/question` (mécanisme PreToolUse) reste implémentée et testée, mais n'est pas installée par défaut.

## D4 — Hooks hybrides : HTTP + `command` (curl)
- **Choix** :
  - HTTP : `PermissionRequest` (bloquant, timeout 600 s), `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit` (timeout 5 s).
  - `command` avec `curl -s -m 2 … ; exit 0` : `SessionStart`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `SessionEnd`, `Notification`, `TaskCreated`, `TaskCompleted`.
- Alternative : tout en HTTP, comme dans le brief.
- Raison : (1) `SessionStart` **refuse** les hooks HTTP ; (2) quand l'app est fermée, un échec HTTP sur `Stop` affiche « Stop hook error occurred » et `SessionEnd` affiche une erreur ECONNREFUSED, ce qui viole le critère « aucune erreur visible ». `curl` existe sur macOS et sur Windows 10+ (`curl.exe`). `; exit 0` marche à la fois dans bash et dans PowerShell.

## D5 — Détection « répondu dans VS Code » par fermeture de la requête HTTP
- **Choix** : quand Claude Code ferme la requête `PermissionRequest` (l'utilisateur a répondu dans VS Code), le serveur retire aussitôt la demande du widget. En secours, tout événement ultérieur de la même session (`PreToolUse`, `PostToolUse`, `Stop`, …) retire aussi une demande en attente.
- Raison : observé en Phase 0 (b-2). La fermeture est instantanée, c'est plus fiable que d'attendre l'événement suivant.

## D6 — Jump VS Code sous Windows : script PowerShell de mise au premier plan
- **Choix** : sous Windows, avant d'ouvrir l'URI `vscode://anthropic.claude-code/open?session=…`, l'app lance `resources/scripts/focus-window.ps1`. Le script trouve la fenêtre `Code.exe` dont le titre contient le nom du dossier de la session, puis la met au premier plan (astuce ALT + `SetForegroundWindow`).
- Alternative : `code <cwd>`. Le brief le suggère, mais c'est lent (lance un process Electron) et, sous Windows, ne lève pas non plus la protection anti-vol de focus.
- Raison : testé, l'URI seul ne met pas VS Code au premier plan sous Windows. Sur macOS, l'app suit le brief : `open -a "Visual Studio Code" <cwd>` (ou `code`), puis l'URI.

## D7 — Stack : electron-vite + React 18 + TypeScript, tests Vitest, captures Playwright
- **Choix** : `electron-vite` (main/preload/renderer dans un seul outil), `vitest` pour les tests unitaires, `playwright` (`_electron`) pour lancer l'app et faire des captures, `electron-builder` pour le packaging.
- Raison : c'est la stack recommandée par le brief (§4.1), avec l'outillage le plus simple.
