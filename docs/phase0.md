# Phase 0 — Validation technique (résultats)

Date : 2026-11-19. Claude Code **2.1.322** (binaire de l'extension VS Code), **Windows 11**.

> ⚠️ La machine de développement est un PC **Windows 11**, pas le Mac annoncé dans les
> consignes. Tous les tests ci-dessous ont été faits sous Windows. Les tests macOS restent à
> faire (voir `docs/REVIEW.md`).

## Outillage

| Fichier | Rôle |
|---|---|
| `phase0/server.mjs` | Serveur HTTP minimal (127.0.0.1:47821). Journalise chaque hook dans `phase0/logs/events.jsonl` et répond selon `phase0/logs/policy.json` (allow, deny, réponse différée, réponse vide, maintien de la requête). Détecte la fermeture de la requête par Claude Code. |
| `phase0/sdk-host.mjs` | **Imitation de l'extension VS Code** : lance `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`, exactement le mode utilisé par l'extension, et joue le rôle du « dialogue VS Code » (`can_use_tool`). On peut le faire répondre après N ms ou jamais. |
| `scripts/make-sandbox.mjs` | Crée `./sandbox` (dépôt git indépendant) avec ses hooks dans `sandbox/.claude/settings.local.json`. **Aucune config globale n'est touchée.** |
| `scripts/sandbox-claude.sh` | Lance `claude -p` dans le bac à sable, avec un environnement débarrassé des variables `CLAUDE*` de la session parente. |
| `phase0/show.py` | Résume le journal des hooks. |

## Résultats

### (a) allow / deny appliqués : ✅

- `PermissionRequest` → `{"decision":{"behavior":"allow"}}` : la commande Bash s'exécute (`out.txt` créé).
- `{"decision":{"behavior":"deny","message":…}}` : la commande n'est pas exécutée, l'agent reçoit le message et s'arrête proprement.
- Le hook reçoit `tool_name`, `tool_input` (`command`, `description`) et `permission_suggestions` (ex. `addRules` + `destination: localSettings`, ou `addDirectories`).

### (b) Dialogue de l'hôte pendant que le hook attend : ✅ simulé, 🟡 à confirmer visuellement dans VS Code

Test fait avec l'imitation de l'extension (même protocole que VS Code) :

| Scénario | Observé |
|---|---|
| b-1 : hook maintenu 20 s, l'hôte ne répond pas | Le dialogue de l'hôte (`can_use_tool`) arrive **immédiatement** (+0 s), **en parallèle** du hook. Une `Notification` `permission_prompt` est aussi émise. |
| b-2 : hook maintenu, l'hôte (VS Code) autorise à 4 s | La commande s'exécute. Claude Code **ferme la requête HTTP du hook** (détectée côté serveur : `close` avant réponse). |
| b-3 : le hook autorise à 4 s, l'hôte ne répond pas | Claude Code envoie `control_cancel_request` à l'hôte : **le dialogue de VS Code est annulé**. La commande s'exécute. |

**Conséquence pour le design** : les deux dialogues coexistent, le premier qui répond l'emporte.
- Réponse dans VS Code → la requête HTTP est fermée → l'app retire la demande du widget **immédiatement** (détection principale). En secours, un `PreToolUse`/`PostToolUse`/`Stop` suivant sur la même session retire aussi la demande.
- Réponse dans le widget → le dialogue VS Code est annulé par Claude Code (vu dans le protocole, **à vérifier à l'œil dans VS Code**).

### (c) Réponse à une question AskUserQuestion : ✅ (deux mécanismes)

En `claude -p` simple, AskUserQuestion n'est **pas disponible**. Avec l'imitation de l'extension, il l'est.

1. **Mécanisme du brief** (`PreToolUse` matcher `AskUserQuestion` + `updatedInput.answers`) : fonctionne (`ANSWER=Bleu`). **Mais** la question n'apparaît dans VS Code **qu'après** la réponse du hook : tant que le widget garde la question, VS Code ne montre rien.
2. **`PermissionRequest`** : un `PermissionRequest` est aussi émis pour `AskUserQuestion`, **en parallèle** de l'affichage de la question dans VS Code. Répondre `{"behavior":"allow","updatedInput":{questions, answers}}` répond à la question (`ANSWER=Rouge`) **et annule la question dans VS Code**. Testé en modes `default`, `auto`, `plan`, `acceptEdits` et `bypassPermissions` : OK. En `dontAsk`, AskUserQuestion est refusé d'office : pas de question.
3. **Réponse libre** (texte hors options, `"Violet"`) : acceptée telle quelle (`ANSWER=Violet`).

→ **Décision** : les questions passent par `PermissionRequest` (mécanisme 2). Le widget et VS Code affichent la question en même temps, sans délai côté VS Code. Le mécanisme 1 reste supporté par le serveur (route `/hook/question`) mais n'est pas installé par défaut. Voir `docs/DECISIONS.md` (D3).

### (d) `vscode://anthropic.claude-code/open?session=<id>` : ✅ en partie, 🟡 à confirmer

- Code de l'extension (2.1.322) : `handleUri` → `/open` → `claude-vscode.primaryEditor.open(session)` → `createPanel` : si un onglet affiche déjà la session, **`reveal()`** ; si elle est dans la barre latérale, elle y est affichée ; sinon, la session est rouverte dans un onglet.
- **Windows** : lancé depuis un processus en arrière-plan, l'URI est bien traité, mais **Windows bloque la mise au premier plan de VS Code** (protection anti-vol de focus). Parade testée et validée : `resources/scripts/focus-window.ps1`, qui trouve la fenêtre `Code.exe` dont le titre contient le nom du dossier (`EnumWindows`), simule ALT puis appelle `SetForegroundWindow` (~400 ms). VS Code passe alors au premier plan.
- Le changement d'onglet dans la bonne fenêtre, avec 2 fenêtres VS Code, reste à vérifier par un humain.

### (e) Contenu de `tool_input` des outils de liste d'étapes : ✅ TodoWrite, ⚠️ TaskCreate introuvable

- Dans cette version, **aucun outil de liste d'étapes n'est actif par défaut** en `-p` (ni `TodoWrite`, ni `TaskCreate`). L'extension VS Code lance d'ailleurs Claude Code avec `CLAUDE_CODE_ENABLE_TASKS=0`.
- Avec `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` : `TodoWrite` est disponible.
  ```json
  {"todos":[{"content":"Dire bonjour","status":"in_progress","activeForm":"Dire bonjour"},
            {"content":"Compter","status":"pending","activeForm":"Compter"}]}
  ```
  Chaque appel envoie la **liste complète** (remplacement, pas de delta).
- `CLAUDE_CODE_ENABLE_TASKS=1` n'a pas rendu `TaskCreate` disponible : format non observé. L'app gère `TaskCreate`/`TaskUpdate` (format déduit : `subject`, `taskId`, `status`) et les événements documentés `TaskCreated`/`TaskCompleted` (`task_id`, `task_subject`), sans garantie.
- Conséquence : **beaucoup de sessions n'auront pas de liste d'étapes**. Le principe « pas de fausse précision » (§3.1.4) s'applique : pas d'anneau, seulement un indicateur d'activité et le temps écoulé.

### Autres découvertes importantes

1. **`SessionStart` ne prend pas en charge les hooks HTTP** (« HTTP hooks are not supported for SessionStart », dans le journal de debug). → hook `command` qui relaie l'entrée via `curl`.
2. **App fermée** : les échecs HTTP de `UserPromptSubmit`, `PreToolUse`, `PostToolUse` et `PermissionRequest` sont silencieux. Mais un échec sur `Stop` affiche « **Stop hook error occurred** », et `SessionEnd` écrit `failed: connect ECONNREFUSED`. → Les événements rares ou de fin (`SessionStart`, `Stop`, `SubagentStart/Stop`, `SessionEnd`, `StopFailure`, `Notification`, `TaskCreated/Completed`) passent par un hook `command` : `curl … ; exit 0`, toujours silencieux. **Vérifié : avec l'app fermée, aucune erreur et aucune notification.**
3. Les deux hooks `PreToolUse` (matcher spécifique + générique) sont appelés pour le même outil : la route d'événement ne doit pas écraser un état d'attente.
4. Les sessions `-p` traitent le dossier comme « de confiance ». En session interactive, les hooks ne s'exécutent qu'après acceptation de la confiance du dossier.
5. Le token passé en en-tête est masqué (`[REDACTED]`) dans les journaux de debug de Claude Code.
6. Champs supplémentaires observés : `prompt_id`, `effort.level`, `permission_mode` ; `Stop` porte `last_assistant_message`, `background_tasks`, `session_crons`.

## Journaux bruts

`phase0/logs/` (non versionné) : `a-allow.jsonl`, `a-deny.jsonl`, `b1…b3-*.jsonl`, `q1…q3-*.jsonl`, `q-mode-*.jsonl`, `e-*.jsonl`.
