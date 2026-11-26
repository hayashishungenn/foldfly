# FoldFly 气动物理审查报告（P1 Audit）

> 审查范围：`src/aero/extract.ts`、`src/aero/model.ts`、`src/aero/integrator.ts`、`src/aero/calibrate.ts`、`src/aero/polar.ts`。
> 审查原则：区分几何直接测量量与经验修正项，诚实标注近似与过拟合风险，不以降低测试要求换取表面吻合。

---

## 1. 参数来源分级：几何直接计算 vs 经验/半经验假设

| 类别 | 物理量 / 参数 | 单位 | 来源模块 | 性质说明 |
|---|---|---|---|---|
| **直接几何测量** | 总质量 $m$ | $\text{kg}$ | `extract.ts` | $\sum A_i \cdot \text{gsm}/1000$，由折叠多边形面积精确积分 |
| **直接几何测量** | 重心 $\text{CG}(x,y)$、高度 $z_{\text{cg}}$ | $\text{m}$ | `extract.ts` / `mass3d.ts` | 多层面积/3D 面片加权质心 |
| **直接几何测量** | 翼展 $b$、展开翼面积 $S$、展弦比 $AR$ | $\text{m}, \text{m}^2, 1$ | `extract.ts` | 展翼轮廓布尔并集（`polygon-clipping`）精确测量 |
| **直接几何测量** | 弦长 $c$、浸润面积 $S_{\text{wet}}$、机身侧面积 | $\text{m}, \text{m}^2$ | `extract.ts` | 翼面与竖直龙骨轮廓投影面积 |
| **直接几何测量** | 俯仰转动惯量 $I_{yy}$、翼面阻尼二阶矩 | $\text{kg}\cdot\text{m}^2, \text{m}^2$ | `extract.ts` | 两点高斯积分 + 纵向二阶矩解析式 |
| **经典气动近似** | 气动焦点 $\text{AC}$ | $\text{m}$ | `extract.ts` | 逐条带局部四分之一弦（$x/c = 0.25$）面积加权近似 |
| **经典气动近似** | 有限展弦比升力斜率 $C_{L\alpha}$ | $\text{rad}^{-1}$ | `model.ts` | $2\pi AR/(AR+2)$（小展弦比修正近似） |
| **文献实验参数** | 失速过渡 $(14^\circ, 6^\circ)$、失速升力 $0.95$、正面阻力 $1.9$ | $\text{rad}, 1$ | `model.ts` | 源自 JFM 2022 §5 平板滑翔机风洞实验（DOI: 10.1017/jfm.2022.89） |
| **经验代理修正** | `enduranceMode` / `penetratorMode` / `distanceGliderMode` 平滑门控 | $1$ | `integrator.ts` / `polar.ts` | 仅依赖无量纲几何比值（饱满度、$AR$、静稳定余量 $SM$、细长比），不按机型 ID 硬编码；但其中的 `slowEndurance` 高升低阻项（$C_{L,\text{camber}}$ 与有效 $e$）属于**室内微速滞空/上升气流等效代理项** |

---

## 2. 隐式构型门控与过拟合风险评估

1. **无机型 ID 硬编码**：`extract.ts`、`model.ts` 与 `integrator.ts` 均不接收 `planeId`，全部由折叠后的几何特征驱动，换纸张规格（A4 / Letter / A5 / B5 / 正方形）或克重（70 / 80 / 100 gsm）均实时重算。
2. **已知的代理项局限（诚实披露）**：
   - 真实室内滞空纪录（Sky King 27.9 s / Zero Fighter 29.2 s / 现役 31.2 s）高度依赖三维螺旋盘旋轨迹、机翼拱度定型与场馆微弱上升气流；在纯纵向 2D 无热气流平面内，`integrator.ts` 通过 `slowEndurance` 的有效拱度升力与低诱导阻力代理项等效体现极低沉降率（$w_{\min} \approx 0.09\text{ m/s}$）。
   - 该代理项虽保持了 C¹ 连续与全网格 240 Hz 步长收敛（960 组用例误差 $<0.05\text{ m}$），但其有效展弦比效率因子远高于经典三维升力线理论上限（$e \le 1$），属于**为了在 2D 平面复现室内滞空时间量级所做的工程等效**。
   - **最小修正策略（本阶段）**：本阶段不破坏已验证的 `FLIGHT_MODEL_VERSION = 2` 与现有分享链接/幽灵机兼容性；通过 `tests/aero-audit.test.ts` 锁定质量、翼载荷、速度、风速、极端攻角与步长收敛的物理单调性，并将上述近似假设在文档与 UI 中明确告知用户。后续若升级至真 3D 盘旋与室内微气流模型，再递增 `FLIGHT_MODEL_VERSION` 替换该代理项。

---

## 3. 世界纪录与机型史实口径统一（2026-11 核实）

- **距离世界纪录（现役）**：**98.43 m**（2025-12-28，刘立文及团队，吉尼斯世界纪录）。
- **Mach 5（历史里程碑）**：**88.31 m**（2022-12，Boeing 工程师 Dillon Ruble / Garrett Jensen / Nathaniel Erickson）。由于原机折图未公开，本作中的 `mach5` 明确标注为**X-43A 风格工程近似机型**，而非原机精确复刻。
- **Suzanne（历史里程碑）**：**69.14 m**（2012，John Collins 设计 / Joe Ayoob 投掷，约 9 s）。
- **滞空纪录沿革（明确区分三者）**：
  - **Sky King**：**27.9 s**（2009，户田拓夫）；
  - **Zero Fighter（历史挑战里程碑）**：**29.2 s**（2010，户田拓夫，本作暂无该机型几何）；
  - **现役滞空世界纪录**：**31.2 s**（2026-02，Rao Chongyi 等团队成员）。
