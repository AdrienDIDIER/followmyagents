// Store d'état : sessions Claude Code + demandes en attente (permissions,
// questions). Pur Node, sans Electron : testable avec Vitest.
import { randomUUID } from "node:crypto";
import type {
  AgentState,
  Pending,
  PendingAnswer,
  PendingPermission,
  PendingQuestion,
  PermissionAnswer,
  PermissionSuggestion,
  QuestionAnswer,
  Session,
} from "@shared/types";
import {
  applyTaskTool,
  describePermission,
  describeSuggestion,
  describeTool,
  messagePreview,
  normalizeQuestions,
  outputTail,
  pickAlwaysSuggestion,
  stepsFromTodoWrite,
  titleFromPrompt,
  truncate,
} from "./describe";
import { flashText, permissionResponse, questionResponse } from "./responses";

export type HookInput = Record<string, any> & { session_id?: string; hook_event_name?: string };

export interface StoreOptions {
  now?: () => number;
  /** délai (s) avant de relâcher une demande sans réponse */
  pendingTimeoutSec?: () => number;
  /** retrait auto des sessions terminées (min, 0 = jamais) */
  autoRemoveDoneMin?: () => number;
  /** passage en "disconnected" après ce délai sans événement (ms) */
  disconnectAfterMs?: number;
  flashMs?: number;
  /** appelé après chaque événement ingéré (ex. rafraîchir le titre depuis le transcript) */
  onEvent?: (ev: HookInput, session: Session) => void;
}

export type PendingOutcome =
  | { type: "answered"; answer: PendingAnswer }
  | { type: "closed" } // Claude Code a fermé la requête (réponse donnée dans VS Code)
  | { type: "timeout" }
  | { type: "superseded" } // la session a avancé sans nous (secours)
  | { type: "dismissed" };

interface PendingEntry {
  pending: Pending;
  resolve: (body: object | null) => void;
}

/** Ordre d'attribution des couleurs : l'orange (attention) en dernier. */
const COLOR_ORDER = [0, 1, 3, 4, 5, 2];
const WAIT_STATES: AgentState[] = ["needs_permission", "asks_question"];

type Listener = (reason: ChangeReason) => void;
export type ChangeReason =
  | { type: "update" }
  | { type: "pending-added"; pending: Pending }
  | { type: "pending-removed"; pending: Pending; outcome: PendingOutcome };

export class SessionStore {
  private sessions = new Map<string, Session>();
  private pendings = new Map<string, PendingEntry>();
  private listeners = new Set<Listener>();
  private colorCursor = 0;
  private readonly now: () => number;
  private readonly opts: Required<Omit<StoreOptions, "now" | "onEvent">>;
  private readonly onEvent?: StoreOptions["onEvent"];

  constructor(opts: StoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.onEvent = opts.onEvent;
    this.opts = {
      pendingTimeoutSec: opts.pendingTimeoutSec ?? (() => 580),
      autoRemoveDoneMin: opts.autoRemoveDoneMin ?? (() => 30),
      disconnectAfterMs: opts.disconnectAfterMs ?? 10 * 60 * 1000,
      flashMs: opts.flashMs ?? 1500,
    };
  }

  // ---------- abonnements ----------
  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(reason: ChangeReason = { type: "update" }) {
    for (const l of this.listeners) l(reason);
  }

  // ---------- lecture ----------
  getSessions(): Session[] {
    return [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt);
  }
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  getPendings(): Pending[] {
    return [...this.pendings.values()].map((e) => e.pending).sort((a, b) => a.createdAt - b.createdAt);
  }
  getPending(id: string): Pending | undefined {
    return this.pendings.get(id)?.pending;
  }

  // ---------- sessions ----------
  private nextColor(): number {
    const used = new Set([...this.sessions.values()].filter((s) => s.state !== "done").map((s) => s.colorIndex));
    for (let i = 0; i < COLOR_ORDER.length; i++) {
      const c = COLOR_ORDER[(this.colorCursor + i) % COLOR_ORDER.length];
      if (!used.has(c)) {
        this.colorCursor = (this.colorCursor + i + 1) % COLOR_ORDER.length;
        return c;
      }
    }
    const c = COLOR_ORDER[this.colorCursor % COLOR_ORDER.length];
    this.colorCursor++;
    return c;
  }

  private ensureSession(ev: HookInput): Session | undefined {
    const id = ev.session_id;
    if (!id || typeof id !== "string") return undefined;
    let s = this.sessions.get(id);
    const t = this.now();
    if (!s) {
      s = {
        id,
        cwd: ev.cwd ?? "",
        transcriptPath: ev.transcript_path ?? "",
        title: "",
        titleSource: "folder",
        subtitle: "",
        colorIndex: this.nextColor(),
        state: "idle",
        steps: [],
        subagents: [],
        startedAt: t,
        lastEventAt: t,
      };
      this.sessions.set(id, s);
    }
    if (ev.cwd) s.cwd = ev.cwd;
    if (ev.transcript_path) s.transcriptPath = ev.transcript_path;
    if (typeof ev.session_title === "string" && ev.session_title.trim()) {
      s.title = truncate(ev.session_title, 48);
      s.titleSource = "session";
    }
    s.lastEventAt = t;
    s.reconstructed = false;
    if (!s.title) s.title = folderTitle(s.cwd);
    return s;
  }

  /** Ajoute une session reconstruite (lecture de transcript au démarrage). */
  addReconstructed(partial: Pick<Session, "id" | "cwd" | "transcriptPath" | "title"> & Partial<Session>): void {
    if (this.sessions.has(partial.id)) return;
    const t = this.now();
    this.sessions.set(partial.id, {
      titleSource: "transcript",
      subtitle: "",
      colorIndex: this.nextColor(),
      state: "idle",
      steps: [],
      subagents: [],
      startedAt: t,
      lastEventAt: t,
      ...partial,
      reconstructed: true,
    });
    this.emit();
  }

  /** Titre lu dans le transcript (titre de l'onglet VS Code). */
  applyTranscriptTitle(sessionId: string, title: string | undefined): void {
    const s = this.sessions.get(sessionId);
    if (!s || !title || s.titleSource === "session") return;
    const t = truncate(title, 48);
    if (s.title === t && s.titleSource === "transcript") return;
    s.title = t;
    s.titleSource = "transcript";
    this.emit();
  }

  private hasPending(sessionId: string): boolean {
    for (const e of this.pendings.values()) if (e.pending.sessionId === sessionId) return true;
    return false;
  }

  private setWorking(s: Session) {
    if (this.hasPending(s.id)) return;
    s.state = "working";
    s.waitingSince = undefined;
  }

  /** Événement non bloquant (/hook/event). */
  ingest(ev: HookInput): void {
    const s = this.ensureSession(ev);
    if (!s) return;
    const name = ev.hook_event_name;
    const tool: string = ev.tool_name ?? "";
    const input: Record<string, unknown> = ev.tool_input && typeof ev.tool_input === "object" ? ev.tool_input : {};
    const fromSubagent = typeof ev.agent_id === "string" && ev.agent_id !== "";

    switch (name) {
      case "SessionStart":
        if (s.state === "done" || s.state === "disconnected" || s.state === "error") s.state = "idle";
        if (!s.subtitle) s.subtitle = ev.source === "resume" ? "Session reprise" : "Prête";
        break;
      case "UserPromptSubmit":
        this.cancelSessionPendings(s.id, { type: "superseded" });
        if (s.titleSource === "folder" && typeof ev.prompt === "string") {
          s.title = titleFromPrompt(ev.prompt);
          s.titleSource = "prompt";
        }
        s.lastMessage = undefined;
        s.endedAt = undefined;
        s.subtitle = "Réfléchit…";
        this.setWorking(s);
        break;
      case "PreToolUse":
        if (!this.hasPending(s.id)) {
          s.subtitle = describeTool(tool, input);
          this.setWorking(s);
        }
        if ((tool === "Bash" || tool === "PowerShell") && typeof input.command === "string") {
          s.lastCommand = { command: input.command, outputTail: [], running: true };
        }
        break;
      case "PostToolUse":
      case "PostToolUseFailure": {
        this.cancelMatchingPendings(s.id, tool, input);
        const failed = name === "PostToolUseFailure";
        if ((tool === "Bash" || tool === "PowerShell") && typeof input.command === "string") {
          const tail = outputTail(failed ? ev.error ?? ev.tool_response : ev.tool_response);
          s.lastCommand = { command: input.command, outputTail: tail, running: false, failed };
        }
        if (tool === "TodoWrite" && !fromSubagent) {
          const steps = stepsFromTodoWrite(input);
          if (steps) s.steps = steps;
        } else if ((tool === "TaskCreate" || tool === "TaskUpdate") && !failed) {
          s.steps = applyTaskTool(s.steps, tool, input, ev.tool_response);
        }
        if (s.state !== "done") this.setWorking(s);
        break;
      }
      case "TaskCreated":
        if (ev.task_id && !s.steps.some((x) => x.id === String(ev.task_id))) {
          s.steps = [
            ...s.steps,
            { id: String(ev.task_id), label: String(ev.task_subject ?? "Étape"), status: "pending", kind: "other" },
          ];
        }
        break;
      case "TaskCompleted":
        s.steps = s.steps.map((x) => (x.id === String(ev.task_id) ? { ...x, status: "completed" } : x));
        break;
      case "Notification":
        if (ev.notification_type === "idle_prompt" && !this.hasPending(s.id) && s.state !== "done") {
          s.state = "idle";
        }
        break;
      case "SubagentStart":
        if (ev.agent_id && !s.subagents.some((a) => a.id === ev.agent_id)) {
          s.subagents = [...s.subagents, { id: ev.agent_id, type: ev.agent_type || "agent", startedAt: this.now() }];
        }
        break;
      case "SubagentStop":
        s.subagents = s.subagents.filter((a) => a.id !== ev.agent_id);
        break;
      case "Stop":
        this.cancelSessionPendings(s.id, { type: "superseded" });
        s.state = "idle";
        s.waitingSince = undefined;
        s.subagents = [];
        if (typeof ev.last_assistant_message === "string" && ev.last_assistant_message.trim()) {
          s.lastMessage = ev.last_assistant_message;
          s.subtitle = messagePreview(ev.last_assistant_message) || "Tour terminé";
        } else s.subtitle = "Tour terminé";
        if (s.lastCommand) s.lastCommand.running = false;
        break;
      case "StopFailure":
        this.cancelSessionPendings(s.id, { type: "superseded" });
        s.state = "error";
        s.subtitle = truncate(String(ev.last_assistant_message || ev.error_details || ev.error || "Erreur"), 70);
        break;
      case "SessionEnd":
        this.cancelSessionPendings(s.id, { type: "superseded" });
        s.state = "done";
        s.endedAt = this.now();
        s.subtitle = s.lastMessage ? messagePreview(s.lastMessage) || "Session terminée" : "Session terminée";
        s.subagents = [];
        if (s.lastCommand) s.lastCommand.running = false;
        break;
      default:
        break;
    }
    this.emit();
    this.onEvent?.(ev, s);
  }

  // ---------- demandes en attente ----------
  private register(p: Pending): Promise<object | null> {
    const s = this.sessions.get(p.sessionId)!;
    s.state = p.kind === "permission" ? "needs_permission" : "asks_question";
    s.waitingSince = s.waitingSince ?? p.createdAt;
    s.subtitle = p.kind === "permission" ? p.headline : "Te pose une question";
    s.flash = undefined;
    return new Promise((resolve) => {
      this.pendings.set(p.id, { pending: p, resolve });
      this.emit({ type: "pending-added", pending: p });
    });
  }

  /** PermissionRequest bloquant. Renvoie le pending et la promesse du corps de réponse. */
  openPermission(ev: HookInput): { pending: Pending; result: Promise<object | null> } | null {
    if (ev.tool_name === "AskUserQuestion") return this.openQuestion(ev, "permission");
    const s = this.ensureSession(ev);
    if (!s) return null;
    const input: Record<string, unknown> = ev.tool_input && typeof ev.tool_input === "object" ? ev.tool_input : {};
    const suggestions: PermissionSuggestion[] = Array.isArray(ev.permission_suggestions) ? ev.permission_suggestions : [];
    const { headline, detail } = describePermission(ev.tool_name ?? "", input);
    const t = this.now();
    const alwaysIdx = pickAlwaysSuggestion(suggestions);
    const p: PendingPermission = {
      id: randomUUID(),
      kind: "permission",
      sessionId: s.id,
      createdAt: t,
      expiresAt: t + this.opts.pendingTimeoutSec() * 1000,
      agentId: ev.agent_id,
      toolName: ev.tool_name ?? "",
      toolInput: input,
      headline,
      detail,
      suggestions: alwaysIdx >= 0 ? [suggestions[alwaysIdx]] : [],
      alwaysLabel: alwaysIdx >= 0 ? describeSuggestion(suggestions[alwaysIdx]) : undefined,
    };
    return { pending: p, result: this.register(p) };
  }

  /** Question AskUserQuestion (via PermissionRequest ou PreToolUse). */
  openQuestion(ev: HookInput, via: "permission" | "pretooluse"): { pending: Pending; result: Promise<object | null> } | null {
    const s = this.ensureSession(ev);
    if (!s) return null;
    const input: Record<string, unknown> = ev.tool_input && typeof ev.tool_input === "object" ? ev.tool_input : {};
    const questions = normalizeQuestions(input);
    if (questions.length === 0) return null;
    const t = this.now();
    const p: PendingQuestion = {
      id: randomUUID(),
      kind: "question",
      sessionId: s.id,
      createdAt: t,
      expiresAt: t + this.opts.pendingTimeoutSec() * 1000,
      agentId: ev.agent_id,
      questions,
      toolInput: input,
      via,
    };
    return { pending: p, result: this.register(p) };
  }

  /** Réponse de l'utilisateur depuis le widget. */
  answer(pendingId: string, answer: PendingAnswer): boolean {
    const e = this.pendings.get(pendingId);
    if (!e) return false;
    const p = e.pending;
    let body: object | null;
    if (p.kind === "permission") {
      if (!["allow", "deny", "always", "vscode"].includes(answer.kind)) return false;
      body = permissionResponse(p, answer as PermissionAnswer);
    } else {
      if (!["answers", "vscode"].includes(answer.kind)) return false;
      if (answer.kind === "answers") {
        const missing = p.questions.some((q) => !(answer.answers[q.question] ?? "").trim());
        if (missing) return false;
      }
      body = questionResponse(p, answer as QuestionAnswer);
    }
    this.finish(pendingId, body, { type: "answered", answer });
    return true;
  }

  /** Relâche une demande sans décision (réponse vide). */
  cancel(pendingId: string, outcome: PendingOutcome): void {
    if (!this.pendings.has(pendingId)) return;
    this.finish(pendingId, null, outcome);
  }

  private finish(pendingId: string, body: object | null, outcome: PendingOutcome) {
    const e = this.pendings.get(pendingId);
    if (!e) return;
    this.pendings.delete(pendingId);
    e.resolve(body);
    const p = e.pending;
    const s = this.sessions.get(p.sessionId);
    if (s && !this.hasPending(s.id)) {
      const t = this.now();
      if (outcome.type === "answered") {
        const a = outcome.answer;
        if (a.kind === "vscode") {
          s.subtitle = "Attend ta réponse dans VS Code";
        } else {
          const txt = flashText(a, p.kind === "question" ? p : undefined);
          if (txt) s.flash = { text: txt, until: t + this.opts.flashMs };
          s.state = "working";
          s.waitingSince = undefined;
          s.subtitle =
            p.kind === "question"
              ? "Reprend avec ta réponse"
              : a.kind === "deny"
                ? "Demande refusée"
                : describeTool(p.toolName, p.toolInput);
        }
      } else if (outcome.type === "timeout") {
        s.subtitle = "Attend ta réponse dans VS Code";
      } else if (outcome.type === "closed") {
        s.state = "working";
        s.waitingSince = undefined;
        s.subtitle = "Répondu dans VS Code";
      } else if (outcome.type === "dismissed" || outcome.type === "superseded") {
        if (WAIT_STATES.includes(s.state)) {
          s.state = "working";
          s.waitingSince = undefined;
        }
      }
    }
    this.emit({ type: "pending-removed", pending: p, outcome });
  }

  private cancelSessionPendings(sessionId: string, outcome: PendingOutcome) {
    for (const [id, e] of [...this.pendings]) if (e.pending.sessionId === sessionId) this.finish(id, null, outcome);
  }

  /** Secours (D5) : l'outil demandé a été exécuté → la demande a été traitée ailleurs. */
  private cancelMatchingPendings(sessionId: string, tool: string, input: Record<string, unknown>) {
    for (const [id, e] of [...this.pendings]) {
      const p = e.pending;
      if (p.sessionId !== sessionId) continue;
      const pTool = p.kind === "permission" ? p.toolName : "AskUserQuestion";
      if (pTool !== tool) continue;
      if (p.kind === "permission" && stableJson(p.toolInput) !== stableJson(input)) continue;
      if (p.kind === "question" && stableJson(p.toolInput.questions) !== stableJson(input.questions)) continue;
      this.finish(id, null, { type: "superseded" });
    }
  }

  /** L'utilisateur retire une session (bouton ×). */
  dismiss(sessionId: string): void {
    this.cancelSessionPendings(sessionId, { type: "dismissed" });
    if (this.sessions.delete(sessionId)) this.emit();
  }

  /** Tâches périodiques : timeouts, déconnexion, flashs, retrait auto. */
  tick(): void {
    const t = this.now();
    let changed = false;
    for (const [id, e] of [...this.pendings]) {
      if (e.pending.expiresAt <= t) {
        this.finish(id, null, { type: "timeout" });
        changed = true;
      }
    }
    const removeAfter = this.opts.autoRemoveDoneMin() * 60_000;
    for (const s of [...this.sessions.values()]) {
      if (s.flash && s.flash.until <= t) {
        s.flash = undefined;
        changed = true;
      }
      if (s.state === "working" && !this.hasPending(s.id) && t - s.lastEventAt > this.opts.disconnectAfterMs) {
        s.state = "disconnected";
        s.subtitle = "Plus de nouvelles depuis 10 min";
        changed = true;
      }
      // session reconstruite au démarrage sans aucun nouvel événement depuis 30 min
      if (s.reconstructed && t - s.lastEventAt > 30 * 60_000) {
        this.sessions.delete(s.id);
        changed = true;
        continue;
      }
      if (s.state === "done" && removeAfter > 0 && s.endedAt && t - s.endedAt > removeAfter) {
        this.sessions.delete(s.id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Relâche toutes les demandes (arrêt de l'app). */
  releaseAll(): void {
    for (const id of [...this.pendings.keys()]) this.finish(id, null, { type: "dismissed" });
  }
}

export function folderTitle(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "Session";
}

function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}
