import type {Polygon} from './geometry';

// Tuple coordinates are normalized to width/height; the affine form supports
// geometry constructions where a vertical distance depends on paper width.
export type FoldPoint =
  | [number, number]
  | {x: [number, number]; y: [number, number]; offset?: [number, number]}
  | {bisector: {vertex: FoldPoint; through: FoldPoint; other: FoldPoint; atY: number}};

export type FoldBoundary = {a: FoldPoint; b: FoldPoint; sign: 1 | -1};

export type FoldOperation = FoldBoundary & {
  kind: 'valley' | 'mountain';
  diagonal?: boolean;
  region?: FoldBoundary[];
  layer?: 'all' | 'top';
  flip?: boolean;
  /** Place the folded paper below this many of the remaining top layer groups. */
  tuckUnder?: number;
};

export type FoldStep = FoldOperation & {
  title: string;
  description: string;
  unfold?: boolean;
  unfoldToStep?: number;
  openToStep?: number;
  /** 3.10:展翼时使用的独立翼根折线(可与折痕本身不同);允许倾斜翼根。 */
  openRoot?: FoldBoundary;
  operations?: FoldOperation[];
};

export type Layer = Polygon;
export type FoldOp = FoldStep;

export function pt(x: number, yWidth: number, yHeight = 0, offsetY = 0): FoldPoint {
  return {x: [x, 0], y: [yWidth, yHeight], offset: [0, offsetY]};
}
