import { describe, expect, it, vi } from "vitest";
import { CodexQuotaWatcher, parseCodexRateLimits, windowLabel } from "../src/main/codex-quota";

// réponse réelle (offre free, 2026-11-19), compte masqué
const realFree = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 2, windowDurationMins: 43200, resetsAt: 1797713464 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: null },
    planType: "free",
    rateLimitReachedType: null,
  },
  accountId: "<masqué>",
};

describe("parseCodexRateLimits", () => {
  it("offre free : une fenêtre de 30 jours", () => {
    expect(parseCodexRateLimits(realFree)).toEqual({
      plan: "free",
      limits: [{ kind: "codex_primary", label: "30 jours", percent: 2, severity: "normal", resetsAt: 1797713464000 }],
    });
  });
  it("offre payante : 5 h puis semaine, triées par durée", () => {
    const r = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: 1 },
        secondary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 2 },
        planType: "plus",
      },
    });
    expect(r.limits.map((l) => [l.label, l.percent, l.severity])).toEqual([
      ["5 h", 40, "normal"],
      ["Semaine", 80, "warning"],
    ]);
  });
  it("limite atteinte → critical", () => {
    const r = parseCodexRateLimits({ ordinaryUsageAllowed: false, rateLimits: { primary: { usedPercent: 30, windowDurationMins: 300 } } });
    expect(r.limits[0].severity).toBe("critical");
  });
  it("réponse vide → aucune limite", () => {
    expect(parseCodexRateLimits({})).toEqual({ limits: [] });
  });
  it("libellés des fenêtres", () => {
    expect([300, 1440, 10080, 43200, null].map((m) => windowLabel(m))).toEqual(["5 h", "24 h", "Semaine", "30 jours", "Limite"]);
  });
});

describe("CodexQuotaWatcher", () => {
  it("Codex absent → disabled (rien à afficher), sans lancer de processus", async () => {
    const read = vi.fn();
    const w = new CodexQuotaWatcher({ candidates: () => ["/nope/codex"], exists: () => false, read });
    expect((await w.refresh()).state).toBe("disabled");
    expect(read).not.toHaveBeenCalled();
  });
  it("lit les limites via le binaire Codex trouvé", async () => {
    const read = vi.fn(async () => realFree);
    const w = new CodexQuotaWatcher({ candidates: () => ["/a/codex", "/b/codex"], exists: (p) => p === "/b/codex", read, now: () => 5 });
    const v = await w.refresh();
    expect(read).toHaveBeenCalledWith("/b/codex");
    expect(v).toMatchObject({ state: "ok", plan: "free", fetchedAt: 5 });
  });
  it("panne → garde les derniers chiffres (stale)", async () => {
    let n = 0;
    const read = vi.fn(async () => {
      if (n++ === 0) return realFree;
      throw new Error("délai dépassé");
    });
    const w = new CodexQuotaWatcher({ candidates: () => ["/c"], exists: () => true, read });
    await w.refresh();
    const v = await w.refresh();
    expect(v.state).toBe("stale");
    expect(v.limits).toHaveLength(1);
  });
});
