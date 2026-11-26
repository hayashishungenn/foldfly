/**
 * 统一几何数值容差(Phase 03 / 3.4)。纸张尺寸约 0.2–0.3 m,以下阈值按米制:
 * 禁止在模块间各自定义互不一致的阈值。
 */
/** 判定两条折痕端点重合/折痕长度下限:1 µm */
export const EPS_LINE = 1e-6;
/** 有效多边形面积下限:1e-12 m²(1 µm²) */
export const EPS_AREA = 1e-12;
/** 半平面裁剪的包含容差:0.1 nm */
export const EPS_CLIP = 1e-10;
/** 点在多边形内的边界容差:0.1 µm */
export const EPS_INSIDE = 1e-7;
/** 拓扑/折痕匹配坐标容差:10 µm */
export const EPS_MATCH = 1e-5;
/** 近零旋转/向量长度 */
export const EPS_VECTOR = 1e-12;
