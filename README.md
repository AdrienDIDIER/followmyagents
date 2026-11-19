# FollowMyAgents

Widget de bureau qui montre en temps réel ce que fait chaque session Claude Code (extension VS Code). Il permet d'**autoriser une permission** ou de **répondre à une question** d'un agent sans ouvrir VS Code.

- Icône dans la barre des menus (macOS) / la zone de notification (Windows).
- Le panneau s'ouvre tout seul quand un agent t'attend, sans voler le focus, et se referme après ta réponse.
- Un clic sur un agent ouvre sa vue détail (étapes, dernière commande). ↗ ramène sur le bon onglet VS Code.

## Démarrer

```bash
npm install
npm run build
npm start              # lance l'app (icône système)
```

Puis clic droit sur l'icône → **Installer les hooks…**. Ou en ligne de commande :

```bash
npm run hooks -- status    --user    # état des hooks dans ~/.claude/settings.json
npm run hooks -- install   --user    # installe (sauvegarde horodatée à côté)
npm run hooks -- uninstall --user    # retire uniquement les hooks FollowMyAgents
npm run hooks -- install --settings /chemin/vers/settings.json   # autre fichier
```

## Tests

```bash
npm test               # tests unitaires (serveur, store, installeur, transcripts…)
npm run e2e            # app Electron pilotée par Playwright + captures (docs/screenshots)
npm run e2e:native     # Windows : verre réel, focus, vrai clic, raccourci, détacher
npm run e2e:live       # vraies sessions Claude Code dans ./sandbox (modèle haiku)
```

## Packaging

```bash
npm run dist:win       # release/FollowMyAgents Setup x.y.z.exe (NSIS)
npm run dist:mac       # release/*.dmg — à lancer sur un Mac
```

## Publier une nouvelle version (mise à jour automatique)

```bash
npm run release -- patch      # ou minor, major, ou un numéro : 0.3.0
```

Le script lance les tests, met à jour la version, crée le tag `vX.Y.Z` et pousse.
GitHub Actions construit alors l'app Mac (`.dmg` + `.zip` universels) et Windows (`.exe`), puis publie la Release avec ses empreintes SHA-256.
Les apps installées le détectent (au démarrage puis toutes les 6 h) et proposent « Installer et redémarrer ».

## Documentation

- `BRIEF.md` : le brief produit.
- `docs/phase0.md` : validation technique des hooks (résultats).
- `docs/DECISIONS.md` : décisions d'implémentation.
- `docs/REVIEW.md` : rapport de fin de travail et tests manuels.
