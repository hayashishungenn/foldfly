import {expect,it} from 'vitest';
import {airSpeedAt} from '../src/game/playback';
const samples=[{t:0,x:0,y:0,pitch:0},{t:1,x:10,y:0,pitch:0},{t:2,x:20,y:0,pitch:0}];
it('空速使用轨迹速度并扣除水平风速',()=>{
 expect(airSpeedAt(samples,.5,3)).toBeCloseTo(7);
 expect(airSpeedAt(samples,3,-2)).toBeCloseTo(12);
 expect(airSpeedAt([samples[0]],0,0)).toBe(0);
});
