// Blocs « Attend ta réponse » : permission et question (BRIEF §3.4, §4.3, §4.4).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PendingPermission, PendingQuestion, Question, Session } from "@shared/types";
import { Mascot } from "./Mascot";
import { IconCheck } from "./Icons";
import { since } from "../format";

export interface BlockHandle {
  focus(): void;
}

function Who({ session, subtitle, now, waitingSince }: { session: Session; subtitle: string; now: number; waitingSince: number }) {
  return (
    <div className="who">
      <Mascot state={session.state === "asks_question" ? "asks_question" : "needs_permission"} colorIndex={session.colorIndex} size={26} />
      <div className="txt">
        <div className="t">
          {session.agent === "codex" && <span className="agent-tag">Codex</span>}
          {session.title}
        </div>
        <div className="s">{subtitle}</div>
      </div>
      {now - waitingSince >= 30_000 && <div className="since">{since(waitingSince, now)}</div>}
    </div>
  );
}

export const PermissionBlock = forwardRef<
  BlockHandle,
  { pending: PendingPermission; session: Session; now: number; onAnswer: (kind: "allow" | "deny" | "always" | "vscode") => void }
>(function PermissionBlock({ pending, session, now, onAnswer }, ref) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => el.current?.focus() }));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onAnswer("allow");
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onAnswer("deny");
    }
  };
  return (
    <div className="attn" ref={el} tabIndex={-1} onKeyDown={onKey} data-testid="permission" aria-label={`${session.title} : ${pending.headline}`}>
      <Who session={session} subtitle={pending.headline} now={now} waitingSince={pending.createdAt} />
      {pending.detail && <div className="cmd">{pending.detail}</div>}
      {!pending.detail && <div style={{ height: 10 }} />}
      <div className="btns">
        <button className="btn" onClick={() => onAnswer("deny")}>
          Refuser
        </button>
        <button className="btn primary" onClick={() => onAnswer("allow")}>
          Autoriser
        </button>
      </div>
      <div className="links">
        {pending.alwaysLabel && (
          <button className="link" title={`Toujours autoriser ${pending.alwaysLabel}`} onClick={() => onAnswer("always")}>
            Toujours autoriser
          </button>
        )}
        <button className="link" onClick={() => onAnswer("vscode")}>
          Ouvrir dans VS Code
        </button>
      </div>
    </div>
  );
});

interface QState {
  selected: string[];
  other: string;
}

function answerOf(q: Question, st: QState): string {
  const other = st.other.trim();
  if (q.multiSelect) return [...st.selected, ...(other ? [other] : [])].join(", ");
  return other || st.selected[0] || "";
}

export const QuestionBlock = forwardRef<
  BlockHandle,
  {
    pending: PendingQuestion;
    session: Session;
    now: number;
    onSend: (answers: Record<string, string>) => void;
    onVsCode: () => void;
    wantFocus: () => void;
  }
>(function QuestionBlock({ pending, session, now, onSend, onVsCode, wantFocus }, ref) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => el.current?.focus() }));
  const [state, setState] = useState<QState[]>(() => pending.questions.map(() => ({ selected: [], other: "" })));
  const [active, setActive] = useState(0);
  useEffect(() => setState(pending.questions.map(() => ({ selected: [], other: "" }))), [pending.id]);

  const answers = useMemo(() => {
    const out: Record<string, string> = {};
    pending.questions.forEach((q, i) => (out[q.question] = answerOf(q, state[i] ?? { selected: [], other: "" })));
    return out;
  }, [pending.questions, state]);
  const complete = Object.values(answers).every((v) => v.trim() !== "");

  const toggle = (qi: number, label: string) => {
    setActive(qi);
    setState((prev) =>
      prev.map((st, i) => {
        if (i !== qi) return st;
        const q = pending.questions[qi];
        if (q.multiSelect) {
          const has = st.selected.includes(label);
          return { ...st, selected: has ? st.selected.filter((l) => l !== label) : [...st.selected, label] };
        }
        return { selected: [label], other: "" };
      }),
    );
  };
  const setOther = (qi: number, text: string) =>
    setState((prev) =>
      prev.map((st, i) => (i !== qi ? st : pending.questions[qi].multiSelect ? { ...st, other: text } : { selected: text ? [] : st.selected, other: text })),
    );

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Enter" && complete) {
        e.preventDefault();
        onSend(answers);
      }
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 9) {
      const q = pending.questions[active];
      const opt = q?.options[n - 1];
      if (opt) {
        e.preventDefault();
        toggle(active, opt.label);
        // question suivante pour un choix simple
        if (!q.multiSelect && active < pending.questions.length - 1) setActive(active + 1);
      }
    } else if (e.key === "Enter" && complete) {
      e.preventDefault();
      onSend(answers);
    }
  };

  return (
    <div className="attn" ref={el} tabIndex={-1} onKeyDown={onKey} data-testid="question">
      <Who session={session} subtitle={pending.questions.length > 1 ? `Te pose ${pending.questions.length} questions` : "Te pose une question"} now={now} waitingSince={pending.createdAt} />
      {pending.questions.map((q, qi) => {
        const st = state[qi] ?? { selected: [], other: "" };
        return (
          <div className="q" key={q.question}>
            {q.header && <div className="q-header">{q.header}</div>}
            <div className="q-text" style={q.header ? undefined : { marginTop: 12 }}>
              {q.question}
            </div>
            <div className="opts" role={q.multiSelect ? "group" : "radiogroup"}>
              {q.options.map((o, oi) => {
                const sel = st.selected.includes(o.label);
                return (
                  <button
                    key={o.label}
                    className={`opt${sel ? " sel" : ""}${q.multiSelect ? " multi" : ""}`}
                    role={q.multiSelect ? "checkbox" : "radio"}
                    aria-checked={sel}
                    onClick={() => toggle(qi, o.label)}
                  >
                    <span className="mark">{sel && <IconCheck />}</span>
                    <span className="l">
                      {o.label}
                      {o.description && <span className="d">{o.description}</span>}
                    </span>
                    {oi < 9 && <span className="n">{oi + 1}</span>}
                  </button>
                );
              })}
              <input
                className={`other${st.other.trim() ? " sel" : ""}`}
                placeholder="Autre…"
                value={st.other}
                onMouseDown={wantFocus}
                onFocus={() => {
                  setActive(qi);
                  wantFocus();
                }}
                onChange={(e) => setOther(qi, e.target.value)}
                aria-label={`Autre réponse : ${q.question}`}
              />
            </div>
          </div>
        );
      })}
      <div className="q-foot">
        <div className="btns">
          <button className="btn primary" disabled={!complete} onClick={() => onSend(answers)}>
            Envoyer
          </button>
        </div>
        <div className="links">
          <button className="link" onClick={onVsCode}>
            Répondre dans VS Code
          </button>
        </div>
      </div>
    </div>
  );
});
