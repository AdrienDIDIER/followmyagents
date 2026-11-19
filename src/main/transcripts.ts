// Lecture des transcripts Claude Code (JSONL) en complément des hooks :
// - titre de la session (entrées "custom-title" / "ai-title" : le titre de
//   l'onglet VS Code) ;
// - reconstruction des sessions récentes au démarrage de l'app.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TAIL_BYTES = 512 * 1024;

export function projectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

function readTail(file: string, bytes = TAIL_BYTES): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    // la première ligne peut être coupée
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

export interface TranscriptInfo {
  sessionId?: string;
  cwd?: string;
  title?: string;
  lastPrompt?: string;
  lastAssistantText?: string;
  /** dernier tool_use sans tool_result correspondant */
  openToolUse?: { name: string; input: Record<string, unknown> };
}

export function readTranscriptInfo(file: string): TranscriptInfo {
  const info: TranscriptInfo = {};
  let text: string;
  try {
    text = readTail(file);
  } catch {
    return info;
  }
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  const results = new Set<string>();
  let checkedLastToolUse = false;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!info.sessionId && typeof o.sessionId === "string") info.sessionId = o.sessionId;
    if (!info.cwd && typeof o.cwd === "string") info.cwd = o.cwd;
    if (!customTitle && o.type === "custom-title" && typeof o.customTitle === "string") customTitle = o.customTitle;
    if (!aiTitle && o.type === "ai-title" && typeof o.aiTitle === "string") aiTitle = o.aiTitle;
    if (!info.lastPrompt && o.type === "last-prompt" && typeof o.lastPrompt === "string") info.lastPrompt = o.lastPrompt;
    const content = o.message?.content;
    if (o.type === "user" && Array.isArray(content)) {
      for (const c of content) if (c?.type === "tool_result" && c.tool_use_id) results.add(c.tool_use_id);
    }
    if (o.type === "assistant" && Array.isArray(content)) {
      for (const c of content) {
        if (!info.lastAssistantText && c?.type === "text" && typeof c.text === "string" && c.text.trim()) {
          info.lastAssistantText = c.text;
        }
      }
      // seul le message assistant le plus récent contenant des tool_use compte
      const uses = content.filter((c: any) => c?.type === "tool_use");
      if (!checkedLastToolUse && uses.length > 0) {
        checkedLastToolUse = true;
        const open = uses.find((u: any) => !results.has(u.id));
        if (open) info.openToolUse = { name: open.name, input: open.input ?? {} };
      }
    }
  }
  info.title = customTitle ?? aiTitle;
  return info;
}

export interface RecentTranscript {
  file: string;
  mtimeMs: number;
  info: TranscriptInfo;
}

/** Transcripts principaux (pas ceux des sous-agents) modifiés depuis moins de maxAgeMs. */
export function scanRecentTranscripts(dir = projectsDir(), maxAgeMs = 30 * 60_000, now = Date.now()): RecentTranscript[] {
  const out: RecentTranscript[] = [];
  let projects: string[];
  try {
    projects = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const p of projects) {
    const pdir = path.join(dir, p);
    let files: string[];
    try {
      files = fs.readdirSync(pdir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(pdir, f);
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (!st.isFile() || now - st.mtimeMs > maxAgeMs) continue;
      const info = readTranscriptInfo(file);
      if (!info.sessionId) info.sessionId = f.replace(/\.jsonl$/, "");
      out.push({ file, mtimeMs: st.mtimeMs, info });
    }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}
