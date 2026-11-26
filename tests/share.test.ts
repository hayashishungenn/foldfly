import {it,expect} from 'vitest';import {encodeFlight,decodeFlight,foldSignature,programSignature,resultForShare,type SharedFlight} from '../src/game/share';
import {skyKing} from '../src/fold/planes/skyking';
import {dart} from '../src/fold/planes/dart';
import {FLIGHT_MODEL_VERSION} from '../src/aero/integrator';
import {FOLD_ENGINE_VERSION} from '../src/fold/engine';
const f:SharedFlight={version:1,plane:'dart',paper:'a4',gsm:80,angle:40,speed:28,wind:0,step:6};
it('完整保存折序、纸张与投掷，允许确定性复现',()=>expect(decodeFlight(encodeFlight(f))).toEqual({...f,foldSignature:foldSignature(f.plane),modelVersion:FLIGHT_MODEL_VERSION,foldEngineVersion:FOLD_ENGINE_VERSION}));
it('拒绝损坏、越界和未知机型数据',()=>{for(const hash of ['#flight=%','',encodeFlight({...f,speed:99}),'#flight='+encodeURIComponent(JSON.stringify({...f,plane:'unknown'}))])expect(decodeFlight(hash)).toBeNull()});

it('分享时保留挑战类型并拒绝无效值',()=>{expect(decodeFlight(encodeFlight({...f,challenge:'duration'}))?.challenge).toBe('duration');expect(decodeFlight(encodeFlight({...f,challenge:'other'} as unknown as SharedFlight))).toBeNull()});
it('分享不同机型的完整折序，并校验步骤数量',()=>{
 const plane={...f,plane:'suzanne',step:11} as const;
 expect(decodeFlight(encodeFlight(plane))).toEqual({...plane,foldSignature:foldSignature(plane.plane),modelVersion:FLIGHT_MODEL_VERSION,foldEngineVersion:FOLD_ENGINE_VERSION});
 expect(decodeFlight(encodeFlight({...plane,step:6}))).toBeNull();
});
it('Sky King 机型配置可分享复现',()=>{
 const plane={...f,plane:'skyking',step:skyKing.length} as const;
 expect(decodeFlight(encodeFlight(plane))).toEqual({...plane,foldSignature:foldSignature(plane.plane),modelVersion:FLIGHT_MODEL_VERSION,foldEngineVersion:FOLD_ENGINE_VERSION});
});
it.each(['a5','b5'] as const)('%s 纸张配置可分享复现',paper=>{
 const shared={...f,paper};
 expect(decodeFlight(encodeFlight(shared))).toEqual({...shared,foldSignature:foldSignature(shared.plane),modelVersion:FLIGHT_MODEL_VERSION,foldEngineVersion:FOLD_ENGINE_VERSION});
});
it('拒绝同一步数但折序指纹不同的链接，旧链接保持可读',()=>{
 const legacy='#flight='+encodeURIComponent(JSON.stringify(f));
 expect(decodeFlight(legacy)).toEqual(f);
 const altered='#flight='+encodeURIComponent(JSON.stringify({...f,foldSignature:'00000000'}));
 expect(decodeFlight(altered)).toBeNull();
});
it('不同飞行模型的链接仍可读取并保留版本，非法版本会被拒绝',()=>{
 const raw=(value:unknown)=>'#flight='+encodeURIComponent(JSON.stringify(value));
 expect(decodeFlight(raw({...f,modelVersion:FLIGHT_MODEL_VERSION+1}))?.modelVersion).toBe(FLIGHT_MODEL_VERSION+1);
 for(const modelVersion of [0,-1,1.5,'1'])expect(decodeFlight(raw({...f,modelVersion}))).toBeNull();
});
it('折序指纹忽略文案，但会随折线改变',()=>{
 const labelChange=dart.map(step=>({...step,title:'新标题',description:'新文案'}));
 const geometryChange=[{...dart[0],a:[.45,0] as [number,number]},...dart.slice(1)];
 expect(programSignature(labelChange)).toBe(programSignature(dart));
 expect(programSignature(geometryChange)).not.toBe(programSignature(dart));
});
it('分享成绩与配置并拒绝异常成绩',()=>{
 const result={distance:17.23,duration:3.24,height:4.5};
 expect(decodeFlight(encodeFlight({...f,result}))?.result).toEqual(result);
 for(const invalid of [{...result,duration:0},{...result,height:-1},{...result,distance:Infinity}])
  expect(decodeFlight(encodeFlight({...f,result:invalid}))).toBeNull();
});
it('分享成绩与当前模拟对照允许浮点误差，但不混淆不同结果',async()=>{
 const {matchesSharedResult}=await import('../src/game/share');
 const result={distance:10,duration:3,height:2};
 expect(matchesSharedResult(result,{distance:10.000001,duration:3,height:2})).toBe(true);
 expect(matchesSharedResult(result,{distance:11,duration:3,height:2})).toBe(false);
});

it('折叠引擎版本随链接保存，旧链接和其他版本可读取，非法版本拒绝',()=>{
 const raw=(value:unknown)=>'#flight='+encodeURIComponent(JSON.stringify(value));
 expect(decodeFlight(raw(f))?.foldEngineVersion).toBeUndefined();
 expect(decodeFlight(raw({...f,foldEngineVersion:1}))?.foldEngineVersion).toBe(1);
 for(const foldEngineVersion of [0,-1,1.5,'2'])expect(decodeFlight(raw({...f,foldEngineVersion}))).toBeNull();
});
it('只分享已落地且播放完成的新成绩，不复用旧成绩',()=>{
 const old={distance:10,duration:2,height:1};
 const flight={samples:[],distance:12,duration:3,height:2,landed:true};
 expect(resultForShare(null,false,old)).toEqual(old);
 expect(resultForShare(flight,false,old)).toBeUndefined();
 expect(resultForShare({...flight,landed:false},true,old)).toBeUndefined();
 expect(resultForShare(flight,true,old)).toEqual({distance:12,duration:3,height:2});
});

it('材质字段随链接保存并往返复现,旧链接缺省材质仍可读取',()=>{
 const raw=(value:unknown)=>'#flight='+encodeURIComponent(JSON.stringify(value));
 expect(decodeFlight(raw(f))?.grade).toBeUndefined();
 const withGrade=encodeFlight({...f,grade:'news'});
 expect(decodeFlight(withGrade)?.grade).toBe('news');
 for(const grade of ['unknown','copy ',80,null])expect(decodeFlight(raw({...f,grade}))).toBeNull();
});
