import {pt, type FoldStep} from '../types';

// Inspired by the 2022 Guinness distance record plane "Mach 5" by Dillon Ruble,
// Garrett Jensen, and Nathaniel Erickson (inspired by NASA X-43A hypersonic vehicles).
// Because the creators have not published official crease diagrams, this is an
// engineering approximation capturing its core characteristics: heavy multi-layer
// nose ballast, compact narrow wingspan, and deep keel for 40° high-speed launch.
export const mach5: FoldStep[] = [
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
    description: '将左上角与右上角对称折向中线，形成初级三角机头。',
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
    title: '折下加厚鼻锥',
    description: '将机头尖端沿三角底边向下翻折，使重心显著前移。',
    kind: 'valley',
    a: pt(0, .34),
    b: pt(1, .34),
    sign: -1,
  },
  {
    title: '前缘二次斜折收窄',
    description: '将两侧上方斜边再次折向中线，收窄机头迎风截面并形成后掠三角前缘。',
    kind: 'valley',
    a: pt(0, .34, .42),
    b: pt(.5, .34),
    sign: -1,
    operations: [
      {kind: 'valley', a: pt(0, .34, .42), b: pt(.5, .34), sign: -1},
      {kind: 'valley', a: pt(.5, .34), b: pt(1, .34, .42), sign: -1},
    ],
  },
  {
    title: '鼻尖回折锁紧前缘',
    description: '将下方露出的鼻锥尖端向上回折，压住左右折层形成锁头。',
    kind: 'valley',
    a: pt(0, .54),
    b: pt(1, .54),
    sign: 1,
    region: [
      {a: pt(.25, .54), b: pt(.5, .72), sign: -1},
      {a: pt(.5, .72), b: pt(.75, .54), sign: -1},
    ],
  },
  {
    title: '前缘肩角内折修形',
    description: '把两侧外肩小角向内折入，形成类似 X-43A 的紧凑楔形前缘。',
    kind: 'valley',
    a: pt(0, .34, .56),
    b: pt(.18, .34, .28),
    sign: -1,
    operations: [
      {kind: 'valley', a: pt(0, .34, .56), b: pt(.18, .34, .28), sign: -1},
      {kind: 'valley', a: pt(.82, .34, .28), b: pt(1, .34, .56), sign: -1},
    ],
  },
  {
    title: '对折机身',
    description: '翻面后沿中线对折机身，将厚重的配重折层锁在机身内侧。',
    kind: 'mountain',
    a: [.5, 0],
    b: [.5, 1],
    sign: 1,
    operations: [
      {kind: 'valley', a: [.5, 0], b: [.5, 1], sign: 1, flip: true},
      {kind: 'mountain', a: [.5, 0], b: [.5, 1], sign: 1},
    ],
  },
  {
    title: '高机身窄翼展开定型',
    description: '留出高耸机身龙骨，将两侧窄机翼向外折下并展平，降低高速穿透阻力。',
    kind: 'valley',
    a: [.68, 0],
    b: [.68, 1],
    sign: -1,
    openToStep: 7,
  },
];
