# Avancement

## Fait
- Phase 0 : serveur de test, bac à sable, imitation de l'hôte VS Code, tests (a)(b-simulé)(c)(d-partiel)(e). Résultats dans `docs/phase0.md`, décisions D1–D7 dans `docs/DECISIONS.md`.

## En cours
- Phase 1 : squelette Electron + serveur + store + installeur + liste.

## Reste à faire
- Phase 2 : permissions et questions dans l'UI (requêtes en attente, timeouts, flash).
- Phase 3 : vue détail, jump VS Code, mascottes animées, son, verre natif, comportement de l'icône.
- Phase 4 : always allow, réponse libre, multiSelect, notifications, raccourcis, badge, packaging, lancement au démarrage.
- Captures d'écran Playwright + comparaison avec les maquettes.
- Vérification des critères §8, `docs/REVIEW.md`.

## Notes pour reprendre
- Binaire claude : `~/.vscode/extensions/anthropic.claude-code-2.1.322-win32-x64/resources/native-binary/claude.exe`.
- Bac à sable : `node scripts/make-sandbox.mjs` puis `bash scripts/sandbox-claude.sh "<prompt>" --model haiku`, ou `node phase0/sdk-host.mjs "<prompt>" <hostPolicy>` pour imiter VS Code (AskUserQuestion disponible).
- Ne jamais toucher à `~/.claude/settings.json`.
