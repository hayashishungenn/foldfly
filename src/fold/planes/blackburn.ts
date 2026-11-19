import {pt, type FoldStep} from '../types';

// Blackburn Basic Glider: Designed by aerospace engineer Ken Blackburn.
// Blackburn set four Guinness World Records for paper airplane time-aloft
// (including his legendary 1998 record of 27.6 seconds, held for 13 years).
// Widely used in paper aircraft duration competitions for its multi-layer
// reinforced leading edge and wide stable gliding planform.
export const blackburn: FoldStep[] = [
  {
    title: '折出中线',
    description: '将纸张沿长边对折，压出中心基准线。',
    kind: 'valley',
    a: [.5, 0],
    b: [.5, 1],
    sign: 1,
  },
  {
    title: '展开纸张',
    description: '展开纸张，留下中线折痕。',
    kind: 'mountain',
    a: [.5, 0],
    b: [.5, 1],
    sign: 1,
    unfold: true,
    unfoldToStep: 0,
  },
  {
    title: '两角折向中线',
    description: '将左上角与右上角对称折向中线，形成顶部大三角形。',
    kind: 'valley',
    a: pt(0, .5),
    b: pt(.5, 0),
    sign: -1,
    operations: [
      {kind: 'valley', a: pt(0, .5), b: pt(.5, 0), sign: -1},
      {kind: 'valley', a: pt(.5, 0), b: pt(1, .5), sign: -1},
    ],
  },
  {
    title: '机头第一道锁重卷折',
    description: '将机头尖端沿三角底边向下翻折，形成厚重的前缘锁层。',
    kind: 'valley',
    a: pt(0, .28),
    b: pt(1, .28),
    sign: -1,
  },
  {
    title: '机头第二道锁重卷折',
    description: '顺着横线再次向下翻折一条约 1.5 厘米的窄带，将重心锁死在机头。',
    kind: 'valley',
    a: pt(0, .38),
    b: pt(1, .38),
    sign: -1,
  },
  {
    title: '斜边再次对称收紧',
    description: '将上方两侧边缘再次向中心线压紧，形成流线型前掠斜边。',
    kind: 'valley',
    a: pt(0, .38, .28),
    b: pt(.5, .38),
    sign: -1,
    operations: [
      {kind: 'valley', a: pt(0, .38, .28), b: pt(.5, .38), sign: -1},
      {kind: 'valley', a: pt(.5, .38), b: pt(1, .38, .28), sign: -1},
    ],
  },
  {
    title: '对折机身',
    description: '沿中线向后对折机身，将多层卷折配重密闭在机身内侧。',
    kind: 'mountain',
    a: [.5, 0],
    b: [.5, 1],
    sign: 1,
  },
  {
    title: '折出宽幅平直滑翔翼',
    description: '留出适度机身龙骨，将两侧平直大翼水平折下展开，形成大面积滑翔面。',
    kind: 'valley',
    a: [.66, 0],
    b: [.66, 1],
    sign: -1,
    openToStep: 6,
  },
];
