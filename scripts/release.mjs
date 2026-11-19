// Publie une nouvelle version : met à jour la version, commite, tague et pousse.
// GitHub Actions (.github/workflows/release.yml) construit alors Mac + Windows et
// crée la Release ; les apps installées proposent la mise à jour.
//
// Usage : npm run release -- 0.3.0      (ou patch | minor | major)
import { execSync } from "node:child_process";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage : npm run release -- <version|patch|minor|major>");
  process.exit(2);
}
const sh = (c) => execSync(c, { stdio: "inherit" });
if (execSync("git status --porcelain").toString().trim()) {
  console.error("Le dépôt a des modifications non commitées : commitez-les d'abord.");
  process.exit(1);
}
sh("npm test");
sh(`npm version ${arg} -m "release: v%s"`);
sh("git push --follow-tags");
console.log("\nTag poussé. Suivez la construction dans l'onglet Actions du dépôt GitHub.");
