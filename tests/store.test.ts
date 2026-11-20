import { beforeEach, describe, expect, it } from "vitest";
import { SessionStore, parseTaskNotification, projectKeyFromTranscript, type ChangeReason } from "../src/main/store";
import fixture from "./fixtures/background-subagent.json";

let t = 1_000_000;
const now = () => t;
let store: SessionStore;
let reasons: ChangeReason[];

const base = (sid = "s1", extra: Record<string, unknown> = {}) => ({
  session_id: sid,
  transcript_path: `/home/u/.claude/projects/p/${sid}.jsonl`,
  cwd: "/work/my-project",
  permission_mode: "default",
  ...extra,
});
const ev = (name: string, extra: Record<string, unknown> = {}, sid = "s1") =>
  store.ingest({ ...base(sid, extra), hook_event_name: name });
const bashInput = { command: "npx hyperframes render . -o out.mp4", description: "Rendu des animations" };
const permReq = (sid = "s1", input: Record<string, unknown> = bashInput, extra: Record<string, unknown> = {}) =>
  store.openPermission({ ...base(sid), hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: input, ...extra })!;
const questions = [
  {
    question: "Which hook should I use?",
    header: "Hook",
    multiSelect: false,
    options: [{ label: "The pain one", description: "d1" }, { label: "The number one" }],
  },
];
const questionReq = (sid = "s1") =>
  store.openPermission({
    ...base(sid),
    hook_event_name: "PermissionRequest",
    tool_name: "AskUserQuestion",
    tool_input: { questions },
  })!;

beforeEach(() => {
  t = 1_000_000;
  store = new SessionStore({ now, pendingTimeoutSec: () => 120, autoRemoveDoneMin: () => 30 });
  reasons = [];
  store.onChange((r) => reasons.push(r));
});

describe("sessions", () => {
  it("crée une session au premier événement, titre = dossier puis 1er prompt", () => {
    ev("SessionStart", { source: "startup" });
    let s = store.getSession("s1")!;
    expect(s.title).toBe("my-project");
    expect(s.state).toBe("idle");
    ev("UserPromptSubmit", { prompt: "  polish the watch videos and render all animations for the reel please  " });
    s = store.getSession("s1")!;
    expect(s.title.length).toBeLessThanOrEqual(40);
    expect(s.title.startsWith("Polish the watch videos")).toBe(true);
    expect(s.title.endsWith("…")).toBe(true);
    expect(s.state).toBe("working");
  });

  it("session_title a priorité sur le prompt", () => {
    ev("SessionStart", { session_title: "Idea Scout" });
    ev("UserPromptSubmit", { prompt: "something else" });
    expect(store.getSession("s1")!.title).toBe("Idea Scout");
  });

  it("ignore un événement sans session_id", () => {
    store.ingest({ hook_event_name: "Stop" });
    expect(store.getSessions()).toHaveLength(0);
  });

  it("met à jour le sous-titre sur PreToolUse et le bloc Terminal sur PostToolUse", () => {
    ev("PreToolUse", { tool_name: "Bash", tool_input: bashInput });
    let s = store.getSession("s1")!;
    expect(s.subtitle).toBe("Rendu des animations");
    expect(s.lastCommand).toEqual({ command: bashInput.command, outputTail: [], running: true });
    ev("PostToolUse", {
      tool_name: "Bash",
      tool_input: bashInput,
      tool_response: { stdout: "a\nb\n\nrendering frame 83/139\nrendering frame 84/139\n", stderr: "" },
    });
    s = store.getSession("s1")!;
    expect(s.lastCommand).toEqual({
      command: bashInput.command,
      outputTail: ["b", "rendering frame 83/139", "rendering frame 84/139"],
      running: false,
      failed: false,
    });
    ev("PreToolUse", { tool_name: "Edit", tool_input: { file_path: "/work/my-project/src/style-sheet.md" } });
    expect(store.getSession("s1")!.subtitle).toBe("Modification de style-sheet.md");
  });

  it("construit les étapes depuis TodoWrite (liste complète)", () => {
    ev("PostToolUse", {
      tool_name: "TodoWrite",
      tool_input: {
        todos: [
          { content: "Read final-cut-transcript.md", status: "completed", activeForm: "Reading" },
          { content: "Render 01-hook.mp4", status: "in_progress", activeForm: "Rendering 01-hook.mp4" },
          { content: "Build CapCut project", status: "pending", activeForm: "Building" },
        ],
      },
    });
    const steps = store.getSession("s1")!.steps;
    expect(steps.map((s) => s.status)).toEqual(["completed", "in_progress", "pending"]);
    expect(steps[1].label).toBe("Rendering 01-hook.mp4");
    expect(steps[0].kind).toBe("read");
    expect(steps[1].kind).toBe("command");
  });

  it("ignore les TodoWrite des sous-agents", () => {
    ev("PostToolUse", { tool_name: "TodoWrite", agent_id: "a1", tool_input: { todos: [{ content: "x", status: "pending" }] } });
    expect(store.getSession("s1")!.steps).toHaveLength(0);
  });

  it("gère TaskCreated / TaskCompleted et TaskCreate / TaskUpdate", () => {
    ev("TaskCreated", { task_id: "1", task_subject: "Write tests" });
    ev("TaskCreated", { task_id: "2", task_subject: "Ship" });
    ev("TaskCompleted", { task_id: "1", task_subject: "Write tests" });
    expect(store.getSession("s1")!.steps.map((s) => [s.id, s.status])).toEqual([
      ["1", "completed"],
      ["2", "pending"],
    ]);
    ev("PostToolUse", { tool_name: "TaskUpdate", tool_input: { taskId: "2", status: "in_progress", activeForm: "Shipping" } });
    expect(store.getSession("s1")!.steps[1]).toMatchObject({ status: "in_progress", label: "Shipping" });
    ev("PostToolUse", { tool_name: "TaskCreate", tool_input: { subject: "Announce" }, tool_response: { task: { id: "3" } } });
    expect(store.getSession("s1")!.steps[2]).toMatchObject({ id: "3", label: "Announce", status: "pending" });
  });

  it("Stop → idle avec aperçu du dernier message ; StopFailure → error ; SessionEnd → done", () => {
    ev("UserPromptSubmit", { prompt: "go" });
    ev("Stop", { last_assistant_message: "## Done\n\nAll **7** animations rendered." });
    let s = store.getSession("s1")!;
    expect(s.state).toBe("idle");
    expect(s.subtitle).toBe("Done");
    expect(s.lastMessage).toContain("7");
    ev("StopFailure", { error: "rate_limit", last_assistant_message: "API Error: Rate limit reached" });
    expect(store.getSession("s1")!.state).toBe("error");
    expect(store.getSession("s1")!.subtitle).toBe("API Error: Rate limit reached");
    ev("SessionEnd", { reason: "other" });
    s = store.getSession("s1")!;
    expect(s.state).toBe("done");
    expect(s.endedAt).toBe(t);
    expect(s.subtitle).toBe("Done");
  });

  it("sous-agents : SubagentStart / SubagentStop (résultat conservé)", () => {
    ev("SubagentStart", { agent_id: "a1", agent_type: "Explore" });
    ev("SubagentStart", { agent_id: "a2", agent_type: "general-purpose" });
    expect(store.getSession("s1")!.subagents.map((a) => a.type)).toEqual(["Explore", "general-purpose"]);
    ev("SubagentStop", { agent_id: "a1", agent_type: "Explore", last_assistant_message: "3 fichiers trouvés" });
    const subs = store.getSession("s1")!.subagents;
    expect(subs.find((a) => a.id === "a1")).toMatchObject({ status: "done", lastMessage: "3 fichiers trouvés" });
    expect(subs.find((a) => a.id === "a2")).toMatchObject({ status: "running" });
  });

  it("sous-agent au premier plan : son action préfixe le sous-titre du parent", () => {
    ev("UserPromptSubmit", { prompt: "go" });
    ev("SubagentStart", { agent_id: "a1", agent_type: "Explore" });
    ev("PreToolUse", { agent_id: "a1", agent_type: "Explore", tool_name: "Read", tool_input: { file_path: "/p/config.ts" } });
    const s = store.getSession("s1")!;
    expect(s.subtitle).toBe("Explore · Lecture de config.ts");
    expect(s.subagents[0].action).toBe("Lecture de config.ts");
    // fin de tour : un sous-agent au premier plan est terminé
    ev("Stop", { last_assistant_message: "ok", background_tasks: [] });
    expect(store.getSession("s1")!.subagents[0].status).toBe("done");
  });

  it("ne garde que les 5 derniers sous-agents terminés", () => {
    for (let i = 0; i < 8; i++) {
      ev("SubagentStart", { agent_id: `a${i}`, agent_type: "Explore" });
      t += 1;
      ev("SubagentStop", { agent_id: `a${i}`, agent_type: "Explore" });
    }
    expect(store.getSession("s1")!.subagents.map((a) => a.id)).toEqual(["a3", "a4", "a5", "a6", "a7"]);
  });

  it("attribue des couleurs distinctes, l'orange en dernier", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) ev("SessionStart", {}, id);
    const colors = store.getSessions().map((s) => s.colorIndex);
    expect(new Set(colors).size).toBe(6);
    expect(colors[5]).toBe(2); // orange = index 2 (--agent-3)
  });

  it("passe en disconnected après 10 min sans événement (seulement si working)", () => {
    ev("UserPromptSubmit", { prompt: "go" });
    ev("SessionStart", {}, "idle-one");
    t += 10 * 60 * 1000 + 1;
    store.tick();
    expect(store.getSession("s1")!.state).toBe("disconnected");
    expect(store.getSession("idle-one")!.state).toBe("idle");
    ev("PreToolUse", { tool_name: "Read", tool_input: { file_path: "/a/b.ts" } });
    expect(store.getSession("s1")!.state).toBe("working");
  });

  it("retire automatiquement les sessions terminées après N minutes", () => {
    ev("SessionEnd", { reason: "other" });
    t += 29 * 60_000;
    store.tick();
    expect(store.getSession("s1")).toBeDefined();
    t += 2 * 60_000;
    store.tick();
    expect(store.getSession("s1")).toBeUndefined();
  });

  it("dismiss retire la session ; un nouvel événement la recrée", () => {
    ev("Stop", {});
    store.dismiss("s1");
    expect(store.getSessions()).toHaveLength(0);
    ev("UserPromptSubmit", { prompt: "again" });
    expect(store.getSession("s1")!.state).toBe("working");
  });
});

describe("arrière-plan (séquence réelle capturée, Claude Code 2.1.322)", () => {
  it("commande et sous-agent en arrière-plan : suivis jusqu'à leur fin", () => {
    const events = fixture as Record<string, unknown>[];
    const at = (pred: (e: Record<string, unknown>, i: number) => boolean) => events.findIndex(pred);
    const play = (from: number, to: number) => {
      for (const e of events.slice(from, to)) {
        t += 100;
        store.ingest(e);
      }
    };
    // jusqu'au 1er Stop (STARTED) inclus
    const firstStop = at((e) => e.hook_event_name === "Stop");
    play(0, firstStop + 1);
    let s = store.getSession("bg")!;
    expect(s.state).toBe("idle");
    expect(s.background.map((b) => b.type).sort()).toEqual(["shell", "subagent"]);
    expect(s.background.find((b) => b.type === "shell")?.command).toBe("ping -n 40 127.0.0.1 > ping.txt");
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0]).toMatchObject({ type: "general-purpose", status: "running", background: true });
    expect(s.lastCommand?.running).toBe(true);

    // le sous-agent travaille pendant que le parent est en pause
    const subStop = at((e) => e.hook_event_name === "SubagentStop");
    play(firstStop + 1, subStop);
    s = store.getSession("bg")!;
    expect(s.state).toBe("idle");
    expect(s.subtitle).toBe("STARTED");
    expect(s.subagents[0].action).toBe("Lecture de README.md");

    // fin du sous-agent : résultat conservé, plus que la commande en arrière-plan
    play(subStop, subStop + 1);
    s = store.getSession("bg")!;
    expect(s.subagents[0]).toMatchObject({ status: "done" });
    expect(s.subagents[0].lastMessage).toMatch(/README\.md/);
    expect(s.background.map((b) => b.type)).toEqual(["shell"]);

    // fin de la commande : tour relancé par <task-notification>, puis Stop sans tâche
    const lastPrompt = events.length - 1 - [...events].reverse().findIndex((e) => e.hook_event_name === "UserPromptSubmit");
    play(subStop + 1, lastPrompt + 1);
    s = store.getSession("bg")!;
    expect(s.background).toEqual([]);
    expect(s.state).toBe("working");
    expect(s.subtitle).toMatch(/^Reprend : Background command/);
    expect(s.title).not.toMatch(/task-notification/);
    play(lastPrompt + 1, events.length);
    s = store.getSession("bg")!;
    expect(s.state).toBe("done");
    expect(s.background).toEqual([]);
  });

  it("parseTaskNotification", () => {
    expect(parseTaskNotification("hello")).toBeNull();
    expect(
      parseTaskNotification(
        '<task-notification>\n<task-id>x1</task-id>\n<status>completed</status>\n<summary>Agent "A" finished</summary>\n</task-notification>',
      ),
    ).toEqual({ taskId: "x1", status: "completed", summary: 'Agent "A" finished' });
  });
});

describe("permissions", () => {
  it("ouvre une demande, passe la session en needs_permission et renvoie allow", async () => {
    ev("UserPromptSubmit", { prompt: "go" });
    const { pending, result } = permReq();
    expect(pending.kind).toBe("permission");
    if (pending.kind !== "permission") return;
    expect(pending.headline).toBe("Veut exécuter une commande");
    expect(pending.detail).toBe(bashInput.command);
    const s = store.getSession("s1")!;
    expect(s.state).toBe("needs_permission");
    expect(s.waitingSince).toBe(t);
    expect(reasons.some((r) => r.type === "pending-added")).toBe(true);
    expect(store.answer(pending.id, { kind: "allow" })).toBe(true);
    await expect(result).resolves.toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    const after = store.getSession("s1")!;
    expect(after.state).toBe("working");
    expect(after.flash).toEqual({ text: "Autorisé", until: t + 1500 });
    expect(after.subtitle).toBe("Rendu des animations");
    expect(store.getPendings()).toHaveLength(0);
  });

  it("deny renvoie le message de refus", async () => {
    const { pending, result } = permReq();
    store.answer(pending.id, { kind: "deny" });
    await expect(result).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: "Refusé depuis FollowMyAgents" },
      },
    });
    expect(store.getSession("s1")!.flash?.text).toBe("Refusé");
  });

  it("always renvoie updatedPermissions tiré de permission_suggestions", async () => {
    const sugg = [
      { type: "addDirectories", directories: ["/tmp"], destination: "session" },
      { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npx hyperframes render:*" }], behavior: "allow", destination: "localSettings" },
    ];
    const { pending, result } = permReq("s1", bashInput, { permission_suggestions: sugg });
    if (pending.kind !== "permission") throw new Error();
    expect(pending.alwaysLabel).toBe("Bash(npx hyperframes render:*)");
    store.answer(pending.id, { kind: "always" });
    await expect(result).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow", updatedPermissions: [sugg[1]] },
      },
    });
  });

  it("sans suggestion, pas de « toujours autoriser »", () => {
    const { pending } = permReq();
    if (pending.kind !== "permission") throw new Error();
    expect(pending.suggestions).toEqual([]);
    expect(pending.alwaysLabel).toBeUndefined();
  });

  it("« In VS Code » renvoie une réponse vide et garde l'agent en attente (dans VS Code)", async () => {
    const { pending, result } = permReq();
    store.answer(pending.id, { kind: "vscode" });
    await expect(result).resolves.toBeNull();
    const s = store.getSession("s1")!;
    expect(s.state).toBe("needs_permission");
    expect(s.subtitle).toBe("Attend ta réponse dans VS Code");
    ev("PostToolUse", { tool_name: "Bash", tool_input: bashInput, tool_response: { stdout: "" } });
    expect(store.getSession("s1")!.state).toBe("working");
  });

  it("timeout : réponse vide après le délai", async () => {
    const { result } = permReq();
    t += 119_000;
    store.tick();
    expect(store.getPendings()).toHaveLength(1);
    t += 2_000;
    store.tick();
    await expect(result).resolves.toBeNull();
    expect(store.getPendings()).toHaveLength(0);
  });

  it("fermeture par Claude Code (réponse dans VS Code) : la demande disparaît", async () => {
    const { pending, result } = permReq();
    store.cancel(pending.id, { type: "closed" });
    await expect(result).resolves.toBeNull();
    expect(store.getPendings()).toHaveLength(0);
    expect(store.getSession("s1")!.state).toBe("working");
    const removed = reasons.find((r) => r.type === "pending-removed");
    expect(removed && removed.type === "pending-removed" && removed.outcome.type).toBe("closed");
  });

  it("secours D5 : PostToolUse du même outil avec la même entrée retire la demande", async () => {
    const { result } = permReq();
    ev("PostToolUse", { tool_name: "Bash", tool_input: { command: "other" } });
    expect(store.getPendings()).toHaveLength(1);
    ev("PostToolUse", { tool_name: "Bash", tool_input: { description: bashInput.description, command: bashInput.command } });
    await expect(result).resolves.toBeNull();
    expect(store.getPendings()).toHaveLength(0);
  });

  it("Stop / SessionEnd / nouveau prompt relâchent les demandes de la session seulement", async () => {
    const a = permReq("s1");
    const b = permReq("s2");
    ev("Stop", {}, "s1");
    await expect(a.result).resolves.toBeNull();
    expect(store.getPendings().map((p) => p.sessionId)).toEqual(["s2"]);
    void b;
  });

  it("PreToolUse d'un autre outil ne remplace pas l'état d'attente", () => {
    permReq();
    ev("PreToolUse", { tool_name: "Read", tool_input: { file_path: "/x" } });
    const s = store.getSession("s1")!;
    expect(s.state).toBe("needs_permission");
    expect(s.subtitle).toBe("Veut exécuter une commande");
  });

  it("plusieurs demandes : triées de la plus ancienne à la plus récente", () => {
    permReq("s1");
    t += 10;
    permReq("s2");
    expect(store.getPendings().map((p) => p.sessionId)).toEqual(["s1", "s2"]);
  });

  it("refuse une réponse de mauvais type ou sur une demande inconnue", () => {
    const { pending } = permReq();
    expect(store.answer(pending.id, { kind: "answers", answers: {} })).toBe(false);
    expect(store.answer("nope", { kind: "allow" })).toBe(false);
  });

  it("dismiss relâche les demandes de la session", async () => {
    const { result } = permReq();
    store.dismiss("s1");
    await expect(result).resolves.toBeNull();
  });
});

describe("questions", () => {
  it("PermissionRequest(AskUserQuestion) devient une question ; la réponse renvoie updatedInput.answers", async () => {
    const { pending, result } = questionReq();
    expect(pending.kind).toBe("question");
    expect(store.getSession("s1")!.state).toBe("asks_question");
    expect(store.answer(pending.id, { kind: "answers", answers: { "Which hook should I use?": "The pain one" } })).toBe(true);
    await expect(result).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedInput: { questions, answers: { "Which hook should I use?": "The pain one" } },
        },
      },
    });
    expect(store.getSession("s1")!.flash?.text).toBe("Réponse : « The pain one »");
  });

  it("mécanisme PreToolUse (via = pretooluse)", async () => {
    const opened = store.openQuestion(
      { ...base(), hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions } },
      "pretooluse",
    )!;
    store.answer(opened.pending.id, { kind: "answers", answers: { "Which hook should I use?": "Libre" } });
    await expect(opened.result).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { questions, answers: { "Which hook should I use?": "Libre" } },
      },
    });
  });

  it("refuse l'envoi tant que toutes les questions n'ont pas de réponse", () => {
    const multi = [
      ...questions,
      { question: "Which formats?", header: "Formats", multiSelect: true, options: [{ label: "mp4" }, { label: "gif" }] },
    ];
    const { pending } = store.openPermission({
      ...base(),
      hook_event_name: "PermissionRequest",
      tool_name: "AskUserQuestion",
      tool_input: { questions: multi },
    })!;
    expect(store.answer(pending.id, { kind: "answers", answers: { "Which hook should I use?": "The pain one" } })).toBe(false);
    expect(
      store.answer(pending.id, {
        kind: "answers",
        answers: { "Which hook should I use?": "The pain one", "Which formats?": "mp4, gif" },
      }),
    ).toBe(true);
    expect(store.getSession("s1")!.flash?.text).toBe("Réponses envoyées");
  });

  it("question vide → pas de demande", () => {
    const r = store.openPermission({ ...base(), hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion", tool_input: {} });
    expect(r).toBeNull();
  });

  it("« Type in VS Code » → réponse vide", async () => {
    const { pending, result } = questionReq();
    store.answer(pending.id, { kind: "vscode" });
    await expect(result).resolves.toBeNull();
  });

  it("secours : PostToolUse(AskUserQuestion) retire la question", async () => {
    const { result } = questionReq();
    ev("PostToolUse", { tool_name: "AskUserQuestion", tool_input: { questions, answers: { x: "y" } } });
    await expect(result).resolves.toBeNull();
  });
});

describe("Codex", () => {
  const codex = (name: string, extra: Record<string, unknown> = {}, sid = "cx") =>
    store.ingest({ ...base(sid, extra), hook_event_name: name, _agent: "codex" });

  it("marque la session comme Codex", () => {
    codex("SessionStart", { source: "startup", model: "gpt-5.6-luna" });
    expect(store.getSession("cx")!.agent).toBe("codex");
    ev("SessionStart", {}, "cl");
    expect(store.getSession("cl")!.agent).toBe("claude");
  });

  it("apply_patch : sous-titre et demande lisibles", () => {
    const patch = "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** Add File: src/new.ts\n+x\n*** End Patch";
    codex("PreToolUse", { tool_name: "apply_patch", tool_input: { command: patch }, tool_use_id: "p1" });
    expect(store.getSession("cx")!.subtitle).toBe("Modification de app.ts et 1 autre");
    const { pending } = store.openPermission({ ...base("cx"), hook_event_name: "PermissionRequest", _agent: "codex", tool_name: "apply_patch", tool_input: { command: patch } })!;
    if (pending.kind !== "permission") throw new Error();
    expect(pending.headline).toBe("Veut modifier app.ts et 1 autre");
    expect(pending.detail).toBe("src/app.ts\nsrc/new.ts");
  });

  it("demande Codex : délai court (60 s) et jamais de « toujours autoriser »", async () => {
    codex("SessionStart", {});
    const { pending, result } = store.openPermission({
      ...base("cx"),
      hook_event_name: "PermissionRequest",
      _agent: "codex",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow" }],
    })!;
    if (pending.kind !== "permission") throw new Error();
    expect(pending.alwaysLabel).toBeUndefined();
    expect(pending.expiresAt - pending.createdAt).toBe(60_000);
    t += 61_000;
    store.tick();
    await expect(result).resolves.toBeNull(); // rend la main au dialogue de VS Code
  });
});

describe("agents internes de Claude Code", () => {
  it("SubagentStart / SubagentStop sans agent_type (suggestions de prompt…) sont ignorés", () => {
    ev("UserPromptSubmit", { prompt: "go" });
    ev("SubagentStart", { agent_id: "internal-1", agent_type: "" });
    ev("SubagentStop", { agent_id: "internal-1", agent_type: "", last_assistant_message: "publie la 0.3.0" });
    ev("SubagentStop", { agent_id: "internal-2", agent_type: "", last_assistant_message: "vas-y" });
    expect(store.getSession("s1")!.subagents).toEqual([]);
    ev("SubagentStart", { agent_id: "real", agent_type: "Explore" });
    expect(store.getSession("s1")!.subagents.map((a) => a.type)).toEqual(["Explore"]);
  });
});

describe("dossier du projet", () => {
  it("fixé au démarrage, pas écrasé par les cd de l'agent ; clé lue dans le chemin du transcript", () => {
    store.ingest({
      session_id: "p1",
      cwd: "/Users/a/Workspace/hrx-prototype",
      transcript_path: "/Users/a/.claude/projects/-Users-a-Workspace-hrx-prototype/p1.jsonl",
      hook_event_name: "SessionStart",
    });
    store.ingest({ session_id: "p1", cwd: "/private/tmp/claude-501/x/scratchpad/pw", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
    const s = store.getSession("p1")!;
    expect(s.cwd).toBe("/private/tmp/claude-501/x/scratchpad/pw");
    expect(s.projectDir).toBe("/Users/a/Workspace/hrx-prototype");
    expect(s.projectKey).toBe("-Users-a-Workspace-hrx-prototype");
  });
  it("chemin de transcript Windows", () => {
    expect(projectKeyFromTranscript(String.raw`C:\Users\adrie\.claude\projects\c--Users-adrie-W-P\abc.jsonl`)).toBe("c--Users-adrie-W-P");
    expect(projectKeyFromTranscript("/home/u/.codex/sessions/2026/x.jsonl")).toBeUndefined();
  });
});
