import type {Flight} from '../aero/integrator';
import type {Challenge} from './challenge';
import type {PlaneId} from '../fold/planes';
import {foldSignature} from './share';
import {FOLD_ENGINE_VERSION} from '../fold/engine';
import {FLIGHT_MODEL_VERSION} from '../aero/integrator';

// Version 4 uses geometry-based pitch dynamics; retain old storage untouched.
export const GHOST_VERSION=4;

/** Separate incompatible geometries and simulation versions as well as planes. */
export function ghostStorageKey(plane:PlaneId,mode:Challenge):string {
 return `foldfly-ghost-v${GHOST_VERSION}-${plane}-${mode}-${foldSignature(plane)}-f${FOLD_ENGINE_VERSION}-a${FLIGHT_MODEL_VERSION}`;
}

/** A record is personal and local; it is not a reconstruction of a world record. */
export function bestFlight(mode:Challenge,current:Flight|null,candidate:Flight):Flight|null {
 if(!candidate.landed)return current;
 const key=mode==='distance'?'distance':'duration';
 return !current || candidate[key]>current[key] ? candidate : current;
}
export function encodeGhost(mode:Challenge,flight:Flight):string {
 return JSON.stringify({version:GHOST_VERSION,mode,flight});
}
export function decodeGhost(serialized:string,mode:Challenge):Flight|null {
 try {
  if(serialized.length>400000)return null;
  const data=JSON.parse(serialized),f=data.flight;
  if(data.version!==GHOST_VERSION||data.mode!==mode||!f||f.landed!==true||!Array.isArray(f.samples)||f.samples.length<2||f.samples.length>2000)return null;
  if(![f.distance,f.duration,f.height].every(Number.isFinite)||f.duration<=0||f.duration>60||f.height<0)return null;
  let previous=-1;
  for(const p of f.samples){
   if(!p||![p.t,p.x,p.y,p.pitch].every(Number.isFinite)||p.t<=previous||p.t>f.duration+1e-6||p.y< -1e-6)return null;
   previous=p.t;
  }
  const first=f.samples[0],last=f.samples[f.samples.length-1];
  if(first.t!==0||Math.abs(last.t-f.duration)>1e-6||Math.abs(last.x-f.distance)>1e-6||Math.abs(last.y)>1e-6)return null;
  return f as Flight;
 } catch { return null }
}
