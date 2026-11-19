# 参考文件 — 一纸冲天 FoldFly

> 调研汇总:纪录史实(已核实)、技术文献、同类项目、教程与素材。设计风格与 UI 参考另见 [DESIGN.md](DESIGN.md) 与 [ui-reference.html](ui-reference.html)。

## 一、世界纪录与经典机型(史实核查于 2026-10)

| 年份 | 机型 | 纪录 | 设计者 / 掷手 | 报道出处 |
|---|---|---|---|---|
| 2012 | **Suzanne** | 距离 69.14 m(226 ft 10 in),保持十年 | John Collins 设计,橄榄球手 Joe Ayoob 掷出 | [Paper Ace 专文](https://paperace.com/john-collins-and-joe-ayoob-paper-airplane-pioneers)、[Make: 教程](https://makezine.com/projects/worlds-best-paper-airplane) |
| 1970s | **Nakamura Lock** | 红牛世界纸飞机锦标赛常客、世界五大经典之一 | 中村英二（Eiji Nakamura，日本折纸大师） | [Red Bull Paper Wings 官方](https://www.redbull.com/int-en/events/red-bull-paper-wings)、[Fold 'N Fly 教程](https://www.foldnfly.com/1.html) |
| 2022.4 | 韩国三人组机型 | 距离 77 m | 韩国团队 | [CNN 报道中提及](https://www.cnn.com/2023/04/14/world/paper-airplane-boeing-engineers-world-record-scn) |
| 2022.12 | **Mach 5** | 当时距离纪录 **88.31 m**(289 ft 9 in) | Boeing 工程师 Dillon Ruble、Garrett Jensen、Nathaniel Erickson | [CNN](https://www.cnn.com/2023/04/14/world/paper-airplane-boeing-engineers-world-record-scn)、[AIAA 公告](https://aiaa.org/2023/04/17/boeing-engineers-break-world-record-for-longest-paper-airplane-flight) |
| 2009–2010 | **Sky King** 及后续机型 | 当时滞空纪录 27.9 s → **29.2 s** | 户田拓夫(Takuo Toda,日本) | [Paper Ace 专文](https://paperace.com/takuo-toda)、[折法教程](https://www.instructables.com/Fold-Your-Own-Sky-King-Paper-Airplane-World-record) |
| 1998 | **Blackburn Glider** | 滞空 **27.6 s**,保持 13 年 | 航空工程师 Ken Blackburn | [paperplane.org 官方](http://www.paperplane.org/)、[Guinness 纪录](https://www.guinnessworldrecords.com/) |
| 2025.12 | 中国团队机型 | 距离 **98.43 m** | 刘立文及团队 | [吉尼斯纪录](https://www.guinnessworldrecords.com/world-records/farthest-flight-by-a-paper-aircraft) |
| 2026.2 | 中国团队机型 | 滞空 **31.2 s** | Rao Chongyi 等团队成员 | [吉尼斯纪录](https://www.guinnessworldrecords.com/world-records/longest-time-flying-a-paper-aircraft) |

### 来自设计者第一手的工程启示(直接决定我们的游戏设计)

1. **距离机 vs 滞空机是两种设计哲学**。Mach 5 团队:要滞空就"增大翼展、降低展弦比";要距离就低阻高速。→ 气动引擎必须让两条路线都成立,机型才有"个性"。
2. **Mach 5 实测:A4 纸优于 US Letter**;最佳投掷角约 **40°**,尽可能大力;原型设计耗时约 500 小时,灵感来自 NASA X-43A 高超声速飞行器。
3. **Sky King 折法极简但极吃投掷技巧**(轻抛爬升、借上升气流)→ 同一机型不同投掷参数成绩差数倍,"投掷台"是核心玩法不是附属品。

### 折法教程与版权注意

- Suzanne 折法:Collins 在 [Make: 教程](https://makezine.com/projects/worlds-best-paper-airplane)与《The New World Champion Paper Airplane Book》中公开;
- Sky King:Toda 在 YouTube(Oriplane 频道)公开教学;
- **机型库历史卡片必须注明设计者与出处,致敬不冒充**;教程链接放游戏内"参考资料"页。

## 二、折叠模拟技术

### 三条路线(结论:v1 用关键帧式,自由折叠隔离在远期)

| 路线 | 代表 | 适用 | 代价 |
|---|---|---|---|
| 关键帧式折叠(预设折序 + 面片绕折痕轴旋转) | 折纸教学动画、本项目的 M0 原型 | 折法教学类玩法,可控无穿模 | 不支持自由折 |
| 几何引擎(折痕剖分 + 反射 + 层序) | [paperfold-lab](https://github.com/TaoweNlin/paperfold-lab) | 用户画折痕自由折 | 层序判定是 NP 级难题 |
| 物理仿真(bar-hinge FEM + GPU) | [Origami Simulator](https://origamisimulator.org)([源码](https://github.com/amandaghassaei/OrigamiSimulator)) | 受力自折叠研究 | 研究级工程量,不适合游戏 v1 |

### 文献

- Demaine(MIT):[厚纸折叠与层序偏移算法](https://erikdemaine.org/papers/ThickFolding_JMR/paper.pdf) —— 层序问题的权威处理;
- [Flat origami is Turing complete (arXiv 2309.07932)](https://arxiv.org/html/2309.07932v4) —— 说明为何自由折叠不能低估;
- [从折痕图自动生成分步折序(ACM SRC)](https://src.acm.org/binaries/content/assets/src/src/2013/hugoakitaya.pdf) —— 折序数据结构的参考;
- [折痕图数据结构入门](https://jpcasabianca.com/journal/origami-crease-patterns)。
- 标准折纸记号(我们 UI 沿用):谷折 = 虚线 + 空心箭头;山折 = 点划线 + 实心箭头。

## 三、空气动力学

- **理论基础**:纸飞机 = 无动力滑翔机。升力 `L=½ρv²S·CL(α)`,阻力 `D=½ρv²S·CD(α)`,滑翔比 `L/D` 决定距离;重心前置(机头配重)提供俯仰静稳定;攻角 >~16° 失速。
- **几何驱动方案**(本项目核心决策):质量 = Σ层面积×克重;重心 = 面积加质心;翼展/翼面积/展弦比/上反角从折叠完成态测量;`CLα ≈ 2π·AR/(AR+2)`,诱导阻力 `CL²/(π·AR·e)`。禁止手调参数,世界纪录做校准锚点。
- **文献**:[NYU 纸飞机空气动力学研究(JFM)报道](https://generalaviationnews.com/2022/10/03/for-latest-research-on-aerodynamics-scientists-turn-to-paper-airplanes)、[基础物理推导:配平与稳定性](https://www.scribd.com/document/918607655/Aerodynamics-of-Paper-Airplanes-From-Basic-Physics)、[实测升阻曲线](https://www.scribd.com/document/673200649/On-the-Aerodynamics-of-Paper-Airplanes)。

## 四、同类开源项目对照

| 项目 | 有什么 | 没什么(我们的机会) | 可借鉴 |
|---|---|---|---|
| [amandaghassaei/OrigamiSimulator](https://github.com/amandaghassaei/OrigamiSimulator) | WebGL 折痕图受力仿真 | 分步手工折体验、飞行 | 折痕图数据结构、WebGL 方案 |
| [TaoweNlin/paperfold-lab](https://github.com/TaoweNlin/paperfold-lab) | Three.js 分步几何折叠 | 真实机型库、飞行 | 折纸交互 UI、层叠管理 |
| [Sonville/suzanne-paper-plane-lab](https://github.com/Sonville/suzanne-paper-plane-lab) | 纸飞机投掷参数实验 | 折叠环节 | 投掷参数面板、四力矢量教学场景 |
| [charlestytler/PaperAirplaneSim](https://github.com/charlestytler/PaperAirplaneSim) | Stengel 普林斯顿纸飞机纵向动力学方程实现 | 折叠几何提取 | 纵向模态分析(短周期/Phugoid 周期)、时间历程曲线 |
| [tfraudet/glider-polar-analysis](https://github.com/tfraudet/glider-polar-analysis) | 滑翔机升阻/速度极曲线与风场切线求解器 | 纸飞机折叠与实时积分 | 原点切线最佳滑翔比、水平切线最小沉降率、风场修正极曲线 |
| [EivMeyer/PaperplaneSimulator](https://github.com/EivMeyer/PaperplaneSimulator) | 纸飞机俯仰阻尼与失速混合函数模拟 | 真实折纸几何 | 失速前后混合函数、俯仰速率阻尼导数 |
| [20chan/OrigamiSimulator](https://github.com/20chan/OrigamiSimulator) | 小型折纸模拟 | — | 参考 |
| [paper-folding 话题页](https://github.com/topics/paper-folding) | 项目聚合 | — | 持续关注 |

## 五、赛事文化素材

- **Red Bull Paper Wings**:全球最大纸飞机赛事,项目 = 距离 / 滞空 / 花式 → 我们"挑战赛模式"的赛制蓝本;
- 吉尼斯纪录页可查询现役纪录(注意以官方页面为准,本项目文档数字核查于 2026-10);
- 日本折纸飞机协会(户田拓夫主导)的 [Oriplane](https://www.youtube.com/@OriplaneChannel) 频道有大量教学与历史素材。

## 六、M0 半成品原型

单文件验证原型(折叠动画 + 2D 飞行,未完整测试):
`~/.zcode/v2/visualizations/0421763ec78d869cdc7f9d6e1b7c35d4326188ba39b9852a192c0ea3dd78467a/paper-plane-workshop.html`

## 七、补充核实（2026-10）

- Sky King 的 2009 年成绩为 27.9 秒；户田拓夫 2010 年创造的 29.2 秒成绩使用的是 Zero Fighter，不能直接作为 Sky King 的实测成绩。参见 [户田拓夫作品出版商 Tuttle 2026 产品目录](https://tuttlepublishing.com/content/docs/TuttlePublishing_TradeCatalog_Spring2026.pdf) 与 [WIRED 对 2009 年纪录的报道](https://www.wired.com/2009/08/st-alphageek-2/)。29.2 秒可继续作为滞空挑战的历史目标，但不能充当 Sky King 几何模型的实测校准值。
- Guinness 对 Mach 5 距离的公制报道为 88.31 m；本项目任务书使用的 88 m 是近似挑战目标。参见 [Guinness World Records](https://www.guinnessworldrecords.com/news/2026/5/evolution-of-the-paper-plane-flight-and-how-far-its-actually-possible-to-throw-one)。
- Mach 5 团队的 Garrett Jensen 表示纪录使用 A4、100 gsm；[General Aviation News 转载的团队采访](https://generalaviationnews.com/2023/03/21/paper-airplane-sets-world-record/)有原话。校准报告的投掷速度仍是示例，不能当作该次实测速度。

- 关于 Mach 5 的折序：纸飞机资料站 [Fold ’N Fly 的纪录报道](https://www.foldnfly.com/lounge/paper-plane-distance-world-record.php)称原始设计未公开；[一篇日本纸飞机作者的分析](https://ameblo.jp/kamihikouki-creator/entry-12805318880.html)也指出网上类似折图属于推测。这些是二手资料，不能证明其现今法律或保密状态，但足以说明不能将未经证实的教程当作原机。

- 升阻曲线参考 [Journal of Fluid Mechanics: Centre of mass location, flight modes, stability and dynamic modelling of gliders](https://doi.org/10.1017/jfm.2022.89) 第 5 节的平板实验模型：采用失速过渡和正面迎风阻力，并结合本项目由翼面计算的有限展弦比升力斜率。其参数来自平板实验，不等于对具体折纸飞机的实测校准。

- Suzanne 设计者 [John Collins 的折法与纪录说明](https://makezine.com/projects/worlds-best-paper-airplane/)称其 69.14 m 纪录飞行约持续 9 秒。校准报告将时间单独列为对照；现有模拟的折形和投掷条件不是该次纪录的精确复现。
- [NASA Glenn 的阻力说明](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag/)区分表面摩擦和形状阻力。项目当前的摩擦下界不包含形状或干扰阻力；仅有平面折层投影不足以推导完整机体的零升阻力。
- 机身侧视投影可计算重心在翼面下方的距离，但总阻力包含机身和翼面的作用，不能直接假定全部作用于翼面。试加该假定后，720 组纸张及风速边界中的最大步长对照落点差约 6.3 m，且 A4 与正方形在固定示例投掷中的距离差仅约 0.055 m；该力矩项未采用，需先建立可验证的分布式受力模型。
- 经典尖头机的两轮折角依据[史密森尼教程](https://howthingsfly.si.edu/sites/default/files/paper-airplane/NASM_paper_plane_printout_b1p2i5.pdf)，但教程第 5 步的翼根向机头收尖，当前实现用平行翼根近似；最终翼面和气动属性因此不是该教程机型的精确几何。需要支持倾斜翼根及其三维展翼投影后才能消除这一偏差。
- 使用 `npx vite-node scripts/height-moment.ts` 可复现该实验：最大差异发生在简化 Suzanne、A5、70 gsm、75°、28 m/s、顺风 4 m/s；240 Hz 为 12.35 m，480/960/1920 Hz 分别约 18.67/18.65/18.64 m。该 720 组网格中，480 与 1920 Hz 的最大距离差约 0.03 m，因此实验选项默认使用 480 Hz；这不证明受力假设准确，也不保证网格以外的收敛。

## 八、折纸几何与低雷诺数气动理论参考（已融入分析模块）

- **Polhamus 前缘吸力类比（Leading-Edge Suction Analogy）**：Edward C. Polhamus, *A Concept of the Vortex Lift of Sharp-Edge Delta Wings Based on a Leading-Edge-Suction Analogy*, NASA TN D-3767 (1966)。小展弦比尖前缘三角翼/后掠纸机翼的升力由附着势流升力 $C_{L,p} = K_p \sin\alpha\cos^2\alpha$ 与前缘分离涡升力 $C_{L,v} = K_v \cos\alpha\sin^2\alpha$ 叠加组成，用于 `src/aero/polar.ts` 的 `computePolhamusBreakdown`。
- **Stengel 纸飞机纵向模态方程**：Robert F. Stengel, *Flight Dynamics* (Princeton University Press) 及 `PaperPlane_Sim.m`。由纵向静稳定力矩刚度 $M_\alpha$、俯仰阻尼导数 $M_q$ 与最大滑翔比 $(L/D)_{\max}$ 解析短周期俯仰周期 $T_{\text{sp}}$ 与 Lanchester-Prandtl 长周期波状 Phugoid 周期 $T_{\text{ph}} = \pi\sqrt{2} V_{\text{eq}} / g$。
- **McCormick 近地效应诱导阻力折减**：Barnes W. McCormick, *Aerodynamics, Aeronautics, and Flight Mechanics* (1979)。当飞行高度 $h$ 进入翼展 $b$ 尺度内（$h < b$）时，地面限制下洗流使诱导阻力按 $\phi_{\text{GE}}(h/b) = (16h/b)^2 / [1 + (16h/b)^2]$ 衰减，解释纸飞机贴地阶段的“飘浮垫升（Ground Float）”现象。
- **折痕图平折定理（Maekawa & Kawasaki-Justin Theorems）**：Erik D. Demaine & Joseph O'Rourke, *Geometric Folding Algorithms* (Cambridge University Press)。平折内交点满足前川定理 $|M - V| = 2$（偶度数顶点）与川崎定理 $\sum (-1)^i \alpha_i = 0$，用于 `src/fold/crease-pattern.ts` 的 `analyzeCreaseTopology` 折痕图拓扑校验。
