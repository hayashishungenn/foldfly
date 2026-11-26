import type {Flight} from '../aero/integrator';
import {flightBounds} from './flight-view';
import {playback} from './playback';

export type CameraViewport = {
  minX: number;
  maxX: number;
  maxY: number;
  sy: number;
  mapX: (x: number) => number;
  mapY: (y: number) => number;
  isFollowing: boolean;
};

/**
 * Compute the 2D flight camera viewport.
 * - During active flight with `followCamera = true`, smoothly follows the plane
 *   with horizontal look-ahead so ground ticks, grass, and clouds scroll by.
 * - Before launch in competition mode (`hidePreview = true`), frames a fixed
 *   launch runway without spoiling the landing distance.
 * - Otherwise frames the full overview bounds of preview/actual/ghost flights.
 */
export function computeFlightCamera(
  preview: Flight,
  actual: Flight | null,
  ghost: Flight | null,
  elapsed: number,
  options: {followCamera?: boolean; hidePreview?: boolean} = {},
): CameraViewport {
  const {followCamera = true, hidePreview = false} = options;

  if (actual && followCamera) {
    const frame = playback(actual, elapsed);
    if (!frame.finished) {
      const px = frame.sample.x;
      const py = frame.sample.y;
      // Compute dynamic window span (22–34 m) so slow gliders & fast darts both feel responsive
      const windowSpan = Math.min(34, Math.max(22, 22 + px * 0.14));
      const minX = Math.max(-2, px - windowSpan * 0.3);
      const maxX = minX + windowSpan;
      const maxY = Math.max(6.5, frame.height * 1.28, py * 1.45);
      const scaleX = 840 / Math.max(1, maxX - minX);
      const sy = 460 / maxY;
      return {
        minX,
        maxX,
        maxY,
        sy,
        mapX: (x: number) => 60 + (x - minX) * scaleX,
        mapY: (y: number) => 520 - y * sy,
        isFollowing: true,
      };
    }
  }

  if (!actual && hidePreview) {
    const minX = -2;
    const maxX = 24;
    const maxY = 8;
    const scaleX = 840 / (maxX - minX);
    const sy = 460 / maxY;
    return {
      minX,
      maxX,
      maxY,
      sy,
      mapX: (x: number) => 60 + (x - minX) * scaleX,
      mapY: (y: number) => 520 - y * sy,
      isFollowing: false,
    };
  }

  const bounds = flightBounds(hidePreview ? [actual, ghost] : [preview, actual, ghost]);
  const sy = 460 / bounds.maxY;
  return {
    minX: bounds.minX,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    sy,
    mapX: bounds.mapX,
    mapY: (y: number) => 520 - y * sy,
    isFollowing: false,
  };
}
