import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTranscriptInfo, scanRecentTranscripts } from "../src/main/transcripts";

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "fma-tr-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const line = (o: unknown) => JSON.stringify(o) + "\n";
function transcript(file: string, entries: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map(line).join("") + "{truncated");
}

describe("readTranscriptInfo", () => {
  it("lit le titre (custom-title > ai-title), le cwd, le dernier prompt et le dernier outil sans résultat", () => {
    const f = path.join(dir, "p", "abc.jsonl");
    transcript(f, [
      { type: "last-prompt", lastPrompt: "fais le rendu", sessionId: "abc" },
      { type: "ai-title", aiTitle: "Rendu des vidéos", sessionId: "abc" },
      { type: "user", cwd: "C:\\work\\p", sessionId: "abc", message: { role: "user", content: "go" } },
      { type: "assistant", cwd: "C:\\work\\p", message: { content: [{ type: "text", text: "Je lance." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test" } }] } },
    ]);
    const i = readTranscriptInfo(f);
    expect(i).toMatchObject({ sessionId: "abc", cwd: "C:\\work\\p", title: "Rendu des vidéos", lastPrompt: "fais le rendu", lastAssistantText: "Je lance." });
    expect(i.openToolUse).toEqual({ name: "Bash", input: { command: "npm test" } });
    fs.appendFileSync(f, "\n" + line({ type: "custom-title", customTitle: "Mon titre" }));
    expect(readTranscriptInfo(f).title).toBe("Mon titre");
  });

  it("pas d'outil ouvert si le dernier tool_use a son résultat", () => {
    const f = path.join(dir, "p", "x.jsonl");
    transcript(f, [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } },
    ]);
    expect(readTranscriptInfo(f).openToolUse).toBeUndefined();
  });

  it("fichier absent → objet vide", () => {
    expect(readTranscriptInfo(path.join(dir, "nope.jsonl"))).toEqual({});
  });
});

describe("scanRecentTranscripts", () => {
  it("ne garde que les transcripts principaux récents", () => {
    const now = Date.now();
    transcript(path.join(dir, "proj", "recent.jsonl"), [{ type: "user", cwd: "/w", sessionId: "recent" }]);
    transcript(path.join(dir, "proj", "old.jsonl"), [{ type: "user", cwd: "/w", sessionId: "old" }]);
    const old = (now - 60 * 60_000) / 1000;
    fs.utimesSync(path.join(dir, "proj", "old.jsonl"), old, old);
    // transcript de sous-agent (sous-dossier) : ignoré
    transcript(path.join(dir, "proj", "recent", "subagents", "agent-1.jsonl"), [{ type: "user", cwd: "/w", sessionId: "recent" }]);
    const r = scanRecentTranscripts(dir, 30 * 60_000, now);
    expect(r.map((x) => x.info.sessionId)).toEqual(["recent"]);
  });

  it("dossier inexistant → liste vide", () => {
    expect(scanRecentTranscripts(path.join(dir, "missing"))).toEqual([]);
  });
});
