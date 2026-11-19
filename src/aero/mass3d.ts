import type {Point3} from '../fold/geometry3d';

export type SpatialMass = {area:number;mass:number;centroid:Point3;pitchInertia:number};

/** Uniform-density convex paper faces. Overlapping faces retain their mass. */
export function spatialMass(faces:readonly (readonly Point3[])[],gsm:number):SpatialMass {
 if(!Number.isFinite(gsm)||gsm<=0)throw new Error('纸张克重必须大于零');
 const origin=faces.find(face=>face.length>=3)?.[0];
 if(!origin)throw new Error('没有有效纸面');
 let total=0,mx=0,my=0,mz=0,second=0;
 for(const face of faces){
  if(face.some(p=>![p.x,p.y,p.z].every(Number.isFinite)))throw new Error('纸面坐标无效');
  for(let i=1;i+1<face.length;i++){
   const vertices=[face[0],face[i],face[i+1]];
   const [a,b,c]=vertices;
   const u={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},v={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};
   const triangleArea=Math.hypot(u.y*v.z-u.z*v.y,u.z*v.x-u.x*v.z,u.x*v.y-u.y*v.x)/2;
   if(triangleArea===0)continue;
   const xs=vertices.map(p=>p.x-origin.x),ys=vertices.map(p=>p.y-origin.y),zs=vertices.map(p=>p.z-origin.z);
   const integralSquared=(values:number[])=>triangleArea*(values[0]**2+values[1]**2+values[2]**2+values[0]*values[1]+values[1]*values[2]+values[2]*values[0])/6;
   total+=triangleArea;mx+=triangleArea*(xs[0]+xs[1]+xs[2])/3;
   my+=triangleArea*(ys[0]+ys[1]+ys[2])/3;mz+=triangleArea*(zs[0]+zs[1]+zs[2])/3;
   second+=integralSquared(ys)+integralSquared(zs);
  }
 }
 if(!(total>0))throw new Error('没有有效纸面');
 const x=mx/total,y=my/total,z=mz/total;
 return {area:total,mass:total*gsm/1000,centroid:{x:origin.x+x,y:origin.y+y,z:origin.z+z},pitchInertia:(second-total*(y*y+z*z))*gsm/1000};
}
