import {pt, type FoldStep} from '../types';

// Nakamura Lock: Designed by Japanese origami master Eiji Nakamura in the 1970s.
// One of the world's most famous paper airplane designs, widely celebrated in
// the Red Bull Paper Wings Aerobatics & distance categories for its signature
// triangular nose-locking tab and exceptional pitch/roll self-stability.
export const nakamura: FoldStep[] = [
  {
    title: '折出中线',
    description: '将纸张沿长边对折，压出中心基准折痕。',
    kind: 'valley',
    a: [.5, 0],
    b: [.5, 1],
    sign: 1,
  },
  {
    title: '展开纸张',
    description: '展开纸张，保留清晰的中线折痕。',
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
    title: '机头信封下折',
    description: '沿横向折线将顶部大三角向下翻折，形成信封状倒三角形。',
    kind: 'valley',
    a: pt(0, .40),
    b: pt(1, .40),
    sign: -1,
  },
  {
    title: '两侧斜边折向中线',
    description: '将上方两侧斜边再次折向中线，露出下方的小三角鼻尖。',
    kind: 'valley',
    a: pt(0, .40, .32),
    b: pt(.5, .40, .05),
    sign: -1,
    operations: [
      {kind: 'valley', a: pt(0, .40, .32), b: pt(.5, .40, .05), sign: -1},
      {kind: 'valley', a: pt(.5, .40, .05), b: pt(1, .40, .32), sign: -1},
    ],
  },
  {
    title: '翻起锁扣固定机头',
    description: '将下方露出的小三角鼻尖向上翻折，牢牢卡紧锁住两侧折层（The Lock）。',
    kind: 'valley',
    a: pt(0, .65),
    b: pt(1, .65),
    sign: 1,
    region: [
      {a: pt(.35, .65), b: pt(.5, .80), sign: -1},
      {a: pt(.5, .80), b: pt(.65, .65), sign: -1},
    ],
  },
  {
    title: '对折机身',
    description: '沿中线向后对折机身，让锁扣和机翼折层露在最外侧。',
    kind: 'mountain',
    a: [.5, 0],
    b: [.5, 1],
    sign: 1,
  },
  {
    title: '折出机翼并展开',
    description: '留出适度机身龙骨，将两侧机翼水平折下并赋予微弱上反角。',
    kind: 'valley',
    a: [.64, 0],
    b: [.64, 1],
    sign: -1,
    openToStep: 6,
  },
];
