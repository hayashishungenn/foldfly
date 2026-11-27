export const papers = [
  {id: 'a4', name: 'A4', width: 0.21, height: 0.297, hint: 'ISO √2 长宽比标准纸，距离与滞空世界纪录同款规格'},
  {id: 'letter', name: 'US Letter', width: 0.2159, height: 0.2794, hint: '美式信纸，较 A4 略宽略短，折痕比例微变'},
  {id: 'square', name: '正方形', width: 0.15, height: 0.15, hint: '150 mm 折纸方纸，翼展紧凑、俯仰响应灵敏'},
  {id: 'a5', name: 'A5', width: 0.148, height: 0.21, hint: 'A4 对裁尺寸，适合轻巧快速短距试飞'},
  {id: 'b5', name: 'B5', width: 0.176, height: 0.25, hint: '介于 A5 与 A4 之间的作业本常用规格'},
  {id: 'a3', name: 'A3', width: 0.297, height: 0.42, hint: 'A4 的两倍面积，翼面更大但折层更厚，适合大幅面滑翔实验'},
  {id: 'a6', name: 'A6', width: 0.105, height: 0.148, hint: 'A4 四分之一，轻巧紧凑，适合桌面短距试飞'},
] as const;
export type Paper = (typeof papers)[number];
export const weights = [70, 80, 100] as const;
export const weightHints: Record<(typeof weights)[number], string> = {
  70: '轻薄草稿纸 · 翼载荷低，适合微速轻抛',
  80: '日常打印纸 · 户田拓夫 Sky King 滞空纪录同款克重',
  100: '加厚铜版/激光纸 · 挺括抗弯，Suzanne 与 Mach 5 距离纪录同款克重',
};
