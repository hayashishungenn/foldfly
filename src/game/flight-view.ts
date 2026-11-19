import type {Flight} from '../aero/integrator';
/** Bounds cover all sample points, including backwards and overshooting flights. */
export function flightBounds(flights:readonly (Flight|null|undefined)[]) {
 let minX=0,maxX=10,maxY=4;
 for(const flight of flights){
  if(!flight)continue;
  maxY=Math.max(maxY,flight.height);
  for(const sample of flight.samples){
   minX=Math.min(minX,sample.x);maxX=Math.max(maxX,sample.x);maxY=Math.max(maxY,sample.y);
  }
 }
 const scale=840/(maxX-minX);
 return {minX,maxX,maxY,mapX:(x:number)=>60+(x-minX)*scale};
}
