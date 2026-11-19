import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contains, readIdeWindows, titleCandidates, windowFor } from "../src/main/ide";

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "fma-ide-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("readIdeWindows", () => {
  it("lit les fichiers .lock des fenêtres vivantes et ignore les autres", () => {
    fs.writeFileSync(path.join(dir, "1.lock"), JSON.stringify({ pid: 111, workspaceFolders: ["/w/a"], ideName: "Visual Studio Code", authToken: "x" }));
    fs.writeFileSync(path.join(dir, "2.lock"), JSON.stringify({ pid: 222, workspaceFolders: ["/w/b"] }));
    fs.writeFileSync(path.join(dir, "3.lock"), "{pas du json");
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    const w = readIdeWindows(dir, (pid) => pid === 111);
    expect(w).toEqual([{ pid: 111, workspaceFolders: ["/w/a"], ideName: "Visual Studio Code" }]);
  });
  it("dossier absent → []", () => {
    expect(readIdeWindows(path.join(dir, "nope"))).toEqual([]);
  });
});

describe("windowFor / titleCandidates", () => {
  const wins = [
    { pid: 1, workspaceFolders: ["/Users/me/work"] },
    { pid: 2, workspaceFolders: ["/Users/me/work/mono", "/Users/me/libs/ui"] },
  ];
  it("choisit le dossier le plus précis qui contient le cwd", () => {
    expect(windowFor("/Users/me/work/mono/api", wins, "darwin")?.root).toBe("/Users/me/work/mono");
    expect(windowFor("/Users/me/work/other", wins, "darwin")?.root).toBe("/Users/me/work");
    expect(windowFor("/tmp/x", wins, "darwin")).toBeUndefined();
  });
  it("ne confond pas un préfixe de nom avec un dossier parent", () => {
    expect(contains("/Users/me/work/mono", "/Users/me/work/monorepo", "darwin")).toBe(false);
  });
  it("Windows : insensible à la casse et aux séparateurs", () => {
    expect(contains(String.raw`c:\Users\Me\Work`, "C:/users/me/work/x", "win32")).toBe(true);
  });
  it("noms candidats : racine de la fenêtre, puis dossier de la session, puis parents", () => {
    expect(titleCandidates("/Users/me/work/mono/packages/api", wins, "darwin")).toEqual({
      root: "/Users/me/work/mono",
      names: ["mono", "api", "packages", "work"],
    });
  });
});
