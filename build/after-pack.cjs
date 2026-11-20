// Signature macOS STABLE (D29) : signe l'app avec un certificat auto-signé fixe,
// pour que macOS garde les autorisations (Accessibilité, Automatisation, trousseau)
// d'une version à l'autre. Sans certificat, chaque build a une signature ad hoc
// différente et macOS « oublie » les autorisations à chaque mise à jour.
//
// Appelé par electron-builder après l'assemblage de l'app (afterPack). Pour une
// build universelle, il est appelé pour chaque architecture puis pour l'app
// combinée : on ne signe que l'app combinée (ou une build mono-architecture).
// Actif seulement si MAC_SIGN_IDENTITY est défini (CI : secrets MAC_CERT_*).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const identity = process.env.MAC_SIGN_IDENTITY;
  if (!identity) {
    console.log("  • signature stable : MAC_SIGN_IDENTITY absent, app laissée telle quelle (ad hoc)");
    return;
  }
  const { Arch } = require("builder-util");
  const archName = Arch[ctx.arch];
  const universalBuild = ctx.packager.platformSpecificBuildOptions?.target?.some?.((t) => (t.arch || []).includes("universal"));
  if (universalBuild && archName !== "universal") {
    console.log(`  • signature stable : ${archName} intermédiaire, signée après fusion universelle`);
    return;
  }
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  console.log(`  • signature stable : ${app} avec « ${identity} »`);
  const run = (args) => execFileSync("codesign", args, { stdio: "inherit" });
  run(["--force", "--deep", "--sign", identity, app]);
  run(["--verify", "--deep", "--strict", "--verbose=2", app]);
  // exigence désignée : doit citer le certificat (pas un cdhash) pour rester stable
  run(["-d", "-r-", app]);
};
