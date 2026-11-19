// Vue détail (F5/F6, BRIEF §3.4) : grande mascotte, progression, étapes, Terminal.
import type { Session } from "@shared/types";
import { Mascot } from "./Mascot";
import { progress, Ring } from "./Ring";
import { IconCheckCircle, IconCircle, IconOpen, IconTerminal, KindIcon } from "./Icons";
import { subtitleOf } from "./AgentRow";
import { since } from "../format";

export function Detail({ session: s, now, onJump }: { session: Session; now: number; onJump: () => void }) {
  const p = progress(s);
  const sub = subtitleOf(s);
  const flash = s.flash && s.flash.until > now ? s.flash : undefined;
  return (
    <div data-testid="detail">
      <div className="d-hero">
        <Mascot state={s.state} colorIndex={s.colorIndex} size={44} />
        <div className="txt">
          <div className="t">{s.title}</div>
          <div className={`s ${flash ? "" : sub.cls}`}>{flash ? flash.text : sub.text}</div>
          <div className="d-prog">
            {p ? (
              <>
                <Ring done={p.done} total={p.total} colorIndex={s.colorIndex} size={16} />
                <b>
                  {p.done}/{p.total}
                </b>
                {p.current && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.current}</span>}
              </>
            ) : (
              <span>
                {s.reconstructed
                  ? "Session reprise au démarrage de l'app"
                  : s.state === "done" && s.endedAt
                    ? `Durée ${since(s.startedAt, s.endedAt)}`
                    : `Depuis ${since(s.startedAt, now)}`}
                {s.waitingSince ? ` · attend depuis ${since(s.waitingSince, now)}` : ""}
                {s.subagents.length > 0 ? ` · ${s.subagents.length} sous-agent${s.subagents.length > 1 ? "s" : ""}` : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {s.steps.length > 0 && (
        <div className="steps scroll" style={{ maxHeight: 220 }}>
          {s.steps.map((st) => (
            <div key={st.id} className={`step ${st.status}`}>
              <span className="st">{st.status === "completed" ? <IconCheckCircle /> : st.status === "in_progress" ? <span className="spinner" /> : <IconCircle />}</span>
              <span className="kind">
                <KindIcon kind={st.kind} />
              </span>
              <span className="l">{st.label}</span>
            </div>
          ))}
        </div>
      )}

      {s.lastCommand && (
        <div className="term">
          <div className="lbl">
            <IconTerminal /> Terminal
          </div>
          <div className="c">{s.lastCommand.command}</div>
          {s.lastCommand.outputTail.map((l, i) => (
            <div key={i} className={`o${s.lastCommand?.failed ? " fail" : ""}`}>
              {l}
            </div>
          ))}
          {s.lastCommand.running && s.lastCommand.outputTail.length === 0 && <div className="o">…</div>}
        </div>
      )}

      {s.lastMessage && (s.state === "idle" || s.state === "done") && (
        <div className="msg">
          <div className="lbl">Dernier message</div>
          {s.lastMessage}
        </div>
      )}

      <button className="wide-btn" onClick={onJump}>
        <IconOpen /> Ouvrir dans VS Code
      </button>
    </div>
  );
}
