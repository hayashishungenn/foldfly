export type Point = {x:number;y:number};
export type Polygon = Point[];
/** Shift the integration origin to avoid cancellation for translated sheets. */
export function signedArea(p:Polygon):number {
 if(p.length<3)return 0;
 const origin=p[0];let sum=0;
 for(let i=0;i<p.length;i++){
  const a=p[i],b=p[(i+1)%p.length];
  sum+=(a.x-origin.x)*(b.y-origin.y)-(b.x-origin.x)*(a.y-origin.y);
 }
 return sum/2;
}
export function area(p:Polygon):number { return Math.abs(signedArea(p)); }
export function centroid(p:Polygon):Point {
 if(p.length<3)return {x:0,y:0};
 const origin=p[0];let sum=0,x=0,y=0;
 for(let i=0;i<p.length;i++){
  const a=p[i],b=p[(i+1)%p.length],ax=a.x-origin.x,ay=a.y-origin.y,bx=b.x-origin.x,by=b.y-origin.y;
  const cross=ax*by-bx*ay;sum+=cross;x+=(ax+bx)*cross;y+=(ay+by)*cross;
 }
 if(Math.abs(sum)<2e-12)return {x:0,y:0};
 return {x:origin.x+x/(3*sum),y:origin.y+y/(3*sum)};
}
export function side(p:Point,a:Point,b:Point):number {return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)}
export function reflect(p:Point,a:Point,b:Point):Point {const dx=b.x-a.x,dy=b.y-a.y,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);return {x:2*(a.x+t*dx)-p.x,y:2*(a.y+t*dy)-p.y}}
export function clip(p:Polygon,a:Point,b:Point,sign:number):Polygon {const out:Polygon=[]; p.forEach((v,i)=>{const w=p[(i+1)%p.length],d=side(v,a,b)*sign,e=side(w,a,b)*sign;if(d>=-1e-10)out.push(v);if((d>1e-10&&e< -1e-10)||(d< -1e-10&&e>1e-10)){const t=d/(d-e);out.push({x:v.x+t*(w.x-v.x),y:v.y+t*(w.y-v.y)})}});return out}
