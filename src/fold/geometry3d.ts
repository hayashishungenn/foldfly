/** Spatial coordinates in metres, independent of the renderer. */
export type Point3 = {x:number;y:number;z:number};
import type {Point,Polygon} from './geometry';

/** Rotate a point around an oriented crease using Rodrigues' formula. */
export function rotateAroundAxis(point:Point3,a:Point3,b:Point3,angle:number):Point3 {
 const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=Math.hypot(dx,dy,dz);
 if(length<1e-12 || !Number.isFinite(length))throw new Error('空间折痕两端不能重合');
 if(!Number.isFinite(angle))throw new Error('旋转角度无效');
 const ux=dx/length,uy=dy/length,uz=dz/length;
 const x=point.x-a.x,y=point.y-a.y,z=point.z-a.z;
 const c=Math.cos(angle),s=Math.sin(angle),dot=ux*x+uy*y+uz*z;
 return {
  x:a.x+x*c+(uy*z-uz*y)*s+ux*dot*(1-c),
  y:a.y+y*c+(uz*x-ux*z)*s+uy*dot*(1-c),
  z:a.z+z*c+(ux*y-uy*x)*s+uz*dot*(1-c),
 };
}

/**
 * Open one wing from a vertically folded fuselage. Input faces and the root
 * crease use the unfolded sheet coordinates; the crease is specified on the
 * right half. The wing rotates 90° about its actual, possibly sloped root.
 * Callers must first clip the face to the selected side of that root.
 */
export function deployWing(face:Polygon,center:number,rootA:Point,rootB:Point,side:'left'|'right'):Point3[] {
 if(rootA.x<center-1e-12||rootB.x<center-1e-12)throw new Error('翼根必须位于中线右侧');
 const axis=(p:Point):Point3=>({x:center,y:p.y,z:-(p.x-center)});
 if(Math.abs(rootA.y-rootB.y)<1e-12)throw new Error('翼根必须有纵向长度');
 const [a,b]=rootA.y<rootB.y?[axis(rootA),axis(rootB)]:[axis(rootB),axis(rootA)];
 const angle=side==='right'?-Math.PI/2:Math.PI/2;
 return face.map(p=>{
  if((side==='right'?p.x-center:center-p.x)<-1e-10)throw new Error('翼面跨过机身中线');
  return rotateAroundAxis({x:center,y:p.y,z:-Math.abs(p.x-center)},a,b,angle);
 });
}
