// Types partagés entre le process principal et le renderer.

export type AgentState =
  | "working"
  | "needs_permission"
  | "asks_question"
  | "idle"
  | "done"
  | "error"
  | "disconnected";

export type StepStatus = "pending" | "in_progress" | "completed";
export type StepKind = "command" | "write" | "read" | "web" | "other";

export interface Step {
  id: string;
  label: string;
  status: StepStatus;
  kind: StepKind;
}

export interface LastCommand {
  command: string;
  outputTail: string[];
  running: boolean;
  failed?: boolean;
}

export interface Flash {
  text: string;
  until: number;
}

export interface Subagent {
  id: string;
  type: string;
  startedAt: number;
}

export interface Session {
  id: string;
  cwd: string;
  transcriptPath: string;
  title: string;
  /** origine du titre, par priorité : session_title > transcript (titre de l'onglet VS Code) > prompt > dossier */
  titleSource: "session" | "transcript" | "prompt" | "folder";
  subtitle: string;
  colorIndex: number; // 0..5 → --agent-1..6
  state: AgentState;
  steps: Step[];
  lastCommand?: LastCommand;
  lastMessage?: string;
  subagents: Subagent[];
  startedAt: number;
  lastEventAt: number;
  /** début de l'attente utilisateur courante (pour le chronomètre) */
  waitingSince?: number;
  endedAt?: number;
  flash?: Flash;
  /** reconstruite depuis un transcript au démarrage de l'app */
  reconstructed?: boolean;
}

export interface PermissionSuggestion {
  type: string;
  destination?: string;
  behavior?: string;
  rules?: { toolName: string; ruleContent?: string }[];
  directories?: string[];
  mode?: string;
  [k: string]: unknown;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface PendingBase {
  id: string;
  sessionId: string;
  createdAt: number;
  /** échéance après laquelle la demande est relâchée (réponse vide) */
  expiresAt: number;
  agentId?: string;
}

export interface PendingPermission extends PendingBase {
  kind: "permission";
  toolName: string;
  toolInput: Record<string, unknown>;
  /** "Veut exécuter une commande", "Veut modifier `x.ts`"… */
  headline: string;
  /** commande / chemin / résumé, affiché en mono */
  detail: string;
  suggestions: PermissionSuggestion[];
  /** libellé lisible de la suggestion « toujours autoriser » */
  alwaysLabel?: string;
}

export interface PendingQuestion extends PendingBase {
  kind: "question";
  questions: Question[];
  toolInput: Record<string, unknown>;
  /** canal : PermissionRequest (par défaut) ou PreToolUse (mécanisme du brief) */
  via: "permission" | "pretooluse";
}

export type Pending = PendingPermission | PendingQuestion;

export type PermissionAnswer =
  | { kind: "allow" }
  | { kind: "deny" }
  | { kind: "always"; suggestionIndex?: number }
  | { kind: "vscode" };

export type QuestionAnswer =
  | { kind: "answers"; answers: Record<string, string> }
  | { kind: "vscode" };

export type PendingAnswer = PermissionAnswer | QuestionAnswer;

export interface Prefs {
  sound: boolean;
  detached: boolean;
  openAtLogin: boolean;
  notifications: boolean;
  /** délai avant de relâcher une demande sans réponse (s) */
  pendingTimeoutSec: number;
  /** retrait automatique des sessions terminées (min, 0 = jamais) */
  autoRemoveDoneMin: number;
}

export interface HooksStatus {
  installed: boolean;
  settingsPath: string;
  error?: string;
}

export interface AppSnapshot {
  sessions: Session[];
  pendings: Pending[];
  prefs: Prefs;
  hooks: HooksStatus;
  serverError?: string;
  /** verre natif actif (sinon fond opaque --panel-fallback) */
  glass: boolean;
  /** hauteur max du panneau (70 % de la zone de travail de l'écran) */
  maxHeight: number;
  now: number;
  platform: NodeJS.Platform | string;
}

/** API exposée au renderer par le preload. */
export interface FmaApi {
  onSnapshot(cb: (s: AppSnapshot) => void): () => void;
  onFocusPending(cb: (pendingId: string | null) => void): () => void;
  onShowSession(cb: (sessionId: string) => void): () => void;
  ready(): void;
  answer(pendingId: string, answer: PendingAnswer): void;
  dismiss(sessionId: string): void;
  jump(sessionId: string): void;
  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  hide(): void;
  toggleDetach(): void;
  resize(height: number): void;
  wantFocus(): void;
}
