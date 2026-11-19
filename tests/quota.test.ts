import { describe, expect, it, vi } from "vitest";
import { QuotaWatcher, USAGE_URL, parseUsage, readClaudeToken } from "../src/main/quota";

const creds = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ claudeAiOauth: { accessToken: "tok", refreshToken: "r", expiresAt: 2_000_000_000_000, subscriptionType: "pro", ...over } });

// réponse réelle (2026-11-19), raccourcie
const real = {
  five_hour: { utilization: 21.0, resets_at: "2026-11-20T01:30:00.006098+00:00" },
  seven_day: { utilization: 20.0, resets_at: "2026-11-21T01:00:00.006123+00:00" },
  limits: [
    { kind: "session", group: "session", percent: 21, severity: "normal", resets_at: "2026-11-20T01:30:00.652433+00:00", is_active: true },
    { kind: "weekly_all", group: "weekly", percent: 20, severity: "normal", resets_at: "2026-11-21T01:00:00.652453+00:00", is_active: false },
  ],
};

describe("parseUsage", () => {
  it("lit le tableau limits (format actuel)", () => {
    expect(parseUsage(real)).toEqual([
      { kind: "session", label: "Session", percent: 21, severity: "normal", resetsAt: Date.parse("2026-11-20T01:30:00.652433+00:00") },
      { kind: "weekly_all", label: "Semaine", percent: 20, severity: "normal", resetsAt: Date.parse("2026-11-21T01:00:00.652453+00:00") },
    ]);
  });
  it("se rabat sur five_hour / seven_day (ancien format) et calcule la sévérité", () => {
    const r = parseUsage({ five_hour: { utilization: 92, resets_at: "2026-11-20T01:30:00Z" }, seven_day: { utilization: 80 } });
    expect(r.map((l) => [l.label, l.percent, l.severity])).toEqual([
      ["Session", 92, "critical"],
      ["Semaine", 80, "warning"],
    ]);
  });
  it("format inconnu → aucune limite", () => {
    expect(parseUsage({ foo: 1 })).toEqual([]);
    expect(parseUsage(null)).toEqual([]);
  });
});

describe("readClaudeToken", () => {
  it("Windows / Linux : lit ~/.claude/.credentials.json", async () => {
    const readFile = vi.fn(() => creds());
    expect(await readClaudeToken({ platform: "win32", home: "/h", readFile })).toEqual({ accessToken: "tok", expiresAt: 2_000_000_000_000, subscription: "pro" });
    expect(readFile.mock.calls[0][0]).toMatch(/\.claude[\\/]\.credentials\.json$/);
  });
  it("macOS : trousseau si pas de fichier", async () => {
    const keychain = vi.fn(async () => creds({ accessToken: "kc" }) + "\n");
    const t = await readClaudeToken({
      platform: "darwin",
      home: "/h",
      readFile: () => {
        throw new Error("ENOENT");
      },
      keychain,
    });
    expect(t?.accessToken).toBe("kc");
  });
  it("aucune source → null", async () => {
    expect(await readClaudeToken({ platform: "win32", readFile: () => "{}" })).toBeNull();
  });
});

function watcher(fetchImpl: typeof fetch, now = 1_000, credsText = creds()) {
  return new QuotaWatcher({ platform: "win32", home: "/h", readFile: () => credsText, fetch: fetchImpl, now: () => now });
}

describe("QuotaWatcher", () => {
  it("appelle l'API d'usage avec le jeton, en lecture seule", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(real), { status: 200 })) as unknown as typeof fetch;
    const v = await watcher(f).refresh();
    expect(v).toMatchObject({ state: "ok", plan: "pro" });
    expect(v.limits).toHaveLength(2);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe(USAGE_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.method ?? "GET").toBe("GET");
  });
  it("jeton expiré : n'appelle pas l'API, ne tente aucun renouvellement", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const v = await watcher(f, 5_000, creds({ expiresAt: 1_000 })).refresh();
    expect(v.state).toBe("expired");
    expect(f).not.toHaveBeenCalled();
  });
  it("401 → expired ; panne réseau → garde les derniers chiffres (stale)", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify(real), { status: 200 });
      if (n === 2) throw new Error("offline");
      return new Response("", { status: 401 });
    }) as unknown as typeof fetch;
    const w = watcher(f);
    await w.refresh();
    const v2 = await w.refresh();
    expect(v2.state).toBe("stale");
    expect(v2.limits).toHaveLength(2);
    expect((await w.refresh()).state).toBe("expired");
  });
  it("pas de connexion Claude Code → unavailable", async () => {
    const v = await watcher(vi.fn() as unknown as typeof fetch, 1_000, "{}").refresh();
    expect(v.state).toBe("unavailable");
  });
});
