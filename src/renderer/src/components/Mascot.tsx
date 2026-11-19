// Mascotte (BRIEF §3.5) : rectangle très arrondi, deux jambes, yeux selon l'état.
import { useEffect, useState } from "react";
import type { AgentState } from "@shared/types";

const EYE = "#000";

function Eyes({ state }: { state: AgentState }) {
  switch (state) {
    case "needs_permission":
    case "asks_question":
      return (
        <g className="eyes">
          <circle cx="10" cy="12" r="2.6" fill={EYE} opacity=".8" />
          <circle cx="18" cy="12" r="2.6" fill={EYE} opacity=".8" />
          <rect x="11.5" y="18" width="5" height="2" rx="1" fill={EYE} opacity=".55" />
        </g>
      );
    case "idle":
      return (
        <g className="eyes">
          <rect x="8.5" y="12" width="3" height="2" rx="1" fill={EYE} opacity=".78" />
          <rect x="16.5" y="12" width="3" height="2" rx="1" fill={EYE} opacity=".78" />
        </g>
      );
    case "done":
      return (
        <g className="eyes" fill="none" stroke={EYE} strokeOpacity=".78" strokeWidth="1.8" strokeLinecap="round">
          <path d="M8.2 13.4 Q10 10.6 11.8 13.4" />
          <path d="M16.2 13.4 Q18 10.6 19.8 13.4" />
        </g>
      );
    case "error":
      return (
        <g className="eyes" stroke={EYE} strokeOpacity=".8" strokeWidth="1.6" strokeLinecap="round">
          <path d="M8.6 10.4 L11.4 13.6 M11.4 10.4 L8.6 13.6" />
          <path d="M16.6 10.4 L19.4 13.6 M19.4 10.4 L16.6 13.6" />
        </g>
      );
    default:
      return (
        <g className="eyes">
          <rect x="8.5" y="10" width="3" height="4.5" rx="1.5" fill={EYE} opacity=".78" />
          <rect x="16.5" y="10" width="3" height="4.5" rx="1.5" fill={EYE} opacity=".78" />
        </g>
      );
  }
}

export function agentColor(colorIndex: number, state?: AgentState): string {
  if (state === "disconnected") return "var(--text-3)";
  return `var(--agent-${(colorIndex % 6) + 1})`;
}

export function Mascot({
  state,
  colorIndex,
  size = 20,
  animate = true,
  title,
}: {
  state: AgentState;
  colorIndex: number;
  size?: number;
  animate?: boolean;
  title?: string;
}) {
  const [blink, setBlink] = useState(false);
  const canBlink = animate && ["working", "idle", "needs_permission", "asks_question"].includes(state);
  useEffect(() => {
    if (!canBlink) return;
    let t: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        t2 = setTimeout(() => setBlink(false), 170);
        loop();
      }, 3000 + Math.random() * 3000);
    };
    loop();
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [canBlink]);

  const h = Math.round((size * 32) / 28);
  const cls = ["mascot", animate ? state : "", blink ? "blink" : ""].join(" ");
  return (
    <svg className={cls} width={size} height={h} viewBox="0 0 28 32" style={{ color: agentColor(colorIndex, state) }} role="img" aria-label={title}>
      <g className="body">
        <rect x="2" y="1" width="24" height="25" rx="8" fill="currentColor" />
        <rect x="8" y="25" width="3" height="6" rx="1.5" fill="currentColor" />
        <rect x="17" y="25" width="3" height="6" rx="1.5" fill="currentColor" />
        <Eyes state={state} />
      </g>
    </svg>
  );
}
