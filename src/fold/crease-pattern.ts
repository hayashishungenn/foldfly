import {EPS_AREA, EPS_CLIP, EPS_INSIDE, EPS_LINE, EPS_MATCH, EPS_VECTOR} from './geometry-constants';
import {line, replay, type Sheet} from './engine';
import {signedArea, side, type Point, type Polygon} from './geometry';
import type {FoldStep} from './types';

export type FoldKind = FoldStep['kind'];

export type CreaseSegment = {
  stepIndex: number;
  kind: FoldKind;
  precrease: boolean;
  start: Point;
  end: Point;
  length: number;
};

export type FoldStackStats = {
  step: number;
  totalSteps: number;
  faceCount: number;
  groupCount: number;
  noseLayers: number;
  maxStackLayers: number;
  creaseCount: number;
  valleyCount: number;
  mountainCount: number;
};

export type CreaseTopology = {
  totalLengthM: number;
  activeValleyCount: number;
  activeMountainCount: number;
  precreaseCount: number;
  interiorVertexCount: number;
  interiorVertices: Point[];
  mirrorSymmetric: boolean;
  maekawaDelta: number;
};

/**
 * Clip an infinite line through (a, b) against a convex polygon, returning the
 * entry and exit points [start, end] if the line intersects the polygon interior.
 * Adapted from the parametric half-plane clipping approach in TaoweNlin/paperfold-lab.
 */
export function clipLineToPolygon(a: Point, b: Point, polygon: Polygon): [Point, Point] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lineLen = Math.hypot(dx, dy);
  if (lineLen < EPS_VECTOR || polygon.length < 3) return null;

  const orientation = signedArea(polygon) >= 0 ? 1 : -1;
  let minT = -1e6;
  let maxT = 1e6;

  for (let i = 0; i < polygon.length; i++) {
    const e0 = polygon[i];
    const e1 = polygon[(i + 1) % polygon.length];
    const ex = e1.x - e0.x;
    const ey = e1.y - e0.y;
    // Signed distance proxy: (e1 - e0) x (p(t) - e0) * orientation >= 0
    // p(t) = a + t * (b - a)
    const distA = (ex * (a.y - e0.y) - ey * (a.x - e0.x)) * orientation;
    const rate = (ex * dy - ey * dx) * orientation;

    if (Math.abs(rate) < EPS_VECTOR) {
      if (distA < -EPS_CLIP) return null;
      continue;
    }
    const tHit = -distA / rate;
    if (rate > 0) {
      minT = Math.max(minT, tHit);
    } else {
      maxT = Math.min(maxT, tHit);
    }
    if (maxT - minT < EPS_CLIP) return null;
  }

  const start = {x: a.x + dx * minT, y: a.y + dy * minT};
  const end = {x: a.x + dx * maxT, y: a.y + dy * maxT};
  if (Math.hypot(end.x - start.x, end.y - start.y) < EPS_LINE) return null;
  return [start, end];
}

/** Test whether a point lies inside or on the boundary of a convex polygon. */
export function pointInPolygon(pt: Point, polygon: Polygon): boolean {
  if (polygon.length < 3) return false;
  const orientation = signedArea(polygon) >= 0 ? 1 : -1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (side(pt, a, b) * orientation < -EPS_INSIDE) return false;
  }
  return true;
}

/** Count how many paper layers cover a 2D point in the current folded stack. */
export function layerCountAt(layers: readonly Polygon[], pt: Point): number {
  let count = 0;
  for (const poly of layers) {
    if (pointInPolygon(pt, poly)) count++;
  }
  return count;
}

/**
 * Extract the cumulative crease segments up to `upToStep` clipped to the sheet boundary,
 * marking creases that were later unfolded as `precrease: true`.
 */
export function extractCreasePattern(
  sheet: Sheet,
  program: readonly FoldStep[],
  upToStep = program.length,
): CreaseSegment[] {
  const limit = Math.max(0, Math.min(upToStep, program.length));
  const sheetPoly: Polygon = [
    {x: 0, y: 0},
    {x: sheet.width, y: 0},
    {x: sheet.width, y: sheet.height},
    {x: 0, y: sheet.height},
  ];

  // Track which steps were subsequently unfolded so we can distinguish active vs auxiliary creases
  const unfoldedSteps = new Set<number>();
  for (let i = 0; i < limit; i++) {
    const step = program[i];
    if (step.unfold && i > 0) {
      unfoldedSteps.add(i - 1);
    }
    if (step.unfoldToStep !== undefined) {
      for (let k = step.unfoldToStep; k < i; k++) {
        unfoldedSteps.add(k);
      }
    }
  }

  const segments: CreaseSegment[] = [];
  let foldedInHalf = false;
  for (let i = 0; i < limit; i++) {
    const step = program[i];
    if (step.unfold || step.unfoldToStep !== undefined) continue;
    const ops = step.operations ?? [step];
    for (const op of ops) {
      if (op.flip) continue;
      const [a, b] = line(op, sheet);
      const clipped = clipLineToPolygon(a, b, sheetPoly);
      if (!clipped) continue;
      const [start, end] = clipped;
      const len = Math.hypot(end.x - start.x, end.y - start.y);
      const w = sheet.width;
      const mStart = {x: w - start.x, y: start.y};
      const mEnd = {x: w - end.x, y: end.y};
      const isCenterline =
        Math.hypot(mStart.x - start.x, mStart.y - start.y) < EPS_MATCH / 10 &&
        Math.hypot(mEnd.x - end.x, mEnd.y - end.y) < 1e-4;

      segments.push({
        stepIndex: i,
        kind: op.kind,
        precrease: unfoldedSteps.has(i),
        start,
        end,
        length: len,
      });

      // When a fold is performed while the fuselage is folded in half along the centerline,
      // it creases both halves of the unfolded sheet symmetrically across x = width / 2.
      if ((foldedInHalf || step.openToStep !== undefined) && !isCenterline) {
        segments.push({
          stepIndex: i,
          kind: op.kind,
          precrease: unfoldedSteps.has(i),
          start: mStart,
          end: mEnd,
          length: len,
        });
      }

      if (isCenterline && !unfoldedSteps.has(i)) {
        foldedInHalf = true;
      }
    }
  }
  return segments;
}

/**
 * Compute paper stack thickness and crease statistics at a given fold step.
 */
export function foldStackStats(
  sheet: Sheet,
  program: readonly FoldStep[],
  step: number,
): FoldStackStats {
  const clamped = Math.max(0, Math.min(step, program.length));
  const state = replay(sheet, clamped, program);
  const layers = state.layers;
  const groups = state.layerGroups ?? layers.map((_, i) => i);
  const creases = extractCreasePattern(sheet, program, clamped);

  // Sample representative points across the folded geometry (centroids of faces + centerline samples)
  const samplePoints: Point[] = [];
  const midX = sheet.width / 2;
  for (const fracY of [0.15, 0.28, 0.42, 0.58, 0.75, 0.88]) {
    samplePoints.push({x: midX - 0.008, y: sheet.height * fracY});
    samplePoints.push({x: midX + 0.008, y: sheet.height * fracY});
  }
  for (const poly of layers) {
    if (poly.length >= 3) {
      const cx = poly.reduce((s, v) => s + v.x, 0) / poly.length;
      const cy = poly.reduce((s, v) => s + v.y, 0) / poly.length;
      samplePoints.push({x: cx, y: cy});
    }
  }

  let maxStackLayers = 1;
  for (const pt of samplePoints) {
    maxStackLayers = Math.max(maxStackLayers, layerCountAt(layers, pt));
  }

  // Nose layer thickness near the forward-most part of the centerline
  const allVertices = layers.flat();
  const minY = allVertices.length ? Math.min(...allVertices.map(v => v.y)) : 0;
  const maxY = allVertices.length ? Math.max(...allVertices.map(v => v.y)) : sheet.height;
  const noseSampleY = minY + (maxY - minY) * 0.18;
  const noseLayers = Math.max(
    1,
    layerCountAt(layers, {x: midX - 0.006, y: noseSampleY}),
    layerCountAt(layers, {x: midX + 0.006, y: noseSampleY}),
  );

  return {
    step: clamped,
    totalSteps: program.length,
    faceCount: layers.length,
    groupCount: new Set(groups).size,
    noseLayers,
    maxStackLayers,
    creaseCount: creases.length,
    valleyCount: creases.filter(c => c.kind === 'valley').length,
    mountainCount: creases.filter(c => c.kind === 'mountain').length,
  };
}

/**
 * Analyze the geometric and origametric topology of the crease pattern
 * (Maekawa mountain/valley count, interior vertex intersections, bilateral symmetry,
 * and total crease length, per Demaine & Lang's Geometric Folding Algorithms).
 */
export function analyzeCreaseTopology(
  sheet: Sheet,
  program: readonly FoldStep[],
  upToStep = program.length,
): CreaseTopology {
  const segments = extractCreasePattern(sheet, program, upToStep);
  const totalLengthM = segments.reduce((sum, s) => sum + s.length, 0);
  const activeValleyCount = segments.filter(s => !s.precrease && s.kind === 'valley').length;
  const activeMountainCount = segments.filter(s => !s.precrease && s.kind === 'mountain').length;
  const precreaseCount = segments.filter(s => s.precrease).length;

  // Find pairwise interior intersections of crease segments
  const interiorVertices: Point[] = [];
  const eps = EPS_MATCH / 10;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      const d1x = a.end.x - a.start.x;
      const d1y = a.end.y - a.start.y;
      const d2x = b.end.x - b.start.x;
      const d2y = b.end.y - b.start.y;
      const denom = d1x * d2y - d1y * d2x;
      if (Math.abs(denom) < EPS_VECTOR) continue;

      const dx = b.start.x - a.start.x;
      const dy = b.start.y - a.start.y;
      const t = (dx * d2y - dy * d2x) / denom;
      const u = (dx * d1y - dy * d1x) / denom;
      if (t < -EPS_MATCH / 2 || t > 1 + EPS_MATCH / 2 || u < -EPS_MATCH / 2 || u > 1 + EPS_MATCH / 2) continue;

      const px = a.start.x + t * d1x;
      const py = a.start.y + t * d1y;
      if (px <= eps || px >= sheet.width - eps || py <= eps || py >= sheet.height - eps) continue;

      if (!interiorVertices.some(v => Math.hypot(v.x - px, v.y - py) < EPS_MATCH * 80)) {
        interiorVertices.push({x: px, y: py});
      }
    }
  }

  // Bilateral mirror symmetry test across x = sheet.width / 2
  const w = sheet.width;
  const matchesMirror = (seg: CreaseSegment): boolean => {
    const ms = {x: w - seg.start.x, y: seg.start.y};
    const me = {x: w - seg.end.x, y: seg.end.y};
    return segments.some(
      other =>
        other.kind === seg.kind &&
        ((Math.hypot(other.start.x - ms.x, other.start.y - ms.y) < EPS_MATCH / 10 &&
          Math.hypot(other.end.x - me.x, other.end.y - me.y) < 1e-3) ||
          (Math.hypot(other.start.x - me.x, other.start.y - me.y) < 1e-3 &&
            Math.hypot(other.end.x - ms.x, other.end.y - ms.y) < 1e-3)),
    );
  };
  const mirrorSymmetric = segments.every(matchesMirror);

  return {
    totalLengthM,
    activeValleyCount,
    activeMountainCount,
    precreaseCount,
    interiorVertexCount: interiorVertices.length,
    interiorVertices,
    mirrorSymmetric,
    maekawaDelta: Math.abs(activeMountainCount - activeValleyCount),
  };
}
