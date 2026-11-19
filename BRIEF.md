# FollowMyAgents — Brief produit

> Widget de bureau toujours visible qui montre en temps réel ce que fait chaque session Claude Code, et permet d'**autoriser une permission** ou de **répondre à une question** d'un agent **sans ouvrir VS Code**.
>
> Inspiré de la démo « Agent Huddle » (vidéo TikTok @alextsoi.ai, 39 s). Les captures de référence sont dans [docs/reference/](docs/reference/). Le nom, le logo et les mascottes doivent être **les nôtres** : reprendre l'esprit, ne pas copier à l'identique.

---

## 1. Problème et promesse

**Problème** : quand on lance plusieurs agents Claude Code en parallèle (plusieurs onglets dans VS Code) puis qu'on réduit VS Code, on ne sait plus ce qu'ils font, lequel est bloqué sur une permission, lequel attend une réponse. On passe sa journée à ouvrir et fermer des onglets. Réf. : `01-probleme-agents-inconnus.jpg`.

**Promesse** : un petit panneau flottant dans le coin supérieur droit de l'écran. Chaque agent y a sa mascotte, sa progression et son état. On agit directement depuis le panneau, et un clic ramène sur le bon onglet VS Code.

**Utilisateur cible** : un développeur qui fait tourner 2 à 8 sessions Claude Code dans l'extension VS Code, sur **macOS** (poste pro) **et Windows 11** (poste perso). Les deux plateformes sont visées **dès la v1**, avec le même code. Les différences sont regroupées en §4.8.

---

## 2. Ce que montre la vidéo (fonctionnalités observées)

> Ce tableau décrit les **fonctionnalités** de l'app d'origine. Son **style** (vert fluo, cartes, pilules) n'est **pas** repris : le design à implémenter est celui du §3.

| # | Fonctionnalité | Réf. |
|---|---|---|
| F1 | Panneau flottant, toujours au premier plan, ancré en haut à droite de l'écran | `03` |
| F2 | Une **carte par session** : mascotte colorée, titre, sous-titre (action en cours), compteur `5/7` + libellé de l'étape, barre de progression | `04` |
| F3 | En-tête : point vert « live », nom de l'app, **nombre de sessions**, bouton son (haut-parleur), bouton réduire `^`, bouton fermer `×` | `04` |
| F4 | Survol d'une carte : bordure accent (lime) | `05` |
| F5 | Clic sur une carte → **vue détail** : grande mascotte, titre, progression, **liste des étapes** (fait / en cours / à faire, avec une icône par type d'action : terminal, crayon), et un **bloc Terminal** avec la dernière commande et sa sortie | `06` |
| F6 | En-tête de la vue détail : `<` retour, mini-avatars des autres agents (pour passer de l'un à l'autre), ↗ ouvrir dans VS Code, son, réduire, fermer | `06` |
| F7 | **Permission** : la carte se déplie avec une bordure lime et le sous-titre devient « needs permission ». Elle affiche la commande (`Bash: npx hyperframes render . -o out.mp4`) et trois boutons : **Allow** (plein, lime), **Deny**, **In VS Code** | `07` |
| F8 | Après Allow, le sous-titre affiche « Allowed ✓ » en lime pendant ~2 s, puis la carte reprend son état normal | `08` |
| F9 | **Question de l'agent** : la carte se déplie et les autres s'estompent. On voit un chip (ex. `HOOK`), la question en gras, des options en boutons radio, puis les boutons **Send** et **Type in VS Code** | `09`, `10` |
| F10 | Après réponse, le sous-titre affiche « Using "The pain one" » en lime, et VS Code n'a **pas été ouvert** | `11` |
| F11 | Bouton ↗ sur chaque carte → met VS Code au premier plan **sur l'onglet de cette session** | `12`, `13` |
| F12 | Bouton × sur une carte → retire la session terminée de la liste | `14` |

---

## 3. Design — notre version (à la place du look de la vidéo)

> **Décision** : on **ne reprend pas** le style de la vidéo (fond anthracite, accent vert fluo, boutons pilule, cartes empilées, tout au même poids visuel), jugé trop générique, « IA ». Direction retenue : **moderne, sombre, minimaliste à la Apple, en verre macOS**. Maquettes validées : [docs/design/](docs/design/) (`directions-visuelles.html`, direction **A** ; `comportement-panneau.html`). Les captures de la vidéo ([docs/reference/](docs/reference/)) ne servent plus que pour les **fonctionnalités**, pas pour le style.

### 3.1 Principes
1. **« Qui a besoin de moi, maintenant ? » d'abord.** Les agents qui t'attendent sont sortis de la liste et placés en haut, dans une section dédiée. Les autres restent discrets.
2. **Une ligne par agent au repos.** Mascotte, titre, action en cours, anneau de progression. Pas de bloc de 4 lignes par agent.
3. **Natif avant tout.** Typo système, matériau translucide du système, couleurs système, boutons rectangulaires arrondis (pas de pilules), animations sobres.
4. **Pas de fausse précision.** L'anneau de progression n'apparaît que si l'agent a une vraie liste d'étapes. Sinon, rien (ou un discret indicateur d'activité).
5. **La couleur a un sens.** Bleu = action principale. Orange = attend ta réponse. Couleur propre à chaque agent = identité (mascotte + anneau). Rien d'autre n'est coloré.

### 3.2 Tokens

```css
/* Matériau : le fond du panneau est le verre NATIF du système (voir §4.7).
   Le CSS ne fait qu'ajouter une teinte par-dessus. */
--panel-tint:      rgba(30, 30, 34, 0.55);   /* teinte sur le verre */
--panel-border:    rgba(255, 255, 255, 0.14); /* bordure 0.5px */
--panel-fallback:  #1E1E22;                   /* si le verre natif est indisponible */
--fill-1:          rgba(255, 255, 255, 0.07); /* bloc "attend ta réponse", survol de ligne */
--fill-2:          rgba(255, 255, 255, 0.12); /* boutons secondaires */
--inset:           rgba(0, 0, 0, 0.35);       /* bloc commande / terminal */
--separator:       rgba(255, 255, 255, 0.10);

--text-1: #F5F5F7;                    /* titres */
--text-2: rgba(235, 235, 245, 0.55);  /* sous-titres */
--text-3: rgba(235, 235, 245, 0.40);  /* en-têtes de section, étapes terminées */

--action:    #0A84FF;  /* bleu système (mode sombre) : Autoriser, Envoyer */
--attention: #FF9F0A;  /* orange système : "attend ta réponse", badge */
--danger:    #FF453A;  /* erreurs uniquement */
--success:   #30D158;  /* coche de confirmation */

/* Couleurs d'agent (palette système Apple, mode sombre), attribuées en rotation */
--agent-1: #0A84FF; /* bleu    */
--agent-2: #FF375F; /* rose    */
--agent-3: #FF9F0A; /* orange  */
--agent-4: #BF5AF2; /* violet  */
--agent-5: #66D4CF; /* menthe  */
--agent-6: #30D158; /* vert    */

--radius-panel: 16px;
--radius-block: 11px;
--radius-control: 7px;   /* boutons, bloc commande */
--font-ui:   -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", system-ui, sans-serif;
--font-mono: "SF Mono", ui-monospace, Menlo, "Cascadia Code", monospace;
```

> Quand une couleur d'agent coïncide avec l'orange d'attention (agent n°3), l'état d'attention reste lisible grâce au libellé orange et aux yeux de la mascotte. Option : sauter `--agent-3` tant qu'un autre agent est en attente.

### 3.3 Typographie
- En-tête du panneau : « Agents » 13 px semibold + « 4 actifs » 12 px `--text-2`.
- En-têtes de section (« Attend ta réponse », « En cours ») : 11 px semibold `--text-3`, casse normale (pas de majuscules).
- Titre d'agent : 13 px, medium (semibold dans le bloc d'attention).
- Sous-titre : 11.5–12 px `--text-2`. En **orange medium** quand l'agent t'attend.
- Commandes : `--font-mono` 11.5 px.

### 3.4 Structure du panneau (largeur ~320 px, hauteur selon le contenu, max 70 % de l'écran)

```
┌────────────────────────────────────┐
│ Agents                     4 actifs│  ← en-tête (+ boutons discrets : son, détacher)
│ Attend ta réponse                  │  ← section présente seulement si besoin
│ ┌────────────────────────────────┐ │
│ │ (◉◉) Idea Scout                │ │
│ │      Veut exécuter une commande│ │  ← orange
│ │ ┌────────────────────────────┐ │ │
│ │ │ npx hyperframes render …   │ │ │  ← mono, fond --inset
│ │ └────────────────────────────┘ │ │
│ │ [  Refuser  ] [  Autoriser  ]  │ │  ← Autoriser = bleu plein
│ │       Ouvrir dans VS Code      │ │  ← lien discret
│ └────────────────────────────────┘ │
│ En cours                           │
│ (••) Polish · Watch Videos      ◔  │  ← anneau couleur de l'agent
│      Rendu des animations          │
│ (••) Breakdown reel             ◔  │
│      Lecture du transcript         │
└────────────────────────────────────┘
```

- **Bloc d'attention — permission** : mascotte (yeux ronds), titre, « Veut exécuter une commande » (ou « Veut modifier `fichier` » selon l'outil), commande en mono, puis **Refuser** / **Autoriser** (+ **Toujours autoriser** si `permission_suggestions` existe, en 3e bouton ou dans un menu `…`). Lien « Ouvrir dans VS Code » en dessous.
- **Bloc d'attention — question** : même bloc. Petit libellé `header` en `--text-3`, question 14 px semibold, options en liste (lignes `--fill-1`, rayon 8 px ; la sélection prend un fond bleu `--action` + coche), champ « Autre… » pour une réponse libre, puis **Envoyer** (bleu) et le lien « Répondre dans VS Code ».
- **Plusieurs agents en attente** : blocs empilés, le plus ancien en premier.
- **Après une réponse** : le bloc se replie, l'agent redescend dans « En cours » avec une coche verte qui s'efface en ~1.5 s (« Autorisé », « Réponse envoyée »).
- **Ligne « En cours »** : mascotte 20 px, titre + sous-titre, anneau de progression 20 px à droite (couleur de l'agent). Au survol : fond `--fill-1` et apparition des actions ↗ (ouvrir dans VS Code) et × (retirer). Clic sur la ligne : vue détail.
- **Vue détail** (remplace la liste, glissement latéral) : `‹ Agents` en haut à gauche, grande mascotte, titre, sous-titre, anneau + `5/7`. Liste d'étapes (✓ `--text-3` / spinner / cercle vide), icônes SF-style par type (terminal, crayon, loupe, globe). Bloc « Terminal » `--inset` avec la dernière commande et les 3 dernières lignes de sortie. En bas : bouton « Ouvrir dans VS Code ».
- **Agent terminé** : rangé dans une section repliée « Terminés (2) » en bas, avec un aperçu du dernier message au survol.

### 3.5 Mascottes (redessinées)
- **Forme** : rectangle très arrondi (rayon ≈ 1/3 de la largeur), deux petites jambes arrondies, **pas de bouche au repos**. Deux yeux en petites barres verticales arrondies. Couleur unie de l'agent. Pas de contour, pas d'ombre au sol.
- **Expressions** (SVG + CSS, uniquement les yeux et la posture) :
  - `working` : yeux-barres, léger flottement (±1.5 px, 2 s) ;
  - `needs_permission` / `asks_question` : **yeux ronds** + petite bouche, un petit saut toutes les ~4 s ;
  - `idle` : yeux mi-clos (barres aplaties), immobile ;
  - `done` : yeux en arc `^ ^`, un seul petit saut ;
  - `error` : yeux en `×`, couleur désaturée ;
  - `disconnected` : gris `--text-3`, immobile.
- Clignement des yeux aléatoire toutes les 3–6 s.
- **Icône de la barre des menus** : la même mascotte en version *template* monochrome (16 px de haut), avec ses yeux. Quand un agent t'attend, ses yeux deviennent ronds et le nombre s'affiche à côté (`tray.setTitle`, macOS).
- Référence de forme : `<symbol id="m">` et `<symbol id="m-alert">` dans `docs/design/directions-visuelles.html`.

### 3.6 Motion
- Ouverture du panneau : fondu + glissement de 6 px vers le bas, 180 ms, ease-out (comme un menu macOS).
- Dépliage d'un bloc d'attention : hauteur + opacité, 220 ms.
- Vue détail : glissement latéral, 250 ms.
- Respecter `prefers-reduced-motion` : plus de flottement, de saut ni de glissement (fondus seulement).

---

## 4. Architecture technique

### 4.1 Vue d'ensemble

```
┌────────────────────────┐   hooks HTTP (POST JSON)   ┌──────────────────────────────┐
│  Claude Code           │ ─────────────────────────▶ │  FollowMyAgents (app bureau) │
│  (sessions VS Code)    │ ◀───────────────────────── │  serveur local 127.0.0.1     │
│  ~/.claude/settings    │   réponse JSON (décision)  │  + fenêtre widget            │
└────────────────────────┘                            └──────────────────────────────┘
        │  transcript_path (JSONL)                               │
        └──────────────── lu en complément (fallback) ◀──────────┘
```

**Stack recommandée** : **Electron + React + TypeScript + Vite**. Le serveur HTTP tourne dans le process principal (Node) et l'UI dans le renderer. Electron fournit tout ce qu'il faut côté fenêtre : sans cadre, transparente, toujours au premier plan, icône de zone de notification, notifications natives, raccourcis globaux. (Alternative plus légère : Tauri 2, mais elle demande du Rust pour la partie serveur.)

### 4.2 Source de données : les hooks Claude Code

Nos hooks sont installés dans `~/.claude/settings.json` (au niveau utilisateur, donc actifs pour toutes les sessions). On utilise des **hooks de type `http`**, qui envoient l'entrée du hook en `POST` JSON vers notre serveur local. Si l'app ne tourne pas, la connexion échoue, ce qui donne une **erreur non bloquante** : Claude Code continue normalement. C'est un fallback gratuit.

Champs communs reçus par tous les hooks : `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name` (+ `agent_id`/`agent_type` pour les sous-agents, et `tool_name`/`tool_input`/`tool_use_id` pour les événements d'outil).

| Événement | Usage dans l'app | Bloquant ? |
|---|---|---|
| `SessionStart` | Crée la carte. `source` (`startup`/`resume`/…), `session_title` (optionnel) | non |
| `UserPromptSubmit` | `prompt` → titre de secours + état `working` | non |
| `PreToolUse` (tous outils) | Sous-titre = action en cours (ex. `tool_input.description` pour Bash, nom du fichier pour Read/Write/Edit) | non (répondre 200 vide immédiatement) |
| `PreToolUse` matcher `AskUserQuestion` | **Question dans le widget** (voir 4.4) | **oui** (attend la réponse de l'utilisateur) |
| `PermissionRequest` | **Permission dans le widget** (voir 4.3) | **oui** |
| `PostToolUse` | Fin d'étape. `tool_response` → sortie du bloc Terminal. Matcher `TaskCreate\|TaskUpdate\|TodoWrite` → mise à jour de la liste d'étapes | non |
| `TaskCreated` / `TaskCompleted` | `task_id`, `task_subject` → liste d'étapes et compteur `N/M` | non |
| `Notification` | `notification_type` (`permission_prompt`, `idle_prompt`, `agent_needs_input`, `agent_completed`…), `message` | non |
| `Stop` | Tour terminé → état `idle`. `last_assistant_message` → aperçu du résumé | non |
| `StopFailure` | État `error` | non |
| `SubagentStart` / `SubagentStop` | Sous-agents (voir améliorations) | non |
| `SessionEnd` | État `done` ou retrait automatique (configurable) | non |

Exemple de configuration (l'app l'**installe et la désinstalle elle-même**, avec sauvegarde du fichier) :

```json
{
  "hooks": {
    "PermissionRequest": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:47821/hook/permission",
                    "timeout": 600,
                    "headers": { "X-FMA-Token": "$FMA_TOKEN" }, "allowedEnvVars": ["FMA_TOKEN"] }] }
    ],
    "PreToolUse": [
      { "matcher": "AskUserQuestion",
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:47821/hook/question", "timeout": 600,
                    "headers": { "X-FMA-Token": "$FMA_TOKEN" }, "allowedEnvVars": ["FMA_TOKEN"] }] },
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:47821/hook/event", "timeout": 5,
                    "headers": { "X-FMA-Token": "$FMA_TOKEN" }, "allowedEnvVars": ["FMA_TOKEN"] }] }
    ]
    // … idem /hook/event pour SessionStart, UserPromptSubmit, PostToolUse, TaskCreated,
    //    TaskCompleted, Notification, Stop, StopFailure, SubagentStart, SubagentStop, SessionEnd
  }
}
```

> ⚠️ **Token** : par défaut, l'installeur écrit le token **en dur** dans l'en-tête (`"X-FMA-Token": "<token>"`, sans `allowedEnvVars`). Une variable d'environnement est peu fiable : sur macOS, VS Code lancé depuis le Dock n'hérite pas des variables du shell. `~/.claude/settings.json` est un fichier privé de l'utilisateur, donc c'est acceptable. L'exemple ci-dessus avec `$FMA_TOKEN` reste une option avancée. La doc officielle : https://code.claude.com/docs/en/hooks

### 4.3 Autoriser / refuser une permission depuis le widget

1. Le hook `PermissionRequest` arrive avec `tool_name`, `tool_input` et éventuellement `permission_suggestions`.
2. Le serveur **garde la requête HTTP ouverte**, passe la carte en `needs_permission` et affiche la commande (`tool_name: résumé de tool_input`).
3. Selon le clic, le serveur répond :
   - **Allow** :
     ```json
     { "hookSpecificOutput": { "hookEventName": "PermissionRequest",
       "decision": { "behavior": "allow" } } }
     ```
   - **Deny** : `"decision": { "behavior": "deny", "message": "Refusé depuis FollowMyAgents" }`
   - **Always allow** (amélioration, voir §6) : `"behavior": "allow", "updatedPermissions": [<entrée tirée de permission_suggestions>]`
   - **In VS Code** : réponse **200 sans corps**. Aucune décision n'est prise, donc Claude Code affiche son dialogue habituel. On met aussi VS Code au premier plan sur l'onglet (voir 4.5).
4. **Timeout** : si l'utilisateur ne fait rien pendant N secondes (réglable, 120 s par défaut, inférieur au `timeout` du hook), le serveur répond 200 vide et on retombe sur le dialogue VS Code.

> ⚠️ **À valider en premier (Phase 0)** : pendant que notre hook attend, est-ce que VS Code affiche déjà son propre dialogue de permission, ou seulement après la réponse du hook ? Si les deux coexistent et que l'utilisateur répond dans VS Code, il faut détecter la reprise (événement `PostToolUse`/`PreToolUse` suivant sur cette session) et **fermer automatiquement** la demande dans le widget.

### 4.4 Répondre à une question (AskUserQuestion) depuis le widget

Mécanisme documenté officiellement : un hook `PreToolUse` sur `AskUserQuestion` lit `tool_input.questions`, recueille la réponse dans notre UI, puis renvoie `allow` avec un `updatedInput` qui reprend `questions` tel quel et ajoute `answers` :

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "questions": [ /* tableau d'origine, inchangé */ ],
      "answers": { "Which hook should I use?": "The pain one" }
} } }
```

- `answers` associe le **texte de la question** au **label de l'option** choisie. Pour un `multiSelect`, les labels sont joints par des virgules.
- Une invocation peut contenir **plusieurs questions** (jusqu'à 4) : on les affiche les unes sous les autres, et Send n'est actif que quand toutes ont une réponse.
- Chip = `question.header` ; options = `options[].label`, avec `description` en texte secondaire.
- **Type in VS Code** : réponse 200 vide, donc la question s'affiche normalement dans VS Code, qu'on met au premier plan.
- Renvoyer `"allow"` **sans** `updatedInput` ne suffit pas (c'est précisé dans la doc).

### 4.5 « Jump » vers l'onglet VS Code (bouton ↗)

L'extension Claude Code de VS Code expose un URI documenté :

```
vscode://anthropic.claude-code/open?session=<session_id>
```

Si la session est déjà ouverte dans un onglet, **cet onglet passe au premier plan**. Sinon, la session est reprise. Dans Electron, `shell.openExternal(uri)` fonctionne sur les deux plateformes (équivalent de `open` sur macOS et de `Start-Process` sur Windows).

Limite : l'URI s'ouvre dans la fenêtre VS Code **active**. Avec plusieurs fenêtres, il faut d'abord mettre au premier plan la bonne, en lançant `code "<cwd de la session>"` (qui réutilise la fenêtre déjà ouverte sur ce dossier), puis ouvrir l'URI après ~300 ms. Sur macOS, la commande `code` n'est dans le PATH qu'après « Shell Command: Install 'code' command in PATH ». À défaut, utiliser `open -a "Visual Studio Code" "<cwd>"`. Ne pas supposer non plus que le PATH du shell est disponible : une app lancée depuis le Finder ne l'a pas, donc chercher `code` dans `/usr/local/bin` et `/opt/homebrew/bin`.

### 4.6 Modèle de données (côté app)

```ts
type AgentState =
  | "working" | "needs_permission" | "asks_question"
  | "idle" | "done" | "error" | "disconnected";

interface Session {
  id: string;                 // session_id
  cwd: string;
  transcriptPath: string;
  title: string;              // session_title, sinon dérivé du 1er prompt (≤ 40 car.)
  subtitle: string;           // action en cours, lisible par un humain
  color: AgentColor;          // attribuée à la création, stable
  state: AgentState;
  steps: Step[];              // issues de TaskCreate/TaskUpdate/TodoWrite
  lastCommand?: { command: string; outputTail: string[]; running: boolean };
  pending?: PendingPermission | PendingQuestion;  // + la réponse HTTP en attente
  startedAt: number;
  lastEventAt: number;        // → passage en "disconnected" après 10 min sans événement
  flash?: { text: string; until: number };       // "Allowed ✓", 'Using "…"'
  dismissed: boolean;
}

interface Step {
  id: string; label: string;
  status: "pending" | "in_progress" | "completed";
  kind: "command" | "write" | "read" | "web" | "other";
}
```

- **Progression** : `completed / total` des étapes. S'il n'y a aucune étape, pas de barre : on affiche un indicateur d'activité discret et le temps écoulé.
- **Libellé à côté de `N/M`** : texte court de l'étape en cours.
- **Lecture du transcript** (`transcript_path`, JSONL) : seulement en **complément**, pour reconstruire l'état d'une session déjà en cours quand l'app démarre après elle (scanner les `~/.claude/projects/**/*.jsonl` modifiés il y a moins de 30 min).

### 4.7 Fenêtre et comportement (icône de barre des menus + panneau qui reste ouvert)

**Comportement validé** :

| Situation | Ce qui se passe |
|---|---|
| Au repos | Aucune fenêtre. Seulement la mascotte dans la **barre des menus** (macOS) / la **zone de notification** (Windows). |
| Un agent attend une réponse | Le nombre d'agents en attente s'affiche à côté de l'icône (orange si possible), et le panneau **s'ouvre tout seul** sous l'icône, **sans voler le focus** (`showInactive()`). |
| Réponse donnée dans le panneau | S'il avait été ouvert automatiquement et qu'il ne reste rien en attente, le panneau **se referme**. S'il avait été ouvert par un clic, **il reste ouvert**. |
| Clic sur l'icône | Le panneau s'ouvre et **reste ouvert** (comme un panneau flottant permanent). Il ne se ferme **pas** quand on clique ailleurs et reste au-dessus des autres fenêtres. |
| Nouveau clic sur l'icône / raccourci global / `Échap` dans le panneau | Le panneau se ferme. |
| Bouton « détacher » dans l'en-tête | Le panneau se décroche de l'icône et devient déplaçable n'importe où ; la position est mémorisée. Le bouton « rattacher » le ramène sous l'icône. |

**Implémentation Electron** :
- `Tray` avec une image *template* (macOS) ou `.ico` (Windows). Le panneau est positionné sous l'icône avec `tray.getBounds()` (au-dessus sur Windows, quand la barre des tâches est en bas).
- `BrowserWindow` : `frame: false`, `resizable: false`, `skipTaskbar: true`, `alwaysOnTop: true`, `show: false`, hauteur ajustée au contenu ; **pas** de masquage sur `blur`.
- **Verre natif** : il est fourni par le système, pas par le CSS. `backdrop-filter` ne floute pas le bureau derrière une fenêtre transparente.
  - macOS : `vibrancy: "popover"` (ou `"hud"`, à comparer) + `visualEffectState: "active"` + `transparent: true`. Le CSS ajoute seulement `--panel-tint` et la bordure 0.5 px.
  - Windows 11 : `backgroundMaterial: "acrylic"` (vérifier la version d'Electron requise et le rendu avec `frame: false`). Si le rendu n'est pas bon, utiliser le fond opaque `--panel-fallback`.
- macOS : `app.dock.hide()`, `setAlwaysOnTop(true, "screen-saver")` + `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` pour rester visible par-dessus les apps en plein écran et en changeant d'espace.
- Le panneau peut **recevoir des clics sans activer l'app** quand c'est possible (macOS : `type: "panel"`, à tester), pour ne pas sortir l'utilisateur de son éditeur.

### 4.8 Différences macOS / Windows

| Sujet | macOS | Windows |
|---|---|---|
| Fichier de config Claude Code | `~/.claude/settings.json` | `%USERPROFILE%\.claude\settings.json` (utiliser `os.homedir()`) |
| Icône système | Barre des menus (`Tray` avec une image *template* monochrome, adaptée au mode clair/sombre) | Zone de notification (`Tray` avec une icône `.ico` en couleur) |
| Présence dans le Dock / la barre des tâches | `app.dock.hide()` : l'app vit uniquement dans la barre des menus | `skipTaskbar: true` |
| Au-dessus des apps plein écran | `setAlwaysOnTop(true, "screen-saver")` + `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, sinon le widget disparaît en changeant d'espace | `setAlwaysOnTop(true, "floating")` suffit |
| Position du panneau | Sous l'icône de la barre des menus (`tray.getBounds()`) ; position libre une fois détaché | Au-dessus de l'icône de la zone de notification (barre des tâches en bas) ; position libre une fois détaché |
| Verre flouté (obligatoire, §4.7) | `vibrancy: "popover"` ou `"hud"` + `visualEffectState: "active"` | `backgroundMaterial: "acrylic"`, sinon fond opaque `--panel-fallback` |
| Police système de secours | SF Pro (`-apple-system`) | Segoe UI Variable |
| Notifications natives | Demander l'autorisation au premier lancement. Une app non signée peut ne pas apparaître dans Réglages > Notifications : tester | Fonctionne directement (définir `app.setAppUserModelId`) |
| Raccourci global | `Cmd+Option+A` | `Ctrl+Alt+A` (via `CommandOrControl+Alt+A`) |
| Lancement au démarrage | `app.setLoginItemSettings({ openAtLogin })` | Idem |
| Packaging | `.dmg` via electron-builder. Pour un usage perso, une build non signée suffit (clic droit > Ouvrir la 1re fois). Signature + notarisation seulement si distribution | `.exe` NSIS via electron-builder |

---

## 5. Périmètre MVP (v1)

1. Installation et désinstallation des hooks depuis l'app (avec sauvegarde de `settings.json` et fusion propre si d'autres hooks existent déjà).
2. Panneau flottant avec liste des sessions (F1–F4, F12).
3. Vue détail avec liste d'étapes et bloc Terminal (F5, F6).
4. Permissions Allow / Deny / In VS Code (F7, F8).
5. Questions avec options, Send / Type in VS Code (F9, F10).
6. Jump vers l'onglet VS Code (F11).
7. Mascottes SVG animées avec leurs expressions d'état.
8. Son à l'arrivée d'une demande d'attention, activable ou non via le bouton haut-parleur (préférence mémorisée).
9. Icône système (barre des menus macOS / zone de notification Windows) : afficher/masquer, réinstaller les hooks, quitter.
10. Builds **macOS et Windows** fonctionnelles (voir §4.8).

---

## 6. Améliorations proposées (à ajouter au brief)

### Priorité haute (à inclure dans la v1 si possible)
- **🔒 Sécurité du serveur local** *(indispensable)* : écouter **uniquement sur `127.0.0.1`** et exiger un **token aléatoire** en en-tête (`X-FMA-Token`). Sinon, n'importe quel process local pourrait approuver des commandes Bash. Rejeter toute requête sans token valide.
- **« Always allow »** : 4e bouton sur une permission, quand `permission_suggestions` est présent. Il renvoie `updatedPermissions`, ce qui évite de revalider la même commande à chaque fois.
- **Réponse libre** : en plus des options, un champ « Autre… » dans le widget pour répondre en texte libre sans ouvrir VS Code (la réponse libre passe dans `answers`, à valider).
- **Questions multiples et multiSelect** gérées proprement (cases à cocher en multiSelect).
- **Notifications natives** (macOS et Windows) quand une session demande l'attention et que le panneau est masqué ou réduit. Un clic sur la notification ouvre la carte concernée.
- **Raccourcis clavier** : raccourci global `Cmd+Option+A` (macOS) / `Ctrl+Alt+A` (Windows) pour afficher le panneau et focaliser la première demande en attente. Sur une carte en attente : `Entrée` = Allow, `Échap` = Deny, `1`–`4` = choix d'une option.
- **Badge d'attention** : le nombre de sessions qui t'attendent s'affiche à côté de l'icône système (macOS : `tray.setTitle`, en orange si possible ; Windows : petite pastille orange dessinée sur l'icône).

### Priorité moyenne (v1.1)
- **Icône de barre des menus animée** : la mascotte de l'icône reflète l'état global (yeux qui bougent si des agents travaillent, yeux ronds si quelqu'un t'attend).
- **Chronomètres** : durée de la session et **temps passé à attendre l'utilisateur** (fait ressortir les agents bloqués depuis longtemps).
- **Fin de tour lisible** : à l'état `idle`, aperçu de `last_assistant_message` (2 lignes) dans la carte, et en entier dans la vue détail.
- **Sous-agents** : sous la carte parent, une rangée de mini-mascottes pour chaque sous-agent actif (`SubagentStart`/`SubagentStop`).
- **Titre de session intelligent** : si `session_title` est absent, générer un titre court au format « Verbe · Objet » (comme « Polish · Watch Videos ») à partir du premier prompt, via un appel à `claude-haiku-5-5`. Option désactivable, sinon troncature simple.
- **Retrait auto** des sessions `done` après N minutes (réglable), et regroupement par dossier de projet (`cwd`).

### Plus tard (v2)
- Sessions Claude Code lancées en **terminal** (CLI) en plus de VS Code : le jump utiliserait le lien profond `claude-cli://` ou mettrait au premier plan la fenêtre du terminal.
- Historique des sessions du jour (durée, nombre de permissions, résultat).
- Thème clair et choix de la couleur d'accent.
- Version Linux.

---

## 7. Plan de réalisation

**Phase 0 — Validation technique (à faire en premier, ~½ journée)**
Script Node minimal : un serveur HTTP + les hooks `PermissionRequest` et `PreToolUse:AskUserQuestion` + des logs. Vérifier dans une vraie session VS Code :
- (a) la réponse `allow`/`deny` est bien appliquée ;
- (b) le comportement du dialogue VS Code pendant que le hook attend (voir l'alerte en 4.3) ;
- (c) `updatedInput.answers` répond bien à la question ;
- (d) `vscode://anthropic.claude-code/open?session=…` met bien l'onglet au premier plan ;
- (e) le contenu réel de `tool_input` pour `TaskCreate`/`TaskUpdate`/`TodoWrite` dans la version installée.

Documenter les résultats dans `docs/phase0.md` et ajuster le design si (b) pose problème.

**Phase 1** — App Electron, serveur, store d'état, installeur de hooks, liste des cartes (sans interactions).
**Phase 2** — Permissions et questions (requêtes HTTP en attente, timeouts, flash de confirmation).
**Phase 3** — Vue détail, jump VS Code, mascottes animées, son, verre natif, comportement complet de l'icône (ouverture auto, panneau qui reste ouvert, détacher).
**Phase 4** — Améliorations haute priorité du §6, packaging macOS (`.dmg`) et Windows (`.exe`), lancement au démarrage optionnel.

Développer et tester sur le Mac en priorité (poste de travail principal), en vérifiant chaque phase aussi sous Windows. Les tests de la Phase 0 sont à faire **sur les deux plateformes**.

---

## 8. Critères d'acceptation

- [ ] Avec 4 sessions Claude Code ouvertes dans VS Code et VS Code réduit, le panneau affiche 4 cartes à jour en moins d'1 s après chaque action d'un agent.
- [ ] Une permission Bash peut être **acceptée** et **refusée** depuis le widget, et l'agent continue (ou s'arrête) sans qu'on ouvre VS Code.
- [ ] Une question AskUserQuestion à options reçoit sa réponse depuis le widget, et l'agent continue avec la bonne option.
- [ ] « In VS Code » / « Type in VS Code » fait apparaître le dialogue normal dans VS Code et met le bon onglet au premier plan.
- [ ] Le bouton ↗ met au premier plan l'onglet de la bonne session, y compris avec 2 fenêtres VS Code ouvertes sur des dossiers différents.
- [ ] Si l'app est fermée, Claude Code fonctionne exactement comme sans elle (aucun blocage, aucune erreur visible gênante).
- [ ] Une requête vers le serveur sans token valide est rejetée (401).
- [ ] La désinstallation des hooks restaure `settings.json` sans toucher aux autres hooks de l'utilisateur.
- [ ] Le panneau ne vole jamais le focus clavier à l'application active.
- [ ] Les animations sont désactivées avec `prefers-reduced-motion`.
- [ ] Au repos, aucune fenêtre n'est visible, seulement l'icône. Quand un agent attend, le panneau s'ouvre seul sans voler le focus, puis se referme après la réponse (sauf s'il avait été ouvert par un clic).
- [ ] Ouvert par un clic sur l'icône, le panneau reste affiché quand on clique ailleurs et ne se ferme qu'au clic suivant sur l'icône (ou via le raccourci / `Échap`).
- [ ] Le fond du panneau est le verre natif du système (le bureau est flouté derrière), sans couleur fluo nulle part.
- [ ] Sur macOS, le widget reste visible quand on change d'espace (bureau virtuel) et par-dessus une app en plein écran.
- [ ] Tous les critères ci-dessus sont validés **sur macOS et sur Windows**.

---

## 9. Références visuelles

**Notre design** ([docs/design/](docs/design/)) : maquettes HTML validées. Ce sont des fragments, avec styles et SVG des mascottes intégrés : à lire comme du code ou à ouvrir dans un navigateur.
- `directions-visuelles.html` : trois directions explorées, **la A (« Verre macOS ») est retenue**.
- `comportement-panneau.html` : icône dans la barre des menus + panneau (comportement final : voir §4.7).

**Captures de la vidéo d'origine** ([docs/reference/](docs/reference/)) : seulement pour les fonctionnalités, pas pour le style.

| Fichier | Contenu |
|---|---|
| `01-probleme-agents-inconnus.jpg` | Le problème : mascottes grises avec des « ? » |
| `02-logo-app.jpg` | Logo de l'app d'origine (inspiration seulement) |
| `03-placement-coin-ecran.jpg` | Placement en haut à droite du bureau |
| `04-liste-agents.jpg` | **Vue principale** : 4 cartes |
| `05-carte-hover.jpg` | Survol d'une carte (bordure lime) |
| `06-vue-detail-agent.jpg` | **Vue détail** : étapes + Terminal |
| `07-permission-demandee.jpg` | **Permission** : Allow / Deny / In VS Code |
| `08-permission-acceptee.jpg` | Confirmation « Allowed ✓ » |
| `09-question-transition.jpg` | Dépliage d'une question, cartes voisines estompées |
| `10-question-agent.jpg` | **Question** : chip, options, Send / Type in VS Code |
| `11-question-repondue.jpg` | Confirmation « Using "The pain one" » + VS Code non ouvert |
| `12-hover-bouton-jump.jpg` | Survol du bouton ↗ |
| `13-jump-onglet-vscode.jpg` | Résultat du jump : onglet de la session au premier plan dans VS Code |
| `14-session-fermee.jpg` | Carte retirée après × |
