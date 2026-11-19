// Petit carillon discret (deux notes), synthétisé : aucun fichier audio à embarquer.
let ctx: AudioContext | null = null;

export function chime() {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime + 0.01;
    for (const [i, f] of [880, 1318.5].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const start = t + i * 0.11;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.09, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(start);
      o.stop(start + 0.5);
    }
  } catch {
    /* audio indisponible */
  }
}
