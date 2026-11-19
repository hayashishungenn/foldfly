# AGENTS.md — 给编码代理的工作说明

**一纸冲天 FoldFly** — 网页纸飞机模拟:选真实纸张 → 分步折出历史经典机型 → 投掷,用几何驱动的空气动力学计算飞行成绩。

## 必读文档(按顺序)

1. [BRIEF.md](BRIEF.md) — 任务书:需求清单(P0/P1/P2)、非目标、验收标准
2. [PLAN.md](PLAN.md) — 架构设计、技术选型、M0–M4 里程碑
3. [docs/REFERENCES.md](docs/REFERENCES.md) — 纪录史实(已核实)、技术文献、同类项目
4. [docs/DESIGN.md](docs/DESIGN.md) + [docs/ui-reference.html](docs/ui-reference.html) — 视觉规范(色板/字体/线框),UI 实现以它为准

## 硬性约束(违反即返工)

1. 技术栈:TypeScript + Vite,渲染 v1 用 Canvas 2D;
2. 引擎与渲染彻底分离:`src/fold/`、`src/aero/` 是纯逻辑模块,不 import 任何 DOM/Canvas,必须可被 vitest 单测;
3. **气动参数禁止手调**:质量/重心/翼面积/展弦比一律由 `aero/extract.ts` 从折叠几何 + 纸张克重计算(公式见 PLAN.md 第一节第 3 点);
4. 三个校准锚点必须数量级吻合:Suzanne 69.14 m / Mach 5 88 m / Sky King 29.2 s;
5. 机型是数据文件(`src/fold/planes/*.ts`),不是硬编码逻辑;
6. 渲染/文案遵循 docs/DESIGN.md 的色板与字体 token,不引入规范外的颜色和字体;
7. 引擎逻辑必须有单测;每完成一个里程碑跑全量测试。

## 起步顺序

从 M1 开始:Vite 脚手架 → 纸张规格库 → 经典尖头机折序 → 几何驱动纵向飞行 → 投掷台。
M0 参考原型(仅作路线验证,未完整测试,不要求沿用其代码):
`~/.zcode/v2/visualizations/0421763ec78d869cdc7f9d6e1b7c35d4326188ba39b9852a192c0ea3dd78467a/paper-plane-workshop.html`
