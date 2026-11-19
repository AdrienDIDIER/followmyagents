import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppSnapshot, PendingAnswer, QuotaView, Session } from "@shared/types";
import { PermissionBlock, QuestionBlock, type BlockHandle } from "./components/Attention";
import { AgentRow } from "./components/AgentRow";
import { Detail } from "./components/Detail";
import { Mascot } from "./components/Mascot";
import { IconChevronLeft, IconChevronRight, IconOpen, IconPin, IconSpeaker } from "./components/Icons";
import { chime } from "./sound";
import { plural } from "./format";

const fma = window.fma;
const ORDER: Record<string, number> = { needs_permission: 0, asks_question: 0, working: 1, error: 2, idle: 3, disconnected: 4, done: 5 };

export function App() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<{ detail: string | null; dir: "in" | "back" | null }>({ detail: null, dir: null });
  const [showDone, setShowDone] = useState(false);
  const [opening, setOpening] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const blocks = useRef(new Map<string, BlockHandle>());
  const soundOn = useRef(true);

  useEffect(() => {
    const offs = [
      fma.onSnapshot((s) => {
        setSnap(s);
        soundOn.current = s.prefs.sound;
      }),
      fma.onAttention(() => {
        if (soundOn.current) chime();
      }),
      fma.onFocusPending((id) => {
        setView({ detail: null, dir: null });
        requestAnimationFrame(() => {
          const target = id ? blocks.current.get(id) : [...blocks.current.values()][0];
          target?.focus();
        });
      }),
      fma.onPanelShown(() => {
        setOpening(false);
        requestAnimationFrame(() => setOpening(true));
        setTimeout(() => setOpening(false), 260);
      }),
    ];
    fma.ready();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      offs.forEach((off) => off());
      clearInterval(t);
    };
  }, []);

  // Hauteur de la fenêtre = hauteur du contenu
  useLayoutEffect(() => {
    if (!root.current) return;
    const ro = new ResizeObserver(() => {
      if (root.current) fma.resize(root.current.getBoundingClientRect().height);
    });
    ro.observe(root.current);
    return () => ro.disconnect();
  }, []);

  // Échap : ferme le panneau (sauf dans un bloc d'attention, où Échap = Refuser)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (view.detail) setView({ detail: null, dir: "back" });
      else fma.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.detail]);

  const answer = useCallback((id: string, a: PendingAnswer) => fma.answer(id, a), []);

  if (!snap) return <div ref={root} />;

  const t = Math.max(now, snap.now);
  const byId = new Map(snap.sessions.map((s) => [s.id, s] as const));
  const pendings = snap.pendings.filter((p) => byId.has(p.sessionId));
  const pendingSessions = new Set(pendings.map((p) => p.sessionId));
  const active = snap.sessions.filter((s) => s.state !== "done");
  const running = active
    .filter((s) => !pendingSessions.has(s.id))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.startedAt - b.startedAt);
  const done = snap.sessions.filter((s) => s.state === "done").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const detail = view.detail ? byId.get(view.detail) : undefined;
  const isWin = snap.platform === "win32";
  const glass = snap.glass;

  const openDetail = (s: Session) => setView({ detail: s.id, dir: "in" });

  const header = detail ? (
    <div className={`head${snap.prefs.detached ? " drag" : ""}`}>
      <button className="back" onClick={() => setView({ detail: null, dir: "back" })}>
        <IconChevronLeft />
        Agents
      </button>
      <div className="mini-agents">
        {active
          .filter((s) => s.id !== detail.id)
          .slice(0, 6)
          .map((s) => (
            <button key={s.id} title={s.title} onClick={() => setView({ detail: s.id, dir: "in" })}>
              <Mascot state={s.state} colorIndex={s.colorIndex} size={14} animate={false} />
            </button>
          ))}
      </div>
      <div className="tools">
        <button className="icon-btn" title="Ouvrir dans VS Code" aria-label="Ouvrir dans VS Code" onClick={() => fma.jump(detail.id)}>
          <IconOpen />
        </button>
        <SoundBtn on={snap.prefs.sound} />
      </div>
    </div>
  ) : (
    <div className={`head${snap.prefs.detached ? " drag" : ""}`} onContextMenu={() => fma.contextMenu()}>
      <span className="title">Agents</span>
      <span className="count" data-testid="count">
        {active.length === 0 ? "aucun" : plural(active.length, "actif", "actifs")}
      </span>
      <div className="tools">
        <SoundBtn on={snap.prefs.sound} />
        <button
          className={`icon-btn${snap.prefs.detached ? " on" : ""}`}
          title={snap.prefs.detached ? "Rattacher à l'icône" : "Détacher le panneau"}
          aria-label={snap.prefs.detached ? "Rattacher à l'icône" : "Détacher le panneau"}
          onClick={() => fma.toggleDetach()}
        >
          <IconPin detached={snap.prefs.detached} />
        </button>
      </div>
    </div>
  );

  return (
    <div
      ref={root}
      className={`panel${glass ? "" : " no-glass"}${isWin ? " win from-bottom" : ""}${snap.platform === "darwin" ? " mac" : ""}${opening ? " opening" : ""}`}
      data-testid="panel"
    >
      {header}
      {!detail && <QuotaRow quota={snap.quota} now={t} />}
      <div className="scroll" style={{ maxHeight: Math.max(160, snap.maxHeight - 62) }}>
        {detail ? (
          <div className={view.dir === "in" ? "slide-in" : ""} key={detail.id}>
            <Detail session={detail} now={t} onJump={() => fma.jump(detail.id)} />
          </div>
        ) : (
          <div className={view.dir === "back" ? "slide-back" : ""}>
            <UpdateNotice snap={snap} />
            {snap.serverError && (
              <div className="notice err">
                <b>Serveur arrêté :</b> {snap.serverError}.
              </div>
            )}
            {!snap.hooks.installed && !snap.serverError && (
              <div className="notice">
                <b>Hooks non installés.</b> Clic droit sur l'icône FollowMyAgents → « Installer les hooks… ».
              </div>
            )}

            {pendings.length > 0 && (
              <>
                <div className="sec">Attend ta réponse</div>
                {pendings.map((p) => {
                  const s = byId.get(p.sessionId)!;
                  return (
                    <div className="attn-wrap enter" key={p.id}>
                      <div>
                        {p.kind === "permission" ? (
                          <PermissionBlock
                            ref={(h) => {
                              if (h) blocks.current.set(p.id, h);
                              else blocks.current.delete(p.id);
                            }}
                            pending={p}
                            session={s}
                            now={t}
                            onAnswer={(kind) => answer(p.id, kind === "always" ? { kind, suggestionIndex: 0 } : { kind })}
                          />
                        ) : (
                          <QuestionBlock
                            ref={(h) => {
                              if (h) blocks.current.set(p.id, h);
                              else blocks.current.delete(p.id);
                            }}
                            pending={p}
                            session={s}
                            now={t}
                            onSend={(answers) => answer(p.id, { kind: "answers", answers })}
                            onVsCode={() => answer(p.id, { kind: "vscode" })}
                            wantFocus={() => fma.wantFocus()}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {running.length > 0 && (
              <>
                <div className="sec">En cours</div>
                <div className="list">
                  {running.map((s) => (
                    <AgentRow
                      key={s.id}
                      session={s}
                      now={t}
                      onOpen={() => openDetail(s)}
                      onJump={() => fma.jump(s.id)}
                      onDismiss={() => fma.dismiss(s.id)}
                    />
                  ))}
                </div>
              </>
            )}

            {active.length === 0 && pendings.length === 0 && (
              <div className="empty">
                <Mascot state="idle" colorIndex={0} size={28} />
                <div className="big">Aucun agent en cours</div>
                Les sessions Claude Code apparaîtront ici dès leur prochain événement.
              </div>
            )}

            {done.length > 0 && (
              <>
                <div className="sec">
                  <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                    <IconChevronRight className={`chev${showDone ? " open" : ""}`} />
                    Terminés ({done.length})
                  </button>
                </div>
                {showDone && (
                  <div className="list done-list">
                    {done.map((s) => (
                      <div className="done-item" key={s.id}>
                        <AgentRow
                          session={s}
                          now={t}
                          onOpen={() => openDetail(s)}
                          onJump={() => fma.jump(s.id)}
                          onDismiss={() => fma.dismiss(s.id)}
                          showPreview
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function resetLabel(at: number | undefined, now: number): string {
  if (!at) return "";
  const d = new Date(at);
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (at - now < 20 * 3600_000) return hm;
  return `${d.toLocaleDateString("fr-FR", { weekday: "short" })} ${hm}`;
}

function QuotaRow({ quota, now }: { quota: QuotaView; now: number }) {
  if (quota.state === "disabled" || quota.state === "loading") return null;
  if (quota.limits.length === 0) {
    return (
      <div className="quota muted" title={quota.message} data-testid="quota">
        Quota Claude indisponible
      </div>
    );
  }
  const stale = quota.state !== "ok";
  return (
    <div className={`quota${stale ? " stale" : ""}`} data-testid="quota" title={stale ? quota.message : undefined}>
      {quota.limits.slice(0, 3).map((l) => {
        const reset = resetLabel(l.resetsAt, now);
        return (
          <div className={`meter ${l.severity}`} key={l.kind} title={reset ? `${l.label} : ${Math.round(l.percent)} % utilisé · remise à zéro ${reset}` : undefined}>
            <span className="lbl">{l.label}</span>
            <span className="bar">
              <i style={{ width: `${Math.max(2, l.percent)}%` }} />
            </span>
            <span className="pct">{Math.round(l.percent)} %</span>
            {reset && <span className="reset">↻ {reset}</span>}
          </div>
        );
      })}
    </div>
  );
}

function UpdateNotice({ snap }: { snap: AppSnapshot }) {
  const u = snap.update;
  if (u.state === "available") {
    return (
      <div className="notice update" data-testid="update">
        <span>
          <b>Version {u.version} disponible</b> (actuelle : {snap.version})
        </span>
        <button className="btn primary small" onClick={() => fma.installUpdate()}>
          Installer
        </button>
      </div>
    );
  }
  if (u.state === "downloading" || u.state === "installing") {
    return (
      <div className="notice update" data-testid="update">
        <span>
          {u.state === "downloading" ? `Téléchargement de la version ${u.version}… ${u.progress} %` : `Installation de la version ${u.version}…`}
        </span>
        {u.state === "downloading" && (
          <div className="bar">
            <i style={{ width: `${u.progress}%` }} />
          </div>
        )}
      </div>
    );
  }
  if (u.state === "error" && u.version) {
    return (
      <div className="notice" data-testid="update">
        {u.message}
      </div>
    );
  }
  return null;
}

function SoundBtn({ on }: { on: boolean }) {
  return (
    <button
      className={`icon-btn${on ? " on" : ""}`}
      title={on ? "Couper le son" : "Activer le son"}
      aria-label={on ? "Couper le son" : "Activer le son"}
      aria-pressed={on}
      onClick={() => fma.setPref("sound", !on)}
    >
      <IconSpeaker on={on} />
    </button>
  );
}
