// Construction des corps de réponse HTTP renvoyés à Claude Code.
// `null` = réponse 200 sans corps : aucune décision, Claude Code garde son
// dialogue habituel (VS Code).
import type { PendingPermission, PendingQuestion, PermissionAnswer, QuestionAnswer } from "@shared/types";

export const DENY_MESSAGE = "Refusé depuis FollowMyAgents";

export function permissionResponse(p: PendingPermission, a: PermissionAnswer): object | null {
  switch (a.kind) {
    case "allow":
      return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
    case "deny":
      return {
        hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: DENY_MESSAGE } },
      };
    case "always": {
      const idx = a.suggestionIndex ?? 0;
      const s = p.suggestions[idx];
      const decision: Record<string, unknown> = { behavior: "allow" };
      if (s) decision.updatedPermissions = [s];
      return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision } };
    }
    case "vscode":
      return null;
  }
}

/** Ne garde que les réponses aux questions réellement posées. */
export function cleanAnswers(q: PendingQuestion, answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of q.questions) {
    const v = answers[item.question];
    if (typeof v === "string" && v.trim() !== "") out[item.question] = v.trim();
  }
  return out;
}

export function questionResponse(q: PendingQuestion, a: QuestionAnswer): object | null {
  if (a.kind === "vscode") return null;
  const answers = cleanAnswers(q, a.answers);
  // L'entrée d'origine (questions) est renvoyée telle quelle, avec `answers` en plus.
  const updatedInput = { ...q.toolInput, answers };
  if (q.via === "permission") {
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedInput } } };
  }
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput } };
}

/** Texte du flash de confirmation affiché après une réponse. */
export function flashText(a: PermissionAnswer | QuestionAnswer, q?: PendingQuestion): string | null {
  switch (a.kind) {
    case "allow":
      return "Autorisé";
    case "always":
      return "Toujours autorisé";
    case "deny":
      return "Refusé";
    case "answers": {
      const vals = q ? Object.values(cleanAnswers(q, a.answers)) : Object.values(a.answers);
      if (vals.length === 1) return `Réponse : « ${vals[0].length > 30 ? vals[0].slice(0, 29) + "…" : vals[0]} »`;
      return "Réponses envoyées";
    }
    case "vscode":
      return null;
  }
}
