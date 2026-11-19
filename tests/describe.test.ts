import { describe, expect, it } from "vitest";
import {
  describePermission,
  describeTool,
  guessStepKind,
  messagePreview,
  outputTail,
  titleFromPrompt,
} from "../src/main/describe";

describe("describeTool", () => {
  it("décrit les outils courants en français", () => {
    expect(describeTool("Bash", { command: "ls", description: "Liste les fichiers" })).toBe("Liste les fichiers");
    expect(describeTool("Bash", { command: "ls -la" })).toBe("Exécute ls -la");
    expect(describeTool("Read", { file_path: "C:\\work\\p\\README.md" })).toBe("Lecture de README.md");
    expect(describeTool("Write", { file_path: "/a/b/c.ts" })).toBe("Écriture de c.ts");
    expect(describeTool("Grep", { pattern: "TODO" })).toBe("Recherche de « TODO »");
    expect(describeTool("WebFetch", { url: "https://code.claude.com/docs/en/hooks" })).toBe("Lecture de code.claude.com");
    expect(describeTool("mcp__github__create_issue", {})).toBe("github · create_issue");
    expect(describeTool("Unknown", {})).toBe("Unknown");
  });
  it("tronque les descriptions trop longues", () => {
    expect(describeTool("Bash", { description: "x".repeat(200) }).length).toBeLessThanOrEqual(60);
  });
});

describe("describePermission", () => {
  it("Bash → commande", () => {
    expect(describePermission("Bash", { command: "npx hyperframes render . -o out.mp4" })).toEqual({
      headline: "Veut exécuter une commande",
      detail: "npx hyperframes render . -o out.mp4",
    });
  });
  it("Edit → nom du fichier", () => {
    expect(describePermission("Edit", { file_path: "/p/src/app.tsx" }).headline).toBe("Veut modifier app.tsx");
  });
  it("outil MCP", () => {
    expect(describePermission("mcp__slack__post", { text: "hi" })).toEqual({ headline: "Veut utiliser slack · post", detail: '{"text":"hi"}' });
  });
});

describe("titleFromPrompt", () => {
  it("nettoie et tronque à 40 caractères", () => {
    expect(titleFromPrompt("fix the bug")).toBe("Fix the bug");
    const t = titleFromPrompt("a".repeat(100));
    expect(t.length).toBe(40);
    expect(t.endsWith("…")).toBe(true);
    expect(titleFromPrompt("<ide_selection>long stuff</ide_selection> refactor auth")).toBe("Refactor auth");
    expect(titleFromPrompt("   ")).toBe("Nouvelle session");
  });
});

describe("outputTail", () => {
  it("garde les 3 dernières lignes non vides, sans codes ANSI", () => {
    expect(outputTail({ stdout: "1\n2\n\x1b[32m3\x1b[0m\n4\n", stderr: "" })).toEqual(["2", "3", "4"]);
    expect(outputTail({ stdout: "", stderr: "boom" })).toEqual(["boom"]);
    expect(outputTail("a\r\nb")).toEqual(["a", "b"]);
    expect(outputTail(undefined)).toEqual([]);
  });
});

describe("divers", () => {
  it("guessStepKind", () => {
    expect(guessStepKind("Run the tests")).toBe("command");
    expect(guessStepKind("Write style-sheet.md")).toBe("write");
    expect(guessStepKind("Read final-cut-transcript.md")).toBe("read");
    expect(guessStepKind("Search the web for docs")).toBe("web");
    expect(guessStepKind("Think")).toBe("other");
  });
  it("messagePreview", () => {
    expect(messagePreview("## Résumé\n\nTout est **ok**")).toBe("Résumé");
    expect(messagePreview("")).toBe("");
  });
});
