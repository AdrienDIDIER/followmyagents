import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHookServer, type HookServer } from "../src/main/server";
import { SessionStore } from "../src/main/store";

const TOKEN = "t".repeat(64);
let store: SessionStore;
let server: HookServer;
let port: number;

beforeEach(async () => {
  store = new SessionStore({ pendingTimeoutSec: () => 120 });
  server = createHookServer({ store, token: TOKEN, port: 0 });
  port = await server.listen();
});
afterEach(async () => {
  await server.close();
});

interface Res {
  status: number;
  body: string;
}
function post(path: string, body: unknown, headers: Record<string, string> = { "X-FMA-Token": TOKEN }, signal?: AbortSignal) {
  return new Promise<Res>((resolve, reject) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", ...headers }, signal },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: b }));
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}
const waitFor = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const perm = {
  session_id: "s1",
  transcript_path: "/x.jsonl",
  cwd: "/work/p",
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: { command: "rm -rf build", description: "Clean" },
};

describe("sécurité", () => {
  it("écoute uniquement sur 127.0.0.1", () => {
    expect(port).toBeGreaterThan(0);
  });

  it("rejette une requête sans token (401)", async () => {
    const r = await post("/hook/event", { session_id: "s1", hook_event_name: "Stop" }, {});
    expect(r.status).toBe(401);
    expect(store.getSessions()).toHaveLength(0);
  });

  it("rejette un mauvais token (401), y compris de même longueur", async () => {
    expect((await post("/hook/event", {}, { "X-FMA-Token": "nope" })).status).toBe(401);
    expect((await post("/hook/permission", perm, { "X-FMA-Token": "u".repeat(64) })).status).toBe(401);
    expect(store.getPendings()).toHaveLength(0);
  });

  it("rejette les requêtes venant d'un navigateur (Origin) même avec le token", async () => {
    const r = await post("/hook/permission", perm, { "X-FMA-Token": TOKEN, Origin: "http://evil.example" });
    expect(r.status).toBe(403);
  });

  it("404 sur une route inconnue, 400 sur du JSON invalide", async () => {
    expect((await post("/hook/other", {})).status).toBe(404);
    expect((await post("/hook/event", "{nope")).status).toBe(400);
  });

  it("/health répond sans données sensibles", async () => {
    const r = await new Promise<Res>((resolve) =>
      http.get({ host: "127.0.0.1", port, path: "/health" }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: b }));
      }),
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ app: "FollowMyAgents", ok: true });
  });
});

describe("hooks", () => {
  it("/hook/event répond 200 vide immédiatement et met à jour le store", async () => {
    const r = await post("/hook/event", { session_id: "s1", cwd: "/w/p", hook_event_name: "UserPromptSubmit", prompt: "Hello" });
    expect(r).toEqual({ status: 200, body: "" });
    expect(store.getSession("s1")!.state).toBe("working");
  });

  it("/hook/permission garde la requête ouverte jusqu'à la décision (allow)", async () => {
    const pending = post("/hook/permission", perm);
    await waitFor(() => store.getPendings().length === 1);
    store.answer(store.getPendings()[0].id, { kind: "allow" });
    const r = await pending;
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
  });

  it("« In VS Code » → 200 sans corps", async () => {
    const pending = post("/hook/permission", perm);
    await waitFor(() => store.getPendings().length === 1);
    store.answer(store.getPendings()[0].id, { kind: "vscode" });
    expect(await pending).toEqual({ status: 200, body: "" });
  });

  it("fermeture de la connexion par Claude Code → la demande est retirée (D5)", async () => {
    const ac = new AbortController();
    const pending = post("/hook/permission", perm, { "X-FMA-Token": TOKEN }, ac.signal).catch(() => null);
    await waitFor(() => store.getPendings().length === 1);
    ac.abort();
    await waitFor(() => store.getPendings().length === 0);
    expect(store.getSession("s1")!.subtitle).toBe("Répondu dans VS Code");
    await pending;
  });

  it("répond à une question via /hook/permission (AskUserQuestion)", async () => {
    const q = { question: "Couleur ?", header: "C", options: [{ label: "Rouge" }, { label: "Bleu" }] };
    const pending = post("/hook/permission", { ...perm, tool_name: "AskUserQuestion", tool_input: { questions: [q] } });
    await waitFor(() => store.getPendings().length === 1);
    store.answer(store.getPendings()[0].id, { kind: "answers", answers: { "Couleur ?": "Bleu" } });
    const body = JSON.parse((await pending).body);
    expect(body.hookSpecificOutput.decision.updatedInput.answers).toEqual({ "Couleur ?": "Bleu" });
    expect(body.hookSpecificOutput.decision.updatedInput.questions).toEqual([q]);
  });

  it("/hook/question (PreToolUse) : ignore les autres outils, répond aux questions", async () => {
    expect(await post("/hook/question", { ...perm, hook_event_name: "PreToolUse" })).toEqual({ status: 200, body: "" });
    const q = { question: "Couleur ?", options: [{ label: "Rouge" }] };
    const pending = post("/hook/question", { ...perm, hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [q] } });
    await waitFor(() => store.getPendings().length === 1);
    store.answer(store.getPendings()[0].id, { kind: "answers", answers: { "Couleur ?": "Rouge" } });
    const body = JSON.parse((await pending).body);
    expect(body.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "allow" });
  });

  it("arrêt du serveur : les demandes ouvertes reçoivent une réponse vide", async () => {
    const pending = post("/hook/permission", perm);
    await waitFor(() => store.getPendings().length === 1);
    await server.close();
    const r = await pending;
    expect(r).toEqual({ status: 200, body: "" });
    server = createHookServer({ store, token: TOKEN, port: 0 });
    await server.listen();
  });

  it("met à jour l'état en moins de 50 ms par événement", async () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      await post("/hook/event", { session_id: "s" + (i % 4), cwd: "/w", hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: `/f${i}` } });
    }
    expect((performance.now() - t0) / 20).toBeLessThan(50);
    expect(store.getSessions()).toHaveLength(4);
  });
});

describe("connexions", () => {
  it("répond avec Connection: close (pas de socket keep-alive réutilisé)", async () => {
    const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/hook/event", method: "POST", headers: { "X-FMA-Token": TOKEN } },
        (res) => {
          res.resume();
          resolve(res.headers);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ session_id: "k", hook_event_name: "Stop" }));
    });
    expect(headers.connection).toBe("close");
  });

  it("enchaîne 30 requêtes espacées sans ECONNRESET", async () => {
    for (let i = 0; i < 30; i++) {
      const r = await post("/hook/event", { session_id: "k", hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} });
      expect(r.status).toBe(200);
    }
  });
});
