// Icônes au trait, style SF Symbols (1.5 px, bouts arrondis).
import type { StepKind } from "@shared/types";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconSpeaker = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 16 16" {...P}>
    <path d="M2.5 6h2l3-2.5v9l-3-2.5h-2z" />
    {on ? <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" /> : <path d="M11 6l3 4M14 6l-3 4" />}
  </svg>
);
export const IconPin = ({ detached }: { detached: boolean }) =>
  detached ? (
    // rattacher : flèche vers le coin
    <svg viewBox="0 0 16 16" {...P}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M6 10l4-4M6.5 6H10v3.5" />
    </svg>
  ) : (
    // détacher : fenêtre flottante
    <svg viewBox="0 0 16 16" {...P}>
      <rect x="2.5" y="4.5" width="9" height="9" rx="2" />
      <path d="M6 2.5h5.5a2 2 0 0 1 2 2V10" />
    </svg>
  );
export const IconClose = () => (
  <svg viewBox="0 0 16 16" {...P}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>
);
export const IconOpen = () => (
  <svg viewBox="0 0 16 16" {...P}>
    <path d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5" />
    <path d="M9 2.5h4.5V7M13.5 2.5L8 8" />
  </svg>
);
export const IconChevronLeft = () => (
  <svg viewBox="0 0 16 16" {...P} strokeWidth={1.8}>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </svg>
);
export const IconChevronRight = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" {...P} strokeWidth={1.8} className={className}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </svg>
);
export const IconCheck = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" {...P} strokeWidth={2} className={className}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);
export const IconCheckCircle = () => (
  <svg viewBox="0 0 16 16" width="14" height="14">
    <circle cx="8" cy="8" r="6.5" fill="var(--text-3)" opacity=".55" />
    <path d="M5.2 8.3l1.9 1.9 3.8-4.2" fill="none" stroke="#1e1e22" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const IconCircle = () => (
  <svg viewBox="0 0 16 16" width="14" height="14">
    <circle cx="8" cy="8" r="6" fill="none" stroke="var(--text-3)" strokeWidth="1.3" />
  </svg>
);
export const IconTerminal = () => (
  <svg viewBox="0 0 16 16" {...P}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M5 6.5L7 8.2 5 10M8.5 10.5H11" />
  </svg>
);
export const IconPencil = () => (
  <svg viewBox="0 0 16 16" {...P}>
    <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
  </svg>
);
export const IconSearch = () => (
  <svg viewBox="0 0 16 16" {...P}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2L13.5 13.5" />
  </svg>
);
export const IconGlobe = () => (
  <svg viewBox="0 0 16 16" {...P}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M2.4 8h11.2M8 2.2c1.8 1.7 2.6 3.6 2.6 5.8S9.8 12.1 8 13.8C6.2 12.1 5.4 10.2 5.4 8S6.2 3.9 8 2.2z" />
  </svg>
);
export const IconDot = () => (
  <svg viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="1.8" fill="currentColor" />
  </svg>
);

export function KindIcon({ kind }: { kind: StepKind }) {
  switch (kind) {
    case "command":
      return <IconTerminal />;
    case "write":
      return <IconPencil />;
    case "read":
      return <IconSearch />;
    case "web":
      return <IconGlobe />;
    default:
      return <IconDot />;
  }
}
