/**
 * 确定性风场与随机源(治理 1.2:从 competition.ts 迁出的无依赖叶子模块,
 * 打断 accuracy ↔ competition 的循环导入——该循环在 templates 抽取改变
 * 模块求值顺序后引发 TDZ 初始化崩溃)。
 */

/** Deterministic Mulberry32 PRNG for reproducible competition wind fields. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-round locked wind: head/tail along +x, crosswind along +z. */
export type RoundWind = {head: number; cross: number};

/**
 * Generate deterministic per-round winds in [-3, +3] m/s (0.5 m/s steps).
 * The first draw of each round is the head/tail component and preserves the
 * historical single-draw sequence; the second draw is the crosswind (v5).
 */
export function generateRoundWinds(seed: number, rounds = 3): RoundWind[] {
  const rand = seededRandom(seed);
  const winds: RoundWind[] = [];
  for (let i = 0; i < rounds; i++) {
    const head = (Math.floor(rand() * 13) - 6) * 0.5;
    const cross = (Math.floor(rand() * 13) - 6) * 0.5;
    winds.push({head, cross});
  }
  return winds;
}
