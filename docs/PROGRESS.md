# Avancement

## Fait
- **Phase 0** : outillage + résultats (`docs/phase0.md`), décisions D1–D7.
- **Phase 1** : app Electron (electron-vite + React 19 + TS), serveur de hooks, store, installeur + CLI, liste.
- **Phase 2** : permissions (Autoriser / Refuser / Toujours autoriser / Ouvrir dans VS Code), questions (options, multiSelect, plusieurs questions, « Autre… »), timeouts, flash, détection « répondu dans VS Code ».
- **Phase 3** : vue détail, jump VS Code (script PowerShell Windows / `code` macOS), mascottes animées, son, verre natif (acrylique vérifié), icône système (ouverture auto sans focus, reste ouvert après un clic, détacher).
- **Phase 4 (en partie)** : notifications (après 30 s sans réponse), raccourcis (global + Entrée/Échap/1–9), badge, lancement au démarrage.
- Tests : 74 tests unitaires (Vitest), `e2e/run.mjs` (20 vérifications + captures), `e2e/native.mjs` (3 vérifications Windows : verre réel, focus, vrai clic), `e2e/live.mjs` (5 vérifications avec de vraies sessions Claude Code).

## En cours
- Tests transcripts, détacher / raccourci global en natif, packaging.

## Reste à faire
- Packaging Windows (NSIS), config macOS (dmg à construire sur un Mac).
- `docs/REVIEW.md`, vérification des critères §8.

## Notes pour reprendre
- Binaire claude : `~/.vscode/extensions/anthropic.claude-code-2.1.322-win32-x64/resources/native-binary/claude.exe`.
- **Lancer Electron depuis le terminal de VS Code : retirer `ELECTRON_RUN_AS_NODE`** (`env -u ELECTRON_RUN_AS_NODE …`), sinon Electron se comporte comme Node.
- Bac à sable : `node scripts/make-sandbox.mjs`, puis `node phase0/sdk-host.mjs "<prompt>" <hostPolicy>`.
- Ne jamais toucher à `~/.claude/settings.json`. Les tests utilisent `FMA_USER_DATA` / `FMA_CLAUDE_SETTINGS` (fichiers temporaires).
