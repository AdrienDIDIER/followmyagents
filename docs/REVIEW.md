# FollowMyAgents — rapport de fin de travail

Branche `feat/followmyagents` (rien n'a été poussé ni publié).

> ⚠️ **Différence majeure avec les consignes** : la machine n'était **pas un Mac** mais un **PC Windows 11** (`win32`, Windows 11 Pro). Tout a été développé et vérifié sous Windows. Le code macOS existe (barre des menus, vibrancy, NSPanel, espaces, plein écran, `code` CLI) mais **n'a jamais été exécuté**. Voir la checklist macOS (§3.B).

---

## 1. Ce qui a été construit

**Phase 0 — validation technique** (`docs/phase0.md`) avec un serveur de test, un bac à sable (`./sandbox`, hooks dans son propre `.claude/settings.local.json`) et une **imitation de l'extension VS Code** (`phase0/sdk-host.mjs`). Elle pilote `claude` exactement comme l'extension (`stream-json` + dialogue de permission côté hôte). Résultats clés :
- allow / deny : ✅ appliqués ;
- le dialogue VS Code s'affiche **en parallèle** du hook. Si on répond dans VS Code, Claude Code **ferme la requête du hook**. Si on répond dans le widget, Claude Code **annule le dialogue VS Code** ;
- les questions AskUserQuestion passent mieux par `PermissionRequest` que par `PreToolUse` : la question apparaît en même temps dans les deux interfaces (D3). Les réponses libres fonctionnent ;
- **`SessionStart` refuse les hooks HTTP**. Avec l'app fermée, un hook HTTP sur `Stop`/`SessionEnd` affiche une erreur. → hooks hybrides HTTP + `command`/curl, silencieux (D4) ;
- Windows bloque la mise au premier plan de VS Code par l'URI seul → script PowerShell de focus (D6) ;
- `TodoWrite` / `TaskCreate` sont désactivés par défaut dans Claude Code 2.1.322.

**L'application** (Electron 45 + React 19 + TypeScript, electron-vite) :
- **Serveur local** `127.0.0.1:47821`, token aléatoire de 256 bits en en-tête `X-FMA-Token` (401 sinon), requêtes de navigateur refusées (`Origin` → 403), `Connection: close`.
- **Store d'état** : sessions (titre, sous-titre lisible, couleur, état, étapes, dernière commande + 3 lignes de sortie, sous-agents, dernier message), demandes en attente avec timeout, flash de confirmation, passage en « déconnecté », retrait auto des sessions terminées.
- **Titres** : `session_title` > titre de l'onglet VS Code lu dans le transcript (`ai-title`) > 1er prompt > dossier (D11).
- **Installeur de hooks** : fusion propre, sauvegarde horodatée, écriture atomique, désinstallation qui restaure exactement l'original, refus d'écrire si le JSON est invalide. Accessible depuis le menu de l'icône (avec confirmation) et en CLI (`npm run hooks -- …`, `--user` obligatoire pour la vraie config).
- **Panneau** (direction A « Verre macOS ») : section « Attend ta réponse » en haut, lignes « En cours » avec anneau de progression seulement s'il y a de vraies étapes, section « Terminés (n) » repliée avec aperçu au survol, vue détail (étapes avec icônes, bloc Terminal, dernier message, mini-avatars pour changer d'agent), mascottes SVG animées (6 expressions + clignement), `prefers-reduced-motion` respecté.
- **Permissions** : Refuser / Autoriser / Toujours autoriser (si `permission_suggestions`) / Ouvrir dans VS Code.
- **Questions** : options (radio), multiSelect (cases), plusieurs questions, champ « Autre… » pour une réponse libre, Envoyer actif seulement quand tout est répondu, Répondre dans VS Code.
- **Icône système** : mascotte (yeux ronds + pastille orange avec le nombre sous Windows ; image *template* + nombre sur macOS). Clic : panneau ouvert qui reste ouvert. Clic droit : menu (son, notifications, lancement au démarrage, état / installation / désinstallation des hooks, dossier de config, quitter).
- **Comportement du panneau** : ouverture automatique sans voler le focus quand un agent attend, fermeture automatique après la réponse (sauf s'il avait été ouvert par un clic), Échap, raccourci global `Ctrl+Alt+A` / `Cmd+Option+A` (ouvre et focalise la 1re demande ; Entrée = Autoriser, Échap = Refuser, 1–9 = option), détacher / rattacher (position mémorisée).
- **Jump VS Code** : fenêtre du bon dossier mise au premier plan (PowerShell sous Windows, `code <cwd>` ou `open -a` sous macOS), puis `vscode://anthropic.claude-code/open?session=<id>`.
- **Verre natif** : acrylique sous Windows 11 (vérifié par capture d'écran réelle), vibrancy `popover` sous macOS (non testé).
- **Son** (carillon synthétisé, préférence mémorisée), **notifications natives** si une demande reste sans réponse 30 s (D9), **lancement au démarrage** (option).
- **Reprise au démarrage** : les sessions dont le transcript a bougé depuis moins de 30 min sont réaffichées.
- **Packaging** : installeur Windows NSIS construit et testé (`release/FollowMyAgents Setup 0.1.0.exe`). Configuration `.dmg` prête (à construire sur un Mac).

**Tests automatisés** :

| Suite | Contenu | Résultat |
|---|---|---|
| `npm test` (Vitest) | serveur (token, Origin, requêtes ouvertes, fermeture, Connection: close…), store (états, étapes, permissions, questions, timeouts, secours D5…), installeur (fusion, sauvegarde, idempotence, désinstallation exacte, JSON invalide, BOM, indentation), descriptions, transcripts, jump VS Code (macOS/Windows, commandes simulées), séquence réelle sous-agent + arrière-plan rejouée | ✅ **103/103** |
| `npm run e2e` | app Electron pilotée par Playwright, vrais hooks HTTP : ouverture auto sans focus, Autoriser / Refuser / Toujours, fermeture auto, reste ouvert après un clic, « répondu dans VS Code », questions (simple, libre, multiples + multiSelect), Répondre dans VS Code (+ jump), vue détail, sous-agents et tâches en arrière-plan, ×, son, Échap, reduced-motion, aucune installation implicite | ✅ **22/22** |
| `npm run e2e:native` | Windows : focus jamais volé (fenêtre au premier plan vérifiée), capture réelle du verre, **vrai clic souris** sur le panneau non focalisable, raccourci global + Entrée + Échap, détacher à la souris + position mémorisée + rattacher | ✅ **5/5** |
| `npm run e2e:live` | **vraies sessions Claude Code** (haiku) dans `./sandbox`, hooks écrits par l'installeur (CLI) : permission autorisée → commande exécutée et dialogue hôte annulé ; refusée → non exécutée ; question → l'agent reçoit la bonne option ; réponse côté hôte → la demande disparaît du widget ; commande + sous-agent en arrière-plan suivis jusqu'à leur fin ; 4 sessions en parallèle ; désinstallation | ✅ **7/7** |

Captures : `docs/screenshots/` (`maquette-A.png` = rendu de la maquette, à comparer avec `02-permission.png`).

---

## 2. Lancer l'app

Prérequis : Node 22+ et npm.

```bash
npm install
npm run build
npm start
```

> Depuis le **terminal intégré de VS Code**, la variable `ELECTRON_RUN_AS_NODE=1` est héritée et empêche Electron de démarrer normalement. `npm start` / `npm run dev` la retirent eux-mêmes. Pour lancer `electron` à la main, retirez-la d'abord (`Remove-Item Env:ELECTRON_RUN_AS_NODE` en PowerShell, `unset ELECTRON_RUN_AS_NODE` sous macOS).

- Mode développement (rechargement à chaud) : `npm run dev`.
- Installeur Windows : `npm run dist:win` → `release/FollowMyAgents Setup 0.1.0.exe` (non signé : SmartScreen → « Informations complémentaires » → « Exécuter quand même »).
- macOS : `npm run dist:mac` **sur le Mac** → `release/FollowMyAgents-0.1.0.dmg` (non signé : clic droit → Ouvrir la 1re fois).
- Config de l'app (token, port, préférences) : `%APPDATA%\FollowMyAgents\config.json` / `~/Library/Application Support/FollowMyAgents/config.json`.

---

## 3. Tests manuels à faire, dans l'ordre

### A. Windows (ce PC) et macOS

1. **Lancer** : `npm start`. → Une mascotte bleue apparaît dans la zone de notification / la barre des menus. **Aucune fenêtre.**
2. **Clic sur l'icône** → le panneau s'affiche (au-dessus de l'icône sous Windows, dessous sur macOS) avec « Aucun agent en cours » et l'avertissement « Hooks non installés ». Cliquer ailleurs : **le panneau reste**. Nouveau clic sur l'icône : il se ferme.
3. **Installer les vrais hooks** (après relecture de `src/main/installer.ts`) : clic droit sur l'icône → « Installer les hooks… » → la boîte de dialogue montre le chemin `~/.claude/settings.json` → Installer. Ou : `npm run hooks -- install --user`.
   → Un fichier `settings.json.fma-backup-AAAAMMJJ-HHMMSS` est créé à côté. `settings.json` contient vos réglages intacts, plus des entrées avec `X-FMA-Token`. Le menu indique « Hooks installés ✓ ».
4. **Nouvelle session Claude Code dans VS Code** (ouvrir un nouvel onglet Claude ; les sessions déjà ouvertes peuvent ne prendre les hooks qu'à leur redémarrage). Envoyer un prompt. → En moins d'1 s, une ligne apparaît dans le panneau avec le titre (celui de l'onglet VS Code dès qu'il est généré) et l'action en cours.
5. **Test (b), cas 1 : répondre dans le widget.** Demander à l'agent : « crée le fichier essai.txt avec la commande echo ». Quand la permission arrive :
   → le panneau s'ouvre **tout seul sans prendre le focus** (continuez à taper ailleurs, la frappe ne doit pas aller dans le panneau) ;
   → **dans VS Code, le dialogue de permission s'affiche aussi**.
   Cliquer « Autoriser » dans le widget. → « ✓ Autorisé » s'affiche, le panneau se referme (~1,5 s), **le dialogue VS Code disparaît tout seul** et la commande s'exécute. *(Vérifié par protocole en Phase 0, b-3 : annulation `control_cancel_request`. À confirmer à l'œil.)*
6. **Test (b), cas 2 : répondre dans VS Code.** Même demande. Cette fois, répondre dans **VS Code**. → La demande **disparaît du widget en moins d'1 s** (fermeture de la requête détectée, D5).
7. **Refuser** depuis le widget → l'agent ne lance pas la commande et le dit.
8. **Toujours autoriser** (lien sous les boutons, présent quand Claude Code propose une règle) → la commande passe. La même commande ne redemande plus la permission (règle ajoutée dans `.claude/settings.local.json` du projet).
9. **Question** : « pose-moi une question avec AskUserQuestion, 3 options ». → La question s'affiche **dans le widget et dans VS Code**. Choisir une option → Envoyer → la question VS Code disparaît, l'agent continue avec la bonne option, et le widget affiche « Réponse : « … » ». Recommencer avec « Autre… » (texte libre), puis en répondant dans VS Code (la question doit disparaître du widget).
10. **« Ouvrir dans VS Code » / « Répondre dans VS Code »** → la demande quitte le widget, VS Code passe au premier plan **sur le bon onglet**, et le dialogue habituel y est toujours.
11. **Bouton ↗ avec 2 fenêtres VS Code** ouvertes sur deux dossiers différents, chacune avec une session. Réduire VS Code. ↗ sur la session du dossier B → la fenêtre B passe devant, sur l'onglet de cette session. Idem pour A.
12. **4 sessions** en parallèle, VS Code réduit → 4 lignes à jour, la mascotte de chacune selon son état, l'anneau seulement si l'agent a une liste d'étapes.
13. **Vue détail** : clic sur une ligne → « Plan » si l'agent en tient un, sinon « Activité récente » (dernières actions cochées, action en cours qui tourne), bloc Terminal (dernière commande + 3 lignes), « ‹ Agents » pour revenir, mini-mascottes pour passer d'un agent à l'autre.
13 bis. **Sous-agents / arrière-plan** : demander à l'agent « lance `sleep 30` en arrière-plan et un sous-agent en arrière-plan qui résume le README, puis rends la main ». → La ligne affiche « En arrière-plan · … » avec une mascotte active et « 2 en fond ». La vue détail liste le sous-agent (son action en cours) et la commande. Le résultat du sous-agent apparaît quand il a fini, et tout disparaît de « en fond » à la fin.
13 ter. **Plans des agents** : clic droit sur l'icône → cocher « Plans des agents (active TodoWrite) » → confirmer. Dans une **nouvelle** session, demander une tâche en plusieurs étapes → la vue détail affiche « Plan » avec les étapes cochées au fur et à mesure, et la ligne un anneau de progression.
14. **Raccourci** `Ctrl+Alt+A` (macOS : `Cmd+Option+A`) pendant qu'une demande attend → le panneau s'ouvre avec le focus sur la demande. `Entrée` = Autoriser, `Échap` = Refuser. Sur une question : `1`–`9` puis `Entrée`.
15. **Détacher** (2e bouton de l'en-tête) → glisser le panneau par son en-tête n'importe où. Fermer / rouvrir : même position. « Rattacher » → retour près de l'icône.
16. **Son** : bouton haut-parleur → un carillon discret à l'arrivée d'une demande. Préférence conservée après redémarrage.
17. **Notification** : laisser une demande sans réponse 30 s → notification native ; un clic dessus ouvre le panneau sur la demande.
18. **App fermée** : clic droit → Quitter. Utiliser Claude Code normalement (prompt, permission, question, fin de tour, fermeture de session). → **Aucun blocage, aucun message d'erreur de hook** dans VS Code. *(Vérifié en Phase 0 avec l'imitation de l'extension, à confirmer dans le vrai VS Code.)*
19. **Désinstaller** : clic droit → « Désinstaller les hooks… » (ou `npm run hooks -- uninstall --user`). → `settings.json` retrouve son contenu d'avant l'installation (comparer avec la sauvegarde). Une nouvelle sauvegarde est créée.

### B. macOS uniquement (rien n'a pu être exécuté sur Mac)

1. `npm install && npm run build && npm start` : l'app **n'apparaît pas dans le Dock**, l'icône de la barre des menus est une mascotte monochrome qui suit le thème clair/sombre.
2. Quand un agent attend : le **nombre** s'affiche à côté de l'icône, les yeux de la mascotte deviennent ronds.
3. **Verre** : le bureau doit être flouté derrière le panneau, **coins arrondis propres** (pas de coin carré « vitré » qui dépasse). Si le rendu n'est pas bon : essayer `FMA_VIBRANCY=hud npm start`, et me le signaler (réglages dans `src/main/panel.ts`).
4. Le panneau ne prend pas le focus quand il s'ouvre seul (NSPanel `type: "panel"`), et un clic sur « Autoriser » ne fait pas quitter l'éditeur.
5. **Espaces** : changer de bureau virtuel → le panneau reste visible. Mettre une app en plein écran → le panneau reste par-dessus.
6. **Jump (↗)** : au 1er usage, macOS demande d'autoriser FollowMyAgents dans **Réglages Système → Confidentialité et sécurité → Accessibilité** (un message l'explique). Activer l'option, puis réessayer ↗.
   → Avec 2 fenêtres VS Code (dossiers A et B) : ↗ sur une session de B fait passer **la fenêtre B** devant (même réduite dans le Dock), sur l'onglet de la session. Si ça ne marche pas : `FMA_DEBUG=1 npm start` affiche `focus-window-mac : …` (titre trouvé, ou erreur), et `osascript -e 'tell application "System Events" to get name of every window of process "Code"'` montre les titres réels des fenêtres. Envoyez-moi les deux.
7. **Notifications** : macOS demande l'autorisation à la 1re notification. Une app non signée peut ne pas apparaître dans Réglages > Notifications : à vérifier.
8. Relancer la batterie automatisée : `npm test && npm run e2e`, puis `npm run e2e:live` (le test natif est propre à Windows).
9. `npm run dist:mac` → le `.dmg` s'installe et l'app se lance (clic droit → Ouvrir).

### Rappel sur Windows

- Pendant un test « natif », Notepad a été lancé une fois puis fermé par mon script. Il avait restauré votre onglet non enregistré **« Compte.txt »**. Le Bloc-notes de Windows 11 conserve ces onglets (les fichiers d'état dans `%LOCALAPPDATA%\Packages\Microsoft.WindowsNotepad_…\LocalState\TabState` n'ont pas été modifiés) : l'onglet doit réapparaître à la prochaine ouverture du Bloc-notes. Merci de vérifier. Ensuite, je n'ai utilisé que des fenêtres créées pour le test.

---

## 4. Critères d'acceptation (§8)

| # | Critère | Statut | Détail / marche à suivre |
|---|---|---|---|
| 1 | 4 sessions VS Code, VS Code réduit : 4 cartes à jour en < 1 s | ✅ / 🟡 | ✅ `e2e:live` : 4 vraies sessions Claude Code simultanées affichées ; `e2e` : mise à jour < 1 s mesurée (hook → affichage). 🟡 Avec le vrai VS Code : test manuel A.12. |
| 2 | Permission Bash acceptée et refusée depuis le widget, l'agent continue / s'arrête sans ouvrir VS Code | ✅ / 🟡 | ✅ `e2e:live` avec de vraies sessions : fichier créé si Autoriser, non créé si Refuser, dialogue de l'hôte annulé. 🟡 Dans le vrai VS Code : A.5, A.7. |
| 3 | Question AskUserQuestion répondue depuis le widget, l'agent continue avec la bonne option | ✅ / 🟡 | ✅ `e2e:live` : l'agent répond `ANSWER=Bleu`. 🟡 Dans VS Code : A.9. |
| 4 | « In VS Code » / « Type in VS Code » : dialogue normal dans VS Code + bon onglet au premier plan | 🟡 | ✅ réponse vide (aucune décision) + jump déclenché sur la bonne session (`e2e`) ; dialogue affiché en parallèle (Phase 0). 🟡 Onglet au premier plan : A.10. |
| 5 | ↗ met au premier plan l'onglet de la bonne session, même avec 2 fenêtres VS Code | 🟡 | Mécanisme vérifié en partie en Phase 0 (d) : URI traité, fenêtre mise au premier plan par le script. 🟡 A.11. |
| 6 | App fermée : Claude Code fonctionne comme sans elle | ✅ / 🟡 | ✅ Phase 0 : serveur arrêté, session complète via l'imitation de l'extension, aucun blocage, aucune erreur ni notification (après passage aux hooks hybrides, D4). 🟡 A.18 dans le vrai VS Code. |
| 7 | Requête sans token valide rejetée (401) | ✅ | Tests unitaires + `e2e` + app packagée. |
| 8 | La désinstallation restaure `settings.json` sans toucher aux autres hooks | ✅ | Tests unitaires (égalité exacte avec l'original, hooks utilisateur dans le même groupe conservés) + `e2e:live` sur le fichier du bac à sable. 🟡 A.19 sur la vraie config. |
| 9 | Le panneau ne vole jamais le focus | ✅ Windows / 🟡 macOS | `e2e:native` : fenêtre au premier plan inchangée après l'ouverture auto **et** après un vrai clic sur Autoriser. 🟡 macOS : B.4. |
| 10 | Animations désactivées avec `prefers-reduced-motion` | ✅ | `e2e` (émulation) : mascottes immobiles, glissements remplacés par des fondus. |
| 11 | Au repos, aucune fenêtre ; ouverture seule sans focus quand un agent attend ; fermeture après réponse sauf si ouvert par clic | ✅ | `e2e` + `e2e:native`. |
| 12 | Ouvert par clic : reste affiché quand on clique ailleurs ; se ferme au clic suivant sur l'icône, au raccourci ou à Échap | ✅ / 🟡 | ✅ pas de fermeture sur perte de focus (aucun gestionnaire `blur` qui masque), reste ouvert après une réponse, Échap et raccourci vérifiés. 🟡 Clic sur l'icône (non automatisable) : A.2. |
| 13 | Fond = verre natif flouté, aucune couleur fluo | ✅ Windows / 🟡 macOS | Capture réelle `docs/screenshots/10-verre-natif-windows.png` (acrylique). 🟡 macOS : B.3. |
| 14 | macOS : visible en changeant d'espace et par-dessus le plein écran | 🟡 | Code présent (`setAlwaysOnTop("screen-saver")`, `setVisibleOnAllWorkspaces(…, { visibleOnFullScreen: true })`), jamais exécuté : B.5. |
| 15 | Tous les critères validés sur macOS et sur Windows | 🟡 | Windows : voir ci-dessus. **macOS : rien n'a pu être exécuté** (pas de Mac) → checklist B. |

---

## 5. Décisions importantes prises sans vous

Détail dans [`docs/DECISIONS.md`](DECISIONS.md). Les plus structurantes :
- **D3** — Questions via `PermissionRequest` au lieu de `PreToolUse` : la question apparaît en même temps dans VS Code et dans le widget.
- **D4** — Hooks hybrides HTTP + `command`/curl : `SessionStart` refuse le HTTP, et sans cela l'app fermée provoquerait des erreurs visibles.
- **D5** — « Répondu dans VS Code » détecté par la fermeture de la requête du hook.
- **D6** — Jump Windows : script PowerShell de mise au premier plan, puis URI.
- **D8** — Délai de relâche d'une demande : 580 s au lieu de 120 s (le dialogue VS Code est déjà affiché en parallèle).
- **D9** — Notifications seulement après 30 s sans réponse.
- **D11** — Titres = titre de l'onglet VS Code lu dans le transcript (pas d'appel à Haiku).
- **D12** — Panneau non focalisable sous Windows, focalisable seulement pour la saisie clavier.
- **D15** — Aucune installation automatique des hooks.
- **D18** — Jump macOS : AppleScript (accès Accessibilité) pour ramener la bonne fenêtre (correctif après retour).
- **D19** — Sous-agents et tâches en arrière-plan suivis (correctif après retour).
- **D20** — « Activité récente » quand l'agent n'a pas de plan + option « Plans des agents » qui active TodoWrite (correctif après retour).
- **D21** — Choix de la fenêtre VS Code grâce aux fichiers `~/.claude/ide/*.lock` (correctif après retour).

---

## 6. Problèmes connus, limites, pistes

- **macOS non testé** (pas de Mac) : risques principaux sur le rendu du verre et des coins (`src/main/panel.ts`), la position sous l'icône, le type `panel` et l'AppleScript du jump (`resources/scripts/focus-window-mac.applescript`, D18).
- **Jump macOS sans Accessibilité** : VS Code est seulement activé, l'onglet s'ouvre dans la fenêtre active (qui n'est pas forcément la bonne).
- **Listes d'étapes rares** : dans Claude Code 2.1.322, `TodoWrite` / `TaskCreate` sont désactivés par défaut. La plupart des sessions n'ont donc pas d'anneau (indicateur d'activité + temps écoulé à la place). Le format de `TaskCreate` / `TaskUpdate` est déduit, pas observé.
- **Sessions reprises au démarrage** : impossible de savoir si une session est encore ouverte. Une session fermée depuis peu apparaît « en pause » jusqu'à 30 min après sa dernière activité (bouton × pour la retirer).
- **Hooks et sessions déjà ouvertes** : Claude Code peut ne prendre les nouveaux hooks qu'au démarrage d'une session.
- **Plusieurs fenêtres VS Code sur le même dossier** : indiscernables, le script de focus prend la première qui correspond (D21).
- **Titre de fenêtre VS Code personnalisé** (`window.title`) : si le nom du dossier n'apparaît pas dans le titre, le jump Windows met au premier plan une fenêtre VS Code quelconque. L'URI ouvre quand même la session dans la fenêtre active.
- **Badge macOS** : `tray.setTitle` n'accepte pas de couleur, le nombre n'est donc pas orange.
- **Sessions terminal (CLI)** : affichées (les hooks sont globaux), mais le jump ouvre la session dans VS Code (v2 du brief : `claude-cli://`).
- **Packaging** : builds non signées. Pas de signature ni de notarisation.
- **Pistes** : titre court « Verbe · Objet » via Haiku (option), regroupement par dossier, chronomètre « attend depuis » plus visible, historique du jour, thème clair, icône animée.
- **Coût des tests réels** : `npm run e2e:live` lance environ 8 courtes sessions `haiku`.
