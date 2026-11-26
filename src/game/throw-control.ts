export const THROW_BOUNDS = {
  minAngle: 0,
  maxAngle: 75,
  minSpeed: 6,
  maxSpeed: 28,
  minDragPx: 22,
  maxDragPx: 210,
} as const;

export type CanvasPoint = {x: number; y: number};

export type DragThrowResult = {
  angle: number;
  speed: number;
  chargeRatio: number;
  ready: boolean;
  dragDist: number;
  pullVector: CanvasPoint;
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Map a slingshot pull-back drag from `anchor` to `pointer` (in 960x600 canvas
 * coordinates, where +x is right and +y is down) into launch angle (deg) and
 * release speed (m/s), strictly clamped to THROW_BOUNDS.
 */
export function mapDragToThrow(anchor: CanvasPoint, pointer: CanvasPoint): DragThrowResult {
  const pullX = pointer.x - anchor.x;
  const pullY = pointer.y - anchor.y;
  // Pull back (-x) and down (+y) to aim forward (+x) and upward (+y in world space)
  const aimX = -pullX;
  const aimY = pullY;
  const dragDist = Math.hypot(aimX, aimY);

  if (dragDist < THROW_BOUNDS.minDragPx) {
    return {
      angle: 0,
      speed: THROW_BOUNDS.minSpeed,
      chargeRatio: 0,
      ready: false,
      dragDist,
      pullVector: {x: pullX, y: pullY},
    };
  }

  // Only allow forward-aiming pulls (dragging right of anchor clamps to 0° horizontal or cancels)
  const forwardAimX = Math.max(1e-3, aimX);
  const rawAngleDeg = aimX <= -12 ? 0 : (Math.atan2(Math.max(0, aimY), forwardAimX) * 180) / Math.PI;
  const angle = Math.round(clamp(rawAngleDeg, THROW_BOUNDS.minAngle, THROW_BOUNDS.maxAngle));

  const chargeRatio = clamp(
    (dragDist - THROW_BOUNDS.minDragPx) / (THROW_BOUNDS.maxDragPx - THROW_BOUNDS.minDragPx),
    0,
    1,
  );
  const speed = Math.round(
    clamp(
      THROW_BOUNDS.minSpeed + chargeRatio * (THROW_BOUNDS.maxSpeed - THROW_BOUNDS.minSpeed),
      THROW_BOUNDS.minSpeed,
      THROW_BOUNDS.maxSpeed,
    ),
  );

  return {
    angle,
    speed,
    chargeRatio,
    ready: aimX > 8,
    dragDist,
    pullVector: {x: pullX, y: pullY},
  };
}
