# Avancement

## Fait (toutes les phases 0 à 4)
- **Phase 0** : outillage + résultats (`docs/phase0.md`).
- **Phase 1** : app Electron (electron-vite + React 19 + TS), serveur de hooks, store, installeur + CLI, liste.
- **Phase 2** : permissions (Autoriser / Refuser / Toujours autoriser / Ouvrir dans VS Code), questions (options, multiSelect, plusieurs questions, « Autre… »), timeouts, flash, détection « répondu dans VS Code ».
- **Phase 3** : vue détail, jump VS Code, mascottes animées, son, verre natif (acrylique vérifié sous Windows), icône système (ouverture auto sans focus, reste ouvert après un clic, détacher).
- **Phase 4** : notifications, raccourcis, badge, lancement au démarrage, installeur Windows NSIS (construit et testé), config dmg.
- Tests : 79 unitaires, 20 e2e, 5 natifs Windows, 6 en conditions réelles (vraies sessions Claude Code).
- Rapport final : `docs/REVIEW.md`. Décisions : `docs/DECISIONS.md` (D1–D17).

## Reste à faire (humain)
- Tests manuels de `docs/REVIEW.md` §3 (dont le test (b) dans le vrai VS Code et l'installation des vrais hooks).
- Tout macOS (pas de Mac disponible).

## Notes pour reprendre
- Binaire claude : `~/.vscode/extensions/anthropic.claude-code-2.1.322-win32-x64/resources/native-binary/claude.exe`.
- **Lancer Electron depuis le terminal de VS Code : retirer `ELECTRON_RUN_AS_NODE`** (`npm start` / `npm run dev` le font).
- Bac à sable : `node scripts/make-sandbox.mjs`, puis `node phase0/sdk-host.mjs "<prompt>" <hostPolicy>`.
- Ne jamais toucher à `~/.claude/settings.json` dans les tests (`FMA_USER_DATA`, `FMA_CLAUDE_SETTINGS`, `FMA_NO_JUMP`, `FMA_NO_TRANSCRIPTS`).
