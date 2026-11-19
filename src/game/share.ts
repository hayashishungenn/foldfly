import {planes,type PlaneId} from '../fold/planes';
import {papers,weights,type Paper} from '../paper/papers';
import type {FoldStep} from '../fold/planes/dart';
import {FLIGHT_MODEL_VERSION} from '../aero/integrator';
import type {Flight} from '../aero/integrator';
import {FOLD_ENGINE_VERSION} from '../fold/engine';
export type SharedResult={distance:number;duration:number;height:number};
export type SharedFlight = {version:1;plane:PlaneId;paper:Paper['id'];gsm:typeof weights[number];angle:number;speed:number;wind:number;step:number;foldSignature?:string;foldEngineVersion?:number;modelVersion?:number;challenge?:'distance'|'duration';result?:SharedResult};
/** FNV-1a over the program; detects edits even when the step count is unchanged. */
function hashProgram(value:unknown):string {
 let hash=2166136261;
 for(const ch of JSON.stringify(value)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return (hash>>>0).toString(16).padStart(8,'0');
}
export function programSignature(steps:readonly FoldStep[]):string {
 // Labels are presentation only; editing them must not invalidate geometry.
 const geometry=steps.map(({title:_title,description:_description,...step})=>step);
 return hashProgram(geometry);
}
export function foldSignature(plane:PlaneId):string {return programSignature(planes[plane].steps)}
export function encodeFlight(input:SharedFlight):string { return '#flight='+encodeURIComponent(JSON.stringify({...input,foldSignature:foldSignature(input.plane),foldEngineVersion:FOLD_ENGINE_VERSION,modelVersion:FLIGHT_MODEL_VERSION})) }
export function decodeFlight(hash:string):SharedFlight|null {
 try {
  if(!hash.startsWith('#flight='))return null;
  const x=JSON.parse(decodeURIComponent(hash.slice(8)));
  if(x.version!==1||!Object.hasOwn(planes,x.plane)||!papers.some(p=>p.id===x.paper)||!weights.some(w=>w===x.gsm)||x.step!==planes[x.plane as PlaneId].steps.length)return null;
  if(x.foldSignature!==undefined && x.foldSignature!==foldSignature(x.plane as PlaneId) && x.foldSignature!==hashProgram(planes[x.plane as PlaneId].steps))return null;
  if(x.modelVersion!==undefined && (!Number.isSafeInteger(x.modelVersion)||x.modelVersion<1))return null;
  if(x.foldEngineVersion!==undefined && (!Number.isSafeInteger(x.foldEngineVersion)||x.foldEngineVersion<1))return null;
  if(x.result!==undefined){
   const r=x.result;
   if(!r || ![r.distance,r.duration,r.height].every(Number.isFinite) || Math.abs(r.distance)>1e6 || r.duration<=0 || r.duration>60 || r.height<0 || r.height>1e6)return null;
  }
  if(x.challenge!==undefined && !['distance','duration'].includes(x.challenge))return null;
  for(const [key,min,max] of [['angle',0,75],['speed',6,28],['wind',-4,4]] as const)if(typeof x[key]!=='number'||!Number.isFinite(x[key])||x[key]<min||x[key]>max)return null;
  return x;
 } catch { return null }
}

/** A shared score is user-provided; compare it with this version's replay. */
export function matchesSharedResult(a:SharedResult,b:SharedResult):boolean {
 return Math.abs(a.distance-b.distance)<1e-4 && Math.abs(a.duration-b.duration)<1e-4 && Math.abs(a.height-b.height)<1e-4;
}
/** Only settled flights may replace an incoming shared score. */
export function resultForShare(flight:Flight|null,finished:boolean,incoming?:SharedResult):SharedResult|undefined {
 if(!flight)return incoming;
 if(!finished||!flight.landed)return undefined;
 return {distance:flight.distance,duration:flight.duration,height:flight.height};
}
