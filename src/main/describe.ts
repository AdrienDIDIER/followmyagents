// Fonctions pures : transforment les entrées des hooks en textes lisibles
// et en étapes. Aucune dépendance à Electron (testables avec Vitest).
import type { PermissionSuggestion, Question, Step, StepKind, StepStatus } from "@shared/types";

type Input = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function basename(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

export function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + "…" : one;
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Fichiers touchés par un patch Codex (apply_patch : « *** Update File: chemin »). */
export function patchFiles(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) out.push(m[1].trim());
  return out;
}

function patchSummary(input: Input): string {
  const files = patchFiles(str(input.command) || str(input.patch) || str(input.input));
  if (files.length === 0) return "des fichiers";
  return files.length === 1 ? basename(files[0]) : `${basename(files[0])} et ${files.length - 1} autre${files.length > 2 ? "s" : ""}`;
}

/** Sous-titre « action en cours » pour un PreToolUse. */
export function describeTool(toolName: string, input: Input = {}): string {
  const file = basename(str(input.file_path) || str(input.notebook_path) || str(input.path));
  switch (toolName) {
    case "Bash":
    case "PowerShell":
      return truncate(str(input.description) || `Exécute ${str(input.command)}`, 60);
    case "Read":
      return `Lecture de ${file}`;
    case "Write":
      return `Écriture de ${file}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Modification de ${file}`;
    case "apply_patch":
      return truncate(`Modification de ${patchSummary(input)}`, 60);
    case "Glob":
      return truncate(`Recherche de fichiers ${str(input.pattern)}`, 60);
    case "Grep":
      return truncate(`Recherche de « ${str(input.pattern)} »`, 60);
    case "WebFetch":
      return `Lecture de ${host(str(input.url))}`;
    case "WebSearch":
      return truncate(`Recherche web « ${str(input.query)} »`, 60);
    case "Task":
    case "Agent":
      return truncate(`Délègue : ${str(input.description) || str(input.subagent_type) || "sous-agent"}`, 60);
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "Mise à jour du plan";
    case "AskUserQuestion":
      return "Pose une question";
    case "Skill":
      return truncate(`Utilise ${str(input.skill) || str(input.command) || "une compétence"}`, 60);
    case "ToolSearch":
      return "Cherche un outil";
    case "ExitPlanMode":
      return "Propose un plan";
    default:
      if (toolName.startsWith("mcp__")) {
        const [, server, ...tool] = toolName.split("__");
        return truncate(`${server} · ${tool.join("__")}`, 60);
      }
      return toolName;
  }
}

/** Type d'icône d'un outil. */
export function toolKind(toolName: string): StepKind {
  switch (toolName) {
    case "Bash":
    case "PowerShell":
    case "Monitor":
      return "command";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "apply_patch":
      return "write";
    case "Read":
    case "Grep":
    case "Glob":
      return "read";
    case "WebFetch":
    case "WebSearch":
      return "web";
    default:
      return "other";
  }
}

/** Outils qui n'ont pas leur place dans le journal d'activité. */
export const QUIET_TOOLS = new Set(["ToolSearch", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "AskUserQuestion"]);

/** En-tête + détail d'une demande de permission. */
export function describePermission(toolName: string, input: Input = {}): { headline: string; detail: string } {
  switch (toolName) {
    case "Bash":
    case "PowerShell":
      return { headline: "Veut exécuter une commande", detail: str(input.command) };
    case "Write":
      return { headline: `Veut créer ${basename(str(input.file_path))}`, detail: str(input.file_path) };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return {
        headline: `Veut modifier ${basename(str(input.file_path) || str(input.notebook_path))}`,
        detail: str(input.file_path) || str(input.notebook_path),
      };
    case "Read":
      return { headline: `Veut lire ${basename(str(input.file_path))}`, detail: str(input.file_path) };
    case "WebFetch":
      return { headline: `Veut accéder à ${host(str(input.url))}`, detail: str(input.url) };
    case "WebSearch":
      return { headline: "Veut faire une recherche web", detail: str(input.query) };
    case "apply_patch":
      return {
        headline: `Veut modifier ${patchSummary(input)}`,
        detail: patchFiles(str(input.command) || str(input.patch) || str(input.input)).join("\n") || truncate(str(input.command), 300),
      };
    case "ExitPlanMode":
      return { headline: "Veut valider son plan", detail: truncate(str(input.plan), 300) };
    default: {
      const label = toolName.startsWith("mcp__") ? toolName.split("__").slice(1).join(" · ") : toolName;
      const json = JSON.stringify(input);
      return { headline: `Veut utiliser ${label}`, detail: json === "{}" ? "" : truncate(json, 300) };
    }
  }
}

/** Libellé lisible d'une suggestion de permission (« Toujours autoriser »). */
export function describeSuggestion(s: PermissionSuggestion | undefined): string | undefined {
  if (!s) return undefined;
  if ((s.type === "addRules" || s.type === "replaceRules") && s.behavior !== "deny" && s.rules?.length) {
    const r = s.rules[0];
    return r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName;
  }
  if (s.type === "addDirectories" && s.directories?.length) return `Accès au dossier ${basename(s.directories[0])}`;
  if (s.type === "setMode" && s.mode) return `Mode ${s.mode}`;
  return undefined;
}

/** Index de la suggestion la plus pertinente pour « Toujours autoriser ». */
export function pickAlwaysSuggestion(list: PermissionSuggestion[]): number {
  const rule = list.findIndex((s) => s.type === "addRules" && s.behavior !== "deny");
  if (rule >= 0) return rule;
  return list.findIndex((s) => describeSuggestion(s) !== undefined);
}

/** Titre de secours dérivé du premier prompt (≤ 40 caractères). */
export function titleFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ") // blocs balisés (contexte IDE…)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Nouvelle session";
  const first = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return truncate(first, 40);
}

export function guessStepKind(label: string): StepKind {
  const l = label.toLowerCase();
  if (/(run|test|build|install|lance|exécut|execut|compil|render|rendu|npm|git |commit|deploy|déploi)/.test(l)) return "command";
  if (/(write|edit|creat|crée|cré|écri|modif|refactor|fix|corrig|ajout|add |implement|rédig|update|mettre à jour)/.test(l)) return "write";
  if (/(read|lire|lis |lecture|analy|review|inspect|examin|explor|check|vérif)/.test(l)) return "read";
  if (/(search|cherch|web|fetch|télécharg|download|browse|url)/.test(l)) return "web";
  return "other";
}

function normStatus(s: unknown): StepStatus {
  return s === "completed" || s === "in_progress" ? s : "pending";
}

/** Liste d'étapes issue d'un TodoWrite (liste complète à chaque appel). */
export function stepsFromTodoWrite(input: Input): Step[] | null {
  const todos = input.todos;
  if (!Array.isArray(todos)) return null;
  return todos.map((t: Input, i: number) => {
    const label = str(t.status) === "in_progress" && str(t.activeForm) ? str(t.activeForm) : str(t.content);
    return {
      id: str(t.id) || `todo-${i}`,
      label: label || `Étape ${i + 1}`,
      status: normStatus(t.status),
      kind: guessStepKind(str(t.content) || label),
    };
  });
}

/** Applique un TaskCreate / TaskUpdate (format déduit, voir docs/phase0.md (e)). */
export function applyTaskTool(steps: Step[], toolName: string, input: Input, response?: unknown): Step[] {
  const next = steps.map((s) => ({ ...s }));
  if (toolName === "TaskCreate") {
    const resp = (response ?? {}) as Input;
    const task = (resp.task ?? {}) as Input;
    const id = str(resp.taskId) || str(task.id) || str(resp.id) || str(input.taskId) || `task-${next.length + 1}`;
    const label = str(input.subject) || str(input.title) || str(input.content) || str(input.description) || `Étape ${next.length + 1}`;
    if (!next.some((s) => s.id === id)) next.push({ id, label, status: "pending", kind: guessStepKind(label) });
    return next;
  }
  if (toolName === "TaskUpdate") {
    const id = str(input.taskId) || str(input.id) || str(input.task_id);
    const s = next.find((x) => x.id === id);
    if (!s) return next;
    if (input.status === "deleted") return next.filter((x) => x.id !== id);
    if (input.status) s.status = normStatus(input.status);
    const label = str(input.activeForm) && s.status === "in_progress" ? str(input.activeForm) : str(input.subject);
    if (label) s.label = label;
    return next;
  }
  return next;
}

/** 3 dernières lignes non vides de la sortie d'un outil Bash. */
export function outputTail(response: unknown, lines = 3): string[] {
  if (response == null) return [];
  let text = "";
  if (typeof response === "string") text = response;
  else if (typeof response === "object") {
    const r = response as Input;
    text = [str(r.stdout), str(r.stderr), str(r.output), str(r.error)].filter(Boolean).join("\n");
  }
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter((l) => l.trim() !== "")
    .slice(-lines)
    .map((l) => (l.length > 200 ? l.slice(0, 199) + "…" : l));
}

export function normalizeQuestions(input: Input): Question[] {
  const qs = input.questions;
  if (!Array.isArray(qs)) return [];
  return qs
    .filter((q) => q && typeof q.question === "string")
    .map((q: Input) => ({
      question: str(q.question),
      header: str(q.header) || undefined,
      multiSelect: q.multiSelect === true,
      options: Array.isArray(q.options)
        ? q.options.map((o: Input) => ({ label: str(o.label), description: str(o.description) || undefined }))
        : [],
    }));
}

/** Première ligne lisible d'un message de fin de tour. */
export function messagePreview(msg: string, max = 80): string {
  const line = msg
    .replace(/[#*_`>]/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? truncate(line, max) : "";
}
