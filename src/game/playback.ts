import type {Flight,Sample} from '../aero/integrator';
export function playback(flight:Flight,time:number):{sample:Sample;finished:boolean;height:number}{
 const t=Math.max(0,Math.min(time,flight.duration));
 const end=flight.samples.findIndex(p=>p.t>=t);
 const b=flight.samples[end<0?flight.samples.length-1:end],a=flight.samples[Math.max(0,end-1)];
 const u=b.t===a.t?0:(t-a.t)/(b.t-a.t);
 const sample={t,x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,pitch:a.pitch+(b.pitch-a.pitch)*u};
 const finished=t>=flight.duration;
 return {sample,finished,height:finished?flight.height:Math.max(sample.y,...flight.samples.filter(p=>p.t<=t).map(p=>p.y))};
}
/** Estimate air-relative speed from the surrounding trajectory samples. */
export function airSpeedAt(samples:readonly Sample[],time:number,wind:number):number {
 if(samples.length<2)return 0;
 let end=samples.findIndex(p=>p.t>=time);
 if(end<0)end=samples.length-1;
 end=Math.max(1,end);
 const a=samples[end-1],b=samples[end],dt=b.t-a.t;
 return dt>0?Math.hypot((b.x-a.x)/dt-wind,(b.y-a.y)/dt):0;
}
