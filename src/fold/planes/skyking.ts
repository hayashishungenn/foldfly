import type {FoldStep,FoldPoint} from './dart';
// Based on Takuo Toda's Sky King instructions. The complex nose lock and
// winglets are deliberately omitted from this first playable approximation.
// https://paperhangar.com/sky-king/ (reverse-engineered rendition)
const pt=(x:number,yWidth:number,yHeight:number,offsetY=0):FoldPoint=>({x:[x,0],y:[yWidth,yHeight],offset:[0,offsetY]});
const hinge=(x:number,yWidth=0)=>pt(x,yWidth,.5,-.0125);
const k=Math.SQRT2-1;
export const skyKing:FoldStep[]=[
 {title:'折出中线',description:'将纸张沿长边对折，压出中线。',kind:'valley',a:[.5,0],b:[.5,1],sign:1},
 {title:'展开纸张',description:'展开纸张，留下中心折痕。',kind:'mountain',a:[.5,0],b:[.5,1],sign:1,unfold:true,unfoldToStep:0},
 {title:'左角折向中线',description:'将左上角折向中线。',kind:'valley',a:pt(0,.5,0),b:pt(.5,0,0),sign:-1},
 {title:'右角折向中线',description:'将右上角对称折向中线。',kind:'valley',a:pt(.5,0,0),b:pt(1,.5,0),sign:-1},
 {title:'折下机头',description:'将尖端向下折，使尖端距底边约 2.5 厘米。',kind:'valley',a:hinge(0),b:hinge(1),sign:-1},
 {title:'预折左角',description:'把左上角折到中线，压出辅助折痕。',kind:'valley',a:hinge(0,.5),b:hinge(.5),sign:-1},
 {title:'展开左角',description:'展开刚才的折角，保留辅助折痕。',kind:'mountain',a:hinge(0,.5),b:hinge(.5),sign:-1,unfold:true,unfoldToStep:5},
 {title:'预折右角',description:'把右上角折到中线，压出对称的辅助折痕。',kind:'valley',a:hinge(.5),b:hinge(1,.5),sign:-1},
 {title:'展开右角',description:'展开右侧折角，保留辅助折痕。',kind:'mountain',a:hinge(.5),b:hinge(1,.5),sign:-1,unfold:true,unfoldToStep:5},
 {title:'左角折向辅助线',description:'将左上边折到刚才的左侧折痕上。',kind:'valley',a:hinge(0,.5),b:hinge(k/2),sign:-1},
 {title:'右角折向辅助线',description:'将右上边折到右侧辅助折痕上。',kind:'valley',a:hinge(1-k/2),b:hinge(1,.5),sign:-1},
 {title:'左角再次折向中线',description:'将上方左角折向中心线。',kind:'valley',a:hinge(0,.5),b:hinge(.5),sign:-1},
 {title:'右角再次折向中线',description:'将右侧新角对称折向中心线。原机的锁头步骤在此简化。',kind:'valley',a:hinge(.5),b:hinge(1,.5),sign:-1},
 {title:'预折机头锁线',description:'把尖端折到两侧相接处，压出锁头的辅助折痕。',kind:'valley',a:hinge(0,(1-k)/4),b:hinge(1,(1-k)/4),sign:-1},
 {title:'展开机头锁线',description:'把尖端展开，保留刚才的辅助折痕。后续锁头结构仍为简化示意。',kind:'mountain',a:hinge(0,(1-k)/4),b:hinge(1,(1-k)/4),sign:-1,unfold:true,unfoldToStep:13},
 {title:'对折机身',description:'沿中线向后对折，保持两侧对齐。',kind:'mountain',a:[.5,0],b:[.5,1],sign:1},
 {title:'预折锁头斜线',description:'把机头尖端折到刚才的横向辅助线，压出斜折痕。',kind:'valley',a:hinge(.5,(1-k)/4),b:hinge(.5+(1-k)/4),sign:-1},
 {title:'展开锁头斜线',description:'展开尖端，为接下来的菱形压折留下折痕；压折目前尚未模拟。',kind:'mountain',a:hinge(.5,(1-k)/4),b:hinge(.5+(1-k)/4),sign:-1,unfold:true,unfoldToStep:16},
 {title:'折出并展开双翼',description:'对称折出机翼并展开；锁头、翼尖和尾部的精细折法尚未模拟。',kind:'valley',a:[.6,0],b:[.6,1],sign:-1,openToStep:15},
];
