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

## D8 — Délai avant de relâcher une demande : 580 s (au lieu de 120 s)
- **Choix** : une demande sans réponse reste dans le widget 580 s (juste sous le `timeout` de 600 s du hook), puis l'app répond vide. Réglable (`prefs.pendingTimeoutSec` dans `config.json`).
- Alternative : 120 s, comme dans le brief.
- Raison : le brief prévoyait 120 s pour « retomber sur le dialogue VS Code ». Or la Phase 0 montre que ce dialogue est **déjà affiché en parallèle** dès le début. Relâcher à 120 s n'apporterait rien et rendrait le widget inutilisable pour une demande vieille de plus de 2 min.

## D9 — Notifications natives seulement après 30 s sans réponse
- **Choix** : quand une demande arrive, le panneau s'ouvre tout seul (§4.7). Une notification native n'est envoyée que si la demande est toujours sans réponse 30 s plus tard. Un clic sur la notification ouvre le panneau et focalise la demande. Désactivable dans le menu de l'icône.
- Raison : notifier immédiatement doublerait l'ouverture automatique du panneau. Le rappel à 30 s couvre le cas « je n'ai pas vu le panneau ».

## D10 — Échap : refuser ou fermer selon le focus
- **Choix** : `Échap` refuse une permission seulement si le **bloc de cette demande a le focus clavier** (cas du raccourci global, qui le focalise). Sinon, `Échap` ferme le panneau (ou revient à la liste depuis la vue détail).
- Raison : le brief demande les deux (« Échap = Deny » et « Échap ferme le panneau »). Cette règle évite les refus accidentels.

## D11 — Titres de session lus dans le transcript (titre de l'onglet VS Code)
- **Choix** : priorité `session_title` > titre lu dans le transcript (`custom-title`, sinon `ai-title`, le titre affiché sur l'onglet VS Code) > 40 premiers caractères du 1er prompt > nom du dossier. Le transcript est relu (fin de fichier seulement) après `UserPromptSubmit`, `Stop` et `SessionStart`.
- Alternative : générer un titre « Verbe · Objet » avec `claude-haiku-5-5` (§6, v1.1).
- Raison : les transcripts contiennent déjà le titre généré par Claude Code. C'est gratuit, sans clé API, et **identique au nom de l'onglet**, ce qui aide à faire le lien avec VS Code.

## D12 — Windows : panneau non focalisable par défaut
- **Choix** : sous Windows, la fenêtre est créée `focusable: false`. Les clics fonctionnent sans activer l'app (vérifié par un vrai clic souris). Elle ne devient focalisable que pour une saisie clavier : clic dans « Autre… », ou ouverture par le raccourci global. Elle redevient non focalisable dès qu'elle perd le focus.
- Raison : critère « ne vole jamais le focus ». Sur macOS, c'est le type `panel` (NSPanel non activant) qui joue ce rôle.

## D13 — Serveur : `Connection: close` sur chaque réponse
- Raison : évite qu'un client réutilise une connexion keep-alive au moment où le serveur la ferme (ECONNRESET), ce qui ferait perdre un hook silencieusement. Le coût est négligeable en local.

## D14 — Sessions reconstruites au démarrage
- **Choix** : au lancement, les transcripts principaux modifiés depuis moins de 30 min sont relus et affichés comme sessions « reprises ». Une session reprise sans nouvel événement disparaît 30 min après la dernière écriture de son transcript.
- Limite : un transcript ne dit pas si la session est encore ouverte. Une session fermée récemment apparaît donc comme « en pause » jusqu'à expiration.

## D15 — Pas d'installation automatique des hooks
- **Choix** : l'app n'écrit jamais dans `~/.claude/settings.json` toute seule. Elle affiche « Hooks non installés » et propose « Installer les hooks… » dans le menu de l'icône (clic droit), **avec une confirmation qui montre le chemin**. Un CLI (`npm run hooks -- install --user`) fait la même chose. `--user` doit être donné explicitement.
- Raison : consigne de sécurité (c'est l'utilisateur qui installe, après relecture).

## D16 — Icône Windows : mascotte bleue + pastille orange
- **Choix** : la mascotte bleue de la zone de notification passe aux yeux ronds quand quelqu'un attend, avec une pastille orange portant le nombre (1–9, « + » au-delà). Sur macOS : image *template* monochrome + `tray.setTitle(n)`. `setTitle` ne permet pas l'orange, le nombre y est donc dans la couleur de la barre des menus.

## D17 — Mode `dontAsk` et outils de liste d'étapes
- En mode `dontAsk`, AskUserQuestion est refusé d'office par Claude Code : il n'y a rien à afficher.
- `TodoWrite` / `TaskCreate` sont désactivés par défaut dans la version testée (voir phase0 (e)). L'anneau de progression n'apparaît donc que si l'utilisateur les active (ex. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`). Sinon : indicateur d'activité + temps écoulé (§3.1.4).
