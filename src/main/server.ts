// Serveur HTTP local qui reçoit les hooks Claude Code.
// - Écoute uniquement sur 127.0.0.1.
// - Exige l'en-tête X-FMA-Token (comparaison à temps constant), sinon 401.
// - /hook/event       : événement non bloquant, réponse 200 vide immédiate.
// - /hook/permission  : PermissionRequest, la requête reste ouverte jusqu'à la décision.
// - /hook/question    : PreToolUse(AskUserQuestion), mécanisme alternatif (voir D3).
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { HookInput, SessionStore } from "./store";

export const DEFAULT_PORT = 47821;
const MAX_BODY = 20 * 1024 * 1024;

export interface HookServerOptions {
  store: SessionStore;
  token: string;
  port?: number;
  host?: string;
  log?: (msg: string) => void;
}

export interface HookServer {
  listen(): Promise<number>;
  close(): Promise<void>;
  readonly port: number;
}

function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Connection: close : pas de réutilisation de connexion keep-alive. Évite la course
// « le client réutilise un socket que le serveur vient de fermer » (ECONNRESET),
// qui ferait perdre silencieusement un hook.
function send(res: http.ServerResponse, status: number, body?: object) {
  if (res.writableEnded || res.destroyed) return;
  if (body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Connection: "close" });
    res.end(data);
  } else {
    res.writeHead(status, { "Content-Length": 0, Connection: "close" });
    res.end();
  }
}

export function createHookServer(opts: HookServerOptions): HookServer {
  const { store, token } = opts;
  const host = opts.host ?? "127.0.0.1";
  const log = opts.log ?? (() => {});
  let port = opts.port ?? DEFAULT_PORT;

  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];

    if (req.method === "GET" && url === "/health") return send(res, 200, { app: "FollowMyAgents", ok: true });
    // Un navigateur envoie toujours Origin : on refuse toute requête venant d'une page web.
    if (req.headers.origin) return send(res, 403);
    if (!tokenMatches(req.headers["x-fma-token"], token)) {
      req.resume();
      return send(res, 401);
    }
    if (req.method !== "POST" || !["/hook/event", "/hook/permission", "/hook/question"].includes(url)) {
      req.resume();
      return send(res, 404);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        aborted = true;
        send(res, 413);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      let ev: HookInput;
      try {
        ev = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!ev || typeof ev !== "object") throw new Error("not an object");
      } catch {
        return send(res, 400);
      }
      try {
        handle(url, ev, res);
      } catch (e) {
        log(`hook error: ${(e as Error).message}`);
        send(res, 200);
      }
    });
  });

  function handle(url: string, ev: HookInput, res: http.ServerResponse) {
    if (url === "/hook/event") {
      store.ingest(ev);
      return send(res, 200);
    }
    let opened: ReturnType<SessionStore["openPermission"]> = null;
    if (url === "/hook/permission") {
      opened = store.openPermission(ev);
    } else if (url === "/hook/question") {
      if (ev.tool_name === "AskUserQuestion") opened = store.openQuestion(ev, "pretooluse");
    }
    if (!opened) return send(res, 200);
    const { pending, result } = opened;
    // Claude Code ferme la requête quand l'utilisateur répond dans VS Code (Phase 0, b-2).
    res.on("close", () => {
      if (!res.writableEnded) store.cancel(pending.id, { type: "closed" });
    });
    result.then((body) => send(res, 200, body ?? undefined));
  }

  // Les requêtes en attente peuvent durer 10 min : pas de timeout côté Node.
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  return {
    get port() {
      return port;
    },
    listen() {
      return new Promise<number>((resolve, reject) => {
        const onError = (e: Error) => reject(e);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          port = (server.address() as AddressInfo).port;
          resolve(port);
        });
      });
    },
    async close() {
      store.releaseAll();
      // laisse partir les réponses vides des demandes relâchées avant de couper
      await new Promise((r) => setTimeout(r, 20));
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
