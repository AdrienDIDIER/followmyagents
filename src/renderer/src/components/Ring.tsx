import type { Session } from "@shared/types";
import { agentColor } from "./Mascot";

/** Anneau de progression (affiché seulement s'il y a une vraie liste d'étapes, §3.1.4). */
export function Ring({ done, total, colorIndex, size = 20 }: { done: number; total: number; colorIndex: number; size?: number }) {
  const r = 8.5;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 22 22" aria-label={`${done} sur ${total}`}>
      <circle cx="11" cy="11" r={r} stroke="rgba(255,255,255,.15)" strokeWidth="2.5" fill="none" />
      <circle
        cx="11"
        cy="11"
        r={r}
        stroke={agentColor(colorIndex)}
        strokeWidth="2.5"
        fill="none"
        strokeDasharray={`${Math.max(frac * c, frac > 0 ? 0.1 : 0)} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 11 11)"
      />
    </svg>
  );
}

export function progress(s: Session): { done: number; total: number; current?: string } | null {
  if (s.steps.length === 0) return null;
  const done = s.steps.filter((x) => x.status === "completed").length;
  const current = s.steps.find((x) => x.status === "in_progress")?.label;
  return { done, total: s.steps.length, current };
}

export function Activity() {
  return (
    <span className="dots" aria-label="en activité">
      <i />
      <i />
      <i />
    </span>
  );
}
