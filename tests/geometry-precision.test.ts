import {it,expect} from 'vitest';
import {area,centroid} from '../src/fold/geometry';
it('小纸片在较大坐标偏移下仍能准确计算面积和质心',()=>{
 const x=1e6,y=-1e6,w=.21,h=.297;
 const p=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
 expect(area(p)).toBeCloseTo(w*h,8);
 expect(centroid(p).x).toBeCloseTo(x+w/2,7);
 expect(centroid(p).y).toBeCloseTo(y+h/2,7);
});
