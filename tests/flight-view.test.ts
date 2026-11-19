import {it,expect} from 'vitest';
import {flightBounds} from '../src/game/flight-view';
import type {Flight} from '../src/aero/integrator';
const f:Flight={samples:[{t:0,x:0,y:1.5,pitch:0},{t:1,x:12,y:3,pitch:0},{t:2,x:-3,y:0,pitch:0}],distance:-3,duration:2,height:3,landed:true};
it('飞行画面容纳向后落点与曾经超过落点的轨迹',()=>{
 const bounds=flightBounds([f]);
 expect(bounds.minX).toBeLessThanOrEqual(-3);
 expect(bounds.maxX).toBeGreaterThanOrEqual(12);
 expect(bounds.maxY).toBeGreaterThanOrEqual(3);
 expect(bounds.mapX(-3)).toBeGreaterThanOrEqual(60);
 expect(bounds.mapX(12)).toBeLessThanOrEqual(900);
});
it('空画面仍有有效刻度和原点',()=>{
 const bounds=flightBounds([]);
 expect(bounds.minX).toBeLessThanOrEqual(0);expect(bounds.maxX).toBeGreaterThan(0);
 expect(Number.isFinite(bounds.mapX(0))).toBe(true);
});
