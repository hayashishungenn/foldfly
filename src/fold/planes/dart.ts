import type {FoldPoint, FoldBoundary, FoldOperation, FoldStep} from '../types';
export type {FoldPoint, FoldBoundary, FoldOperation, FoldStep};
// Coordinates are normalized to the sheet. A step may fold several layers together.
// The two symmetric folds in each of steps 3 and 4 are taught together.
// Smithsonian National Air and Space Museum: https://howthingsfly.si.edu/sites/default/files/paper-airplane/NASM_paper_plane_printout_b1p2i5.pdf
const diagonal=(x:number,y:number):FoldPoint=>({x:[x,0],y:[y,0]});
export const dart:FoldStep[] = [
 {title:'折出中线',description:'将左半边沿中线折向右侧，压出一道中心折痕。',kind:'valley',a:[.5,0],b:[.5,1],sign:1},
 {unfold:true,unfoldToStep:0,title:'展开纸张',description:'沿原来的折痕将纸展开，中线会留下折痕。',kind:'mountain',a:[.5,0],b:[.5,1],sign:1},
 {title:'两角折向中线',description:'将两个上角分别折向中线，形成对称尖头。',kind:'valley',a:diagonal(0,.5),b:diagonal(.5,0),sign:-1,operations:[
  {kind:'valley',a:diagonal(0,.5),b:diagonal(.5,0),sign:-1},
  {kind:'valley',a:diagonal(.5,0),b:diagonal(1,.5),sign:-1},
 ]},
 {title:'斜边再折向中线',description:'将两侧斜边再次折到中线，压紧细长机头。',kind:'valley',a:diagonal(0,(1+Math.SQRT2)/2),b:diagonal(.5,0),sign:-1,operations:[
  {kind:'valley',a:diagonal(0,(1+Math.SQRT2)/2),b:diagonal(.5,0),sign:-1},
  {kind:'valley',a:diagonal(.5,0),b:diagonal(1,(1+Math.SQRT2)/2),sign:-1},
 ]},
 {title:'对折机身',description:'沿中线将两侧合拢，折好的尖角留在外侧。',kind:'mountain',a:[.5,0],b:[.5,1],sign:1},
 {openToStep:4,title:'折出机翼',description:'沿机身折出机翼，完成后将两翼展开。图中的平行翼根是简化示意，史密森尼教程采用倾斜翼根。',kind:'valley',a:[.62,0],b:[.62,1],sign:-1},
];
/** Smithsonian-style sloped wing root under evaluation; not yet the playable default. */
export const dartSloped:FoldStep[]=[...dart.slice(0,-1),
 {openToStep:4,title:'折出机翼',description:'将翼角折向机身底边，再把两翼展开。',kind:'valley',a:[.5,0],b:{bisector:{vertex:[.5,0],through:[1,1],other:[.5,1],atY:1}},sign:-1},
];
