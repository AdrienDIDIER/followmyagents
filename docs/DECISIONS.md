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

## D18 — Jump macOS : AppleScript (Accessibilité) au lieu de `code <dossier>`
- **Constat (retour utilisateur)** : sur Mac, ↗ ne ramenait pas la fenêtre VS Code déjà ouverte. `code <dossier>` ne réutilise une fenêtre que si elle est ouverte **exactement** sur ce dossier. Lancé depuis le terminal intégré de VS Code, `code` hérite aussi de `VSCODE_IPC_HOOK_CLI` et parle à la fenêtre de ce terminal. Enfin, l'URI peut arriver avant que la fenêtre soit active.
- **Choix** : `resources/scripts/focus-window-mac.applescript` cherche VS Code par son identifiant d'app (`com.microsoft.VSCode`, ou Insiders), puis la fenêtre dont le titre contient le dossier (segment exact « … — dossier » d'abord). Il la sort du Dock si elle est réduite, puis `AXRaise` + `frontmost`.
  - Dossier non ouvert / VS Code fermé → `code <dossier>` (ou `open -a`), puis 1,2 s d'attente avant l'URI.
  - Accès « Accessibilité » refusé → demande système (`isTrustedAccessibilityClient(true)`) et message une fois par lancement. VS Code est seulement activé (pas d'ouverture de dossier, qui créerait une nouvelle fenêtre).
  - Toutes les commandes lancées par l'app perdent `ELECTRON_RUN_AS_NODE` et `VSCODE_*`.
- Limite : non testé sur un vrai Mac (logique couverte par des tests unitaires avec commandes simulées).

## D19 — Sous-agents et tâches en arrière-plan
- **Formats réels capturés** (Claude Code 2.1.322, fixture `tests/fixtures/background-subagent.json`) :
  - les outils d'un sous-agent portent `agent_id` / `agent_type` ;
  - `PostToolUse(Bash)` renvoie `tool_response.backgroundTaskId` quand `run_in_background` ;
  - `PostToolUse(Agent)` renvoie `{ isAsync: true, agentId }` ;
  - `Stop` / `SubagentStop` portent `background_tasks: [{ id, type: "shell"|"subagent", status, description, command?, agent_type? }]` (la liste de `SubagentStop` contient encore le sous-agent qui s'arrête) ;
  - la fin d'une tâche relance un tour via un faux prompt `<task-notification><task-id>…</task-id><status>…</status><summary>…</summary>`.
- **Choix** :
  - à `Stop`, les sous-agents et tâches en arrière-plan ne sont plus effacés (c'était un bug). La session est « en pause » mais affichée « En arrière-plan · … » avec une mascotte active et « N en fond » ;
  - l'action d'un sous-agent préfixe le sous-titre du parent (« Explore · Lecture de config.ts »), sauf si le tour du parent est fini ;
  - vue détail : section « Sous-agents et tâches » (en cours, commandes en arrière-plan, 5 derniers résultats de sous-agents) ;
  - un prompt `<task-notification>` ne sert jamais de titre ; il marque la tâche terminée et affiche « Reprend : … ».

## D20 — « Activité récente » quand l'agent n'a pas de plan
- **Constat (retour utilisateur)** : sur Mac, la vue détail ne montrait que le bloc Terminal. La liste d'étapes cochées des captures venait de données de démonstration (`TodoWrite`), or cet outil est désactivé par défaut (Phase 0, e).
- **Choix** :
  1. Sans plan, la vue détail affiche les **10 dernières actions réelles** (lecture, recherche, modification, commande… ; ✓ terminée, ✗ échouée, spinner en cours ; préfixe du sous-agent si c'est lui). Pas d'anneau ni de « N/M » : ce n'est pas une progression (§3.1.4).
  2. Option **« Plans des agents (active TodoWrite) »** dans le menu de l'icône (et `npm run hooks -- todos on --user`). Elle ajoute `env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "1"` dans `settings.json`, avec confirmation et sauvegarde. Vérifié : ça réactive TodoWrite même dans le mode utilisé par l'extension VS Code. Les agents tiennent alors un plan pour les tâches longues : étapes cochées + anneau. La désinstallation des hooks ne touche pas à cette option.

## D21 — Choix de la fenêtre VS Code grâce à `~/.claude/ide/*.lock`
- **Constat (retour utilisateur)** : avec plusieurs fenêtres VS Code, ↗ ne ramenait pas toujours celle de la session. La recherche par nom du dossier `cwd` échoue quand la session tourne dans un sous-dossier, dans un workspace multi-dossiers, ou quand le titre ne contient pas ce nom.
- **Choix** : l'extension Claude Code écrit un fichier `~/.claude/ide/<port>.lock` par fenêtre (`pid`, `workspaceFolders`). L'app garde les fenêtres vivantes, prend celle dont un dossier de workspace contient le `cwd` (le plus précis), et cherche dans les titres, dans l'ordre : nom du dossier racine de cette fenêtre, nom du dossier de la session, puis ses parents.
  - macOS : l'AppleScript compare aussi le fichier actif de chaque fenêtre (`AXDocument`) au chemin racine.
  - Si le dossier n'est ouvert nulle part, `code` rouvre le **dossier racine** (pas le sous-dossier, qui créerait une fenêtre de plus).
- Limite : deux fenêtres sur le même dossier restent indiscernables (la 1re trouvée est prise).

## D22 — Mises à jour automatiques : updater maison + Releases GitHub
- **Choix (validé par l'utilisateur)** :
  - à chaque tag `vX.Y.Z`, GitHub Actions (`.github/workflows/release.yml`) construit l'app sur macOS (universelle : `.dmg` + `.zip`) et sur Windows (`.exe` NSIS), puis crée la Release avec `SHA256SUMS.txt` ;
  - l'app vérifie `releases/latest` 15 s après le démarrage puis toutes les 6 h (désactivable). Si une version plus récente existe : bandeau « Version X disponible · Installer » + entrée dans le menu de l'icône ;
  - « Installer » : confirmation, téléchargement, **vérification SHA-256** (sinon refus), puis :
    - Windows : installeur NSIS silencieux `/S --force-run`, qui relance l'app ;
    - macOS : script qui attend la fin de l'app, remplace le `.app`, puis le relance.
- **Alternative écartée** : `electron-updater`. Sur macOS, il passe par Squirrel.Mac, qui exige une app signée par un compte Apple Developer.
- **Vérifié** : Windows de bout en bout (`e2e/update-win.mjs` : 0.2.0 installée → détecte 0.2.1 → installe → relance en 14 s). macOS : logique couverte par des tests unitaires, jamais exécutée sur un Mac.
- **Limite macOS** : l'app n'est signée qu'« ad hoc ». Chaque nouvelle version a donc une signature différente, et macOS peut **oublier les autorisations Accessibilité / Automatisation** après une mise à jour : il faut alors les réactiver (menu → Autorisations macOS…). Seule solution durable : signer avec un certificat stable (Apple Developer, ou certificat auto-signé importé dans la CI, non testé).
- Le dépôt doit être **public** : l'API GitHub anonyme ne voit pas les Releases d'un dépôt privé (l'app répondrait « à jour »).

## D23 — Quota Claude en direct (validé par l'utilisateur)
- **Source** : `GET https://api.anthropic.com/api/oauth/usage` (service **interne non documenté**, celui de `/usage`), avec le jeton de Claude Code. Réponse utilisée : tableau `limits` (`kind`, `percent`, `severity`, `resets_at`), sinon `five_hour` / `seven_day`.
- **Jeton** : lu seulement (Windows/Linux : `~/.claude/.credentials.json` ; macOS : trousseau « Claude Code-credentials », macOS demande l'accès). Jamais écrit ni renouvelé : un renouvellement par l'app pourrait invalider celui de Claude Code. Jeton expiré → « Session Claude Code expirée ».
- **Rythme** : au démarrage, toutes les 3 min, à l'ouverture du panneau (si > 60 s).
- **Affichage** : deux jauges sous l'en-tête (Session, Semaine), neutres, orange en « warning », rouge en « critical ». Remise à zéro affichée. Désactivable (menu → Afficher le quota Claude).
- **Risque accepté** : Anthropic peut changer ce service ; l'app affiche alors « Quota indisponible » sans autre effet.

## D24 — Agents Codex (validé par l'utilisateur)
- **Installation** : menu de l'icône → « Installer les hooks Codex… » (ou `npm run hooks -- install --codex --user`) → `~/.codex/hooks.json`, avec fusion, sauvegarde et désinstallation exacte (même code que Claude). Puis **approbation dans Codex** (Réglages → Hooks → Review hooks, ou `/hooks`) : l'app ne contourne pas ce contrôle de sécurité.
- **Hooks** : `PermissionRequest` synchrone (statusMessage « En attente de FollowMyAgents… ») ; les autres en `async` ; `curl --connect-timeout 0.5 … ; exit 0` ; `?agent=codex` dans l'URL pour marquer la session.
- **Délai** : une demande Codex reste 60 s dans le widget (réglable : `prefs.codexPendingTimeoutSec`), puis repasse dans le dialogue de VS Code, qui n'apparaît qu'à ce moment (phase0 Codex).
- **Pas de « Toujours autoriser »** pour Codex (`updatedPermissions` refusé par Codex), ni de réponse aux questions (aucun hook).
- **Jump** : `vscode://openai.chatgpt/local/<id>` après mise au premier plan de la bonne fenêtre.
- **Vérifié en conditions réelles** (`e2e/live-codex.mjs`, CODEX_HOME temporaire) : autoriser, refuser, retour vers VS Code après le délai, badge et activité.

## D25 — Quota Codex
- **Source** : Codex lui-même, via `codex app-server` → `account/rateLimits/read` (protocole décrit par `codex app-server generate-json-schema`). L'app lance un court processus, lit, puis l'arrête (~0,5 s). Elle **ne lit pas** la connexion Codex.
- **Fenêtres** : `primary` / `secondary` avec `usedPercent`, `windowDurationMins`, `resetsAt`. Libellés communs à Claude et Codex, selon la durée : « 5 h », « Semaine », « 30 jours ». Chaque fournisseur a son en-tête avec son offre (« Claude · Pro », « Codex · Gratuit »).
- **Offre gratuite Codex** (constaté le 2026-11-19 via `account/rateLimits/read` et `account/read`) : une seule fenêtre de 30 jours, pas de fenêtre de 5 h. Les offres payantes déclarent en général 5 h + semaine ; l'app affiche ce que Codex renvoie.
- **Rythme** : toutes les 5 min et à l'ouverture du panneau (si > 2 min). Rien n'est affiché si Codex n'est pas installé.
- **Binaire** : extension VS Code `openai.chatgpt-*/bin/<plateforme>/codex`, puis app Codex, Homebrew, npm.

## D26 — Lisibilité (retour utilisateur)
- **Agents internes ignorés** : Claude Code émet `SubagentStart/Stop` pour ses agents internes (suggestions de prompt, `/btw`) avec `agent_type` vide. Ils apparaissaient comme « Sous-agent · publie la 0.3.0 ». Ils sont désormais ignorés.
- **Bloc Terminal** : commande limitée à 3 lignes, un clic l'affiche en entier.
- **Sous-agents terminés** : seuls les 3 derniers sont affichés dans la vue détail.
- **Largeur réglable** : poignée sur le bord gauche du panneau (300–600 px), double-clic pour revenir à 320 px. Le bord droit reste fixe. La largeur est mémorisée (`prefs.panelWidth`). Vérifié avec un vrai glisser à la souris (`e2e/native.mjs`).
