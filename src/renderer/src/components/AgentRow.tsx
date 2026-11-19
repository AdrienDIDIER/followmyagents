// Ligne « En cours » : mascotte 20 px, titre + sous-titre, anneau à droite.
// Survol : fond --fill-1 + actions ↗ (VS Code) et × (retirer). Clic : vue détail.
import type { Session } from "@shared/types";
import { Mascot } from "./Mascot";
import { Activity, progress, Ring } from "./Ring";
import { IconCheck, IconClose, IconOpen } from "./Icons";
import { since } from "../format";

export function subtitleOf(s: Session): { text: string; cls: string } {
  const waiting = s.state === "needs_permission" || s.state === "asks_question";
  if (waiting) return { text: s.subtitle || "Attend ta réponse", cls: "wait" };
  if (s.state === "error") return { text: s.subtitle || "Erreur", cls: "err" };
  if (s.state === "done") return { text: s.subtitle && s.subtitle !== "Réfléchit…" ? s.subtitle : "Terminé", cls: "" };
  const p = progress(s);
  if (s.state === "working" && p?.current && p.current !== s.subtitle) return { text: s.subtitle || p.current, cls: "" };
  return { text: s.subtitle || (s.state === "idle" ? "En pause" : "Démarre…"), cls: "" };
}

export function AgentRow({
  session: s,
  now,
  onOpen,
  onJump,
  onDismiss,
  showPreview,
}: {
  session: Session;
  now: number;
  onOpen: () => void;
  onJump: () => void;
  onDismiss: () => void;
  showPreview?: boolean;
}) {
  const p = progress(s);
  const sub = subtitleOf(s);
  const flash = s.flash && s.flash.until > now ? s.flash : undefined;
  return (
    <div>
      <div
        className="row"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        data-testid="agent-row"
        data-state={s.state}
      >
        <Mascot state={s.state} colorIndex={s.colorIndex} size={20} />
        <div className="txt">
          <div className="t">
            {s.title}
            {s.subagents.length > 0 && (
              <span className="subagents" title={s.subagents.map((a) => a.type).join(", ")}>
                {s.subagents.slice(0, 4).map((a) => (
                  <Mascot key={a.id} state="working" colorIndex={s.colorIndex} size={9} animate={false} />
                ))}
              </span>
            )}
          </div>
          {flash ? (
            <div className="s flash-text">
              <IconCheck className="ok" />
              {flash.text}
            </div>
          ) : (
            <div className={`s ${sub.cls}`}>{sub.text}</div>
          )}
        </div>
        <div className="side">
          <div className="meta">
            {p ? (
              <Ring done={p.done} total={p.total} colorIndex={s.colorIndex} />
            ) : s.state === "working" ? (
              <>
                <span>{since(s.startedAt, now)}</span>
                <Activity />
              </>
            ) : null}
          </div>
          <div className="actions">
            <button
              className="icon-btn"
              title="Ouvrir dans VS Code"
              aria-label="Ouvrir dans VS Code"
              onClick={(e) => {
                e.stopPropagation();
                onJump();
              }}
            >
              <IconOpen />
            </button>
            <button
              className="icon-btn"
              title="Retirer de la liste"
              aria-label="Retirer de la liste"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
            >
              <IconClose />
            </button>
          </div>
        </div>
      </div>
      {showPreview && s.lastMessage && <div className="preview">{s.lastMessage}</div>}
    </div>
  );
}
