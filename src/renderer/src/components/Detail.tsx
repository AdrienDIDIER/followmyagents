// Vue détail (F5/F6, BRIEF §3.4) : grande mascotte, progression, étapes, Terminal.
import type { Session } from "@shared/types";
import { Mascot } from "./Mascot";
import { progress, Ring } from "./Ring";
import { IconCheckCircle, IconCircle, IconCross, IconOpen, IconTerminal, KindIcon } from "./Icons";
import { agentLabel, backgroundOf, subtitleOf } from "./AgentRow";
import { since } from "../format";

export function Detail({ session: s, now, onJump }: { session: Session; now: number; onJump: () => void }) {
  const p = progress(s);
  const sub = subtitleOf(s);
  const bg = backgroundOf(s);
  const doneSubs = s.subagents.filter((a) => a.status === "done").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const flash = s.flash && s.flash.until > now ? s.flash : undefined;
  return (
    <div data-testid="detail">
      <div className="d-hero">
        <Mascot state={bg.inBackground ? "working" : s.state} colorIndex={s.colorIndex} size={44} />
        <div className="txt">
          <div className="t">
            {s.agent === "codex" && <span className="agent-tag">Codex</span>}
            {s.title}
          </div>
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
                {bg.count > 0 ? ` · ${bg.count} en arrière-plan` : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {s.steps.length > 0 ? (
        <div className="steps scroll" style={{ maxHeight: 220 }}>
          <div className="steps-lbl">Plan</div>
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
      ) : (
        s.activity.length > 0 && (
          <div className="steps scroll" style={{ maxHeight: 220 }} data-testid="activity">
            <div className="steps-lbl">Activité récente</div>
            {s.activity.map((a) => (
              <div key={a.id} className={`step ${a.status === "running" ? "in_progress" : a.status === "failed" ? "failed" : "completed"}`}>
                <span className="st">{a.status === "running" ? <span className="spinner" /> : a.status === "failed" ? <IconCross /> : <IconCheckCircle />}</span>
                <span className="kind">
                  <KindIcon kind={a.kind} />
                </span>
                <span className="l">
                  {a.agent && <span className="who">{agentLabel(a.agent)} · </span>}
                  {a.label}
                </span>
              </div>
            ))}
          </div>
        )
      )}

      {(bg.count > 0 || doneSubs.length > 0) && (
        <div className="tasks" data-testid="tasks">
          <div className="lbl">Sous-agents et tâches</div>
          {bg.subs.map((a) => (
            <div className="task" key={a.id}>
              <Mascot state="working" colorIndex={s.colorIndex} size={12} />
              <div className="txt">
                <div className="t">
                  {agentLabel(a.type)}
                  {a.background && <span className="tag">arrière-plan</span>}
                  <span className="when">{since(a.startedAt, now)}</span>
                </div>
                <div className="s">{a.action ?? a.description ?? "Démarre…"}</div>
              </div>
            </div>
          ))}
          {bg.tasks.map((b) => (
            <div className="task" key={b.id}>
              <span className="ico">
                <IconTerminal />
              </span>
              <div className="txt">
                <div className="t">
                  {b.type === "shell" ? "Commande" : b.type === "subagent" ? agentLabel(b.agentType ?? "") : b.type}
                  <span className="tag">arrière-plan</span>
                  <span className="when">{since(b.startedAt, now)}</span>
                </div>
                <div className={`s${b.command ? " mono" : ""}`}>{b.command ?? b.description}</div>
              </div>
            </div>
          ))}
          {doneSubs.map((a) => (
            <div className="task done" key={a.id}>
              <span className="ico">
                <IconCheckCircle />
              </span>
              <div className="txt">
                <div className="t">
                  {agentLabel(a.type)}
                  {a.description && <span className="desc"> · {a.description}</span>}
                </div>
                {a.lastMessage && <div className="s res">{a.lastMessage}</div>}
              </div>
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
