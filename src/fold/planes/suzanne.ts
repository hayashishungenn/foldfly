import type {FoldStep,FoldPoint} from './dart';
// Suzanne: John Collins' published sequence. The wing-root crease is a
// flat-projection approximation; tape and variable dihedral are not modelled.
// https://makezine.com/projects/worlds-best-paper-airplane/
const pt=(x:number,y:number):FoldPoint=>({x:[x,0],y:[y,0]});
const k=Math.SQRT2-1;
export const suzanne:FoldStep[]=[
 {title:'第一条对角折痕',description:'把右上角折向左边，使上边与左边重合。',kind:'valley',a:pt(0,0),b:pt(1,1),sign:-1},
 {title:'展开第一条折痕',description:'展开纸张，保留对角折痕。',kind:'mountain',a:pt(0,0),b:pt(1,1),sign:-1,unfold:true,unfoldToStep:0},
 {title:'第二条对角折痕',description:'将左上角折向右边，让上边与右边重合。',kind:'valley',a:pt(1,0),b:pt(0,1),sign:1},
 {title:'展开第二条折痕',description:'再次展开，两条折痕形成一个 X。',kind:'mountain',a:pt(1,0),b:pt(0,1),sign:1,unfold:true,unfoldToStep:0},
 {title:'左侧折向对角线',description:'把左上边折向对角折痕，压平。',kind:'valley',a:pt(0,1),b:pt(k,0),sign:-1},
 {title:'右侧折向对角线',description:'右侧也折向另一条对角折痕，与左侧对称。',kind:'valley',a:pt(1-k,0),b:pt(1,1),sign:-1},
 {title:'折下机头',description:'沿两条对角折痕的交点横向折下上端。',kind:'valley',a:pt(0,.5),b:pt(1,.5),sign:-1},
 {title:'左角折向中线',description:'沿已有折痕，把左侧新角折向中线。',kind:'valley',a:pt(0,1),b:pt(.5,.5),sign:-1},
 {title:'右角折向中线',description:'将右侧新角对称折向中线。',kind:'valley',a:pt(.5,.5),b:pt(1,1),sign:-1},
 {title:'对折机身',description:'翻面后沿中心线对折，让折叠处留在外侧。',kind:'mountain',a:[.5,0],b:[.5,1],sign:1,operations:[
  {kind:'valley',a:[.5,0],b:[.5,1],sign:1,flip:true},
  {kind:'mountain',a:[.5,0],b:[.5,1],sign:1},
 ]},
 {title:'折出并展开双翼',description:'实物折法：将机翼向下拉，直到机身处的小三角消失，再让另一侧对称；图中翼根为简化示意。',kind:'valley',a:[.62,0],b:[.62,1],sign:-1,openToStep:9},
];
