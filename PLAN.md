# 纸飞机工坊(Paper Plane Workshop)— 调研与开发计划 v2

> 产品定义:**模拟折纸飞机**——选用各种规格的真实纸张 → 跟着步骤折出**历史上纸飞机比赛中的经典机型** → 放飞,由**空气动力学运算**决定飞行成绩。
> 市场空白:GitHub 上折纸模拟和飞行实验各自存在,但「真实纸张 × 历史机型 × 物理飞行」的完整闭环没有先例。
> **2026-11 起**:持续开发总指令的 Phase 01–12 阶段定义、规范冲突修订与交付记录见 [docs/PHASES.md](docs/PHASES.md);本文档的 M1–M3 已交付,M4 的真 3D 与自由折由 Phase 03–05 承接。

---

## 一、调研结论

### 1. 纸飞机竞赛史与经典机型(已核实)

| 年份 | 机型 | 纪录 | 设计者/掷手 | 设计思想 |
|---|---|---|---|---|
| 1998 | Ken Blackburn 机型 | 滞空 27.6 s,保持 13 年 | 航空工程师 Ken Blackburn | 大翼面积滑翔, slow&high 路线 |
| 2009–2010 | **Sky King**(Toda) | 滞空 27.9 s → 2010 年 **29.2 s**(至今) | 户田拓夫(Takuo Toda) | 极简折法、大翼面、靠上升气流爬升 |
| 2012 | **Suzanne** | 距离 69.14 m | John Collins 设计,Joe Ayoob 掷出 | **第一个拿距离纪录的滑翔机**,大展弦比、微调配重 |
| 2022.4 | 韩国三人组机型 | 距离 77 m | 韩国团队 | — |
| 2022.12 | **Mach 5**(现行纪录) | 距离 **88 m**(289 ft 9 in) | Boeing 三工程师 Ruble/Jensen/Erickson | 仿 NASA X-43A 高超声速翼型,低阻高速;耗时约 500 小时;**A4 纸最佳;最佳投掷角约 40°,尽可能大力** |

三个对产品有直接指导意义的结论:

1. **距离机和滞空机是两种设计哲学**(Mach 5 团队原话:滞空机要"增大翼展、降低展弦比")→ 我们的气动引擎必须能同时体现这两类最优解,否则经典机型的"个性"出不来。
2. **纸张是变量**:Mach 5 实测 A4 优于 US Letter;真实比赛中克重、尺寸都影响成绩 → 印证"纸张规格库"是核心玩法而非装饰。
3. **投掷技术是变量**:40° 大力 vs 轻抛爬升,同一架飞机成绩差数倍 → 投掷参数(角度/力度/风)必须可调,且与机型特性耦合(如 Sky King 轻抛才滞空,Mach 5 大力才飞远)。

### 2. 折叠模拟技术路线(沿用 v1 结论,补充机型库复杂度问题)

- **v1 采用关键帧式折叠**:预设折序,每步面片绕折痕轴旋转 + 提交时反射。可控、无穿模、工作量最小。
- **新风险——历史机型折法更复杂**:Suzanne 约 11 步,含塞入/锁定(锁机头)、局部折;经典 2D 反射引擎表达不了全部动作。
- 对策:扩展折叠原语——`谷折/山折/部分折(到指定点)/塞入(lock)/翻面`,并允许一步含多条折痕同步执行;个别真实步骤中纯 2D 无法表达的(如撑开),用"预设中间形态跳转 + 过渡动画"兜底。原则:**跟着折完的体验 > 几何严格性**。
- 真自由折叠(画折痕)仍在远期 M4,层序问题是 NP 级深水区(Demaine 厚纸折叠论文),不阻塞主线。

### 3. 空气动力学:从"手调参数"升级为"几何驱动运算"

用户核心诉求是"飞出去时要真实运算"。方案:**所有气动输入都从折叠结果和纸张规格中计算出来,而不是拍脑袋调参**:

```
质量 m       = Σ(每层多边形面积)× 纸张克重 gsm          ← 折叠引擎精确可算
重心 CG      = 各层面积加体质心                          ← 精确可算
翼展 b、翼面积 S、展弦比 AR = b²/S、上反角 Γ             ← 从折叠完成态几何直接测量
升力线斜率    CLα ≈ 2π·AR/(AR+2)(小展弦比修正)
诱导阻力      CDi = CL²/(π·AR·e);零升阻力 CD0 由浸润面积估计
俯仰稳定      静稳定余量 = (CG − 焦点距离)/机头长度,配重前移→更稳但下沉更快
失速          α > ~16° 升力骤降(投太猛先窜高再扎头,真实手感)
```

**验证口径(校准锚点)**:同一套引擎,经典尖头机 A4/80g 中等力度 ≈ 10–20 m;Suzanne 按职业投掷 ≈ 50–70 m 量级;Mach 5 大力 40° 应显著优于 Suzanne;Sky King 轻抛滞空应显著最长。三个历史数据点(69.14 m / 88 m / 29.2 s)作为引擎调校的 sanity check,而不是硬编码目标。

纸张规格的真实物理作用(全部进入运算):
- **克重 gsm → 质量**:80gsm A4 ≈ 5 g,100gsm ≈ 6.2 g → 配平速度、抗风性、动能都不同;轻纸滞空、重纸破风。
- **尺寸 → 折叠几何**:A4/Letter/A5/B5/正方形折同一机型翼载荷不同 → 成绩不同(呼应 Mach 5 团队"A4 最佳"的发现)。
- **刚度 → 折痕质量**(v1 仅视觉表现:v2 可引入"折痕不齐"轻微降低 e 效率因子)。

---

## 二、产品三大支柱

### 支柱 1:纸张规格库
- 常见规格:A4、US Letter、A5、B5、正方形(折纸专用);
- 克重:新闻纸 ~45 / 折纸专用纸 ~60 / 复印纸 70/80 / 高质量打印纸 100 gsm(v1 为主力区间);
- 每种纸显示:尺寸图示、克重、"手感"描述与适用机型提示(如 A4·80gsm:「比赛经典规格,Mach 5 同款」)。

### 支柱 2:经典机型库(参考案例)
每个机型 = **历史卡片**(年份/纪录/设计者/设计故事)+ **分步折法**(折法 DSL)+ **气动档案**(预期弹道特性、推荐投掷方式):

| 优先级 | 机型 | 定位 |
|---|---|---|
| P0 | 经典尖头机 | 新手引导,童年回忆,6 步入门 |
| P0 | **Suzanne**(Collins, 2012) | 距离传奇,大展弦比滑翔教材 |
| P0 | **Mach 5**(Boeing, 2022) | 现行距离纪录 88 m,低阻高速路线 |
| P1 | **Sky King**(Toda) | 滞空纪录 29.2 s,极简折法 |
| P1 | Ken Blackburn 机型 | 13 年滞空王朝,大翼面路线 |
| P2 | White Wings 系列滑翔机 | 日本竞赛纸飞机,精细调校流 |

机型库是**数据不是代码**:每架飞机就是一个 JSON/TS 折序文件(折痕序列 + 文案 + 气动修正项),社区可贡献新机型。

### 支柱 3:真实气动飞行
- 投掷台:角度(0–75°)、力度(≤ 28 m/s,参考职业投手)、风向风速;
- 输出:飞行距离、滞空时间、最高高度、弹道曲线;完整运动方程见上节;
- 「挑战赛模式」对标 Red Bull Paper Wings 三个项目:**距离赛 / 滞空赛**(花式赛远期),内置历史纪录线(69.14 m、88 m、29.2 s)当挑战目标——把"破纪录"变成游戏目标。

---

## 三、技术选型与架构

**选型**(同 v1 结论):TypeScript + Vite + Canvas 2D(v1,伪 3D 斜投影)→ Three.js(M4);物理自研(无现成引擎支持纸模型);Zustand 管理阶段状态。

```
foldfly/
├── src/
│   ├── paper/papers.ts          # 纸张规格库:尺寸、克重、描述 → 质量密度函数
│   ├── fold/
│   │   ├── types.ts             # Sheet/FoldOp(谷山/部分折/塞入/翻面)/Step
│   │   ├── geometry.ts          # 多边形半平面剖分、反射、质心/面积/层面积
│   │   ├── engine.ts            # 折叠状态机、重放、撤销
│   │   ├── animate.ts           # 绕折痕轴旋转插值、层序绘制、缓动
│   │   └── planes/              # 机型库(数据):dart / suzanne / mach5 / skyking …
│   ├── aero/
│   │   ├── extract.ts           # 折叠完成态 → m/CG/b/S/AR/Γ(几何驱动核心)
│   │   ├── model.ts             # CL(α)/CD(α)/俯仰力矩/失速/风
│   │   ├── integrator.ts        # 半隐式欧拉,固定步长 1/240;3DOF 预留
│   │   └── calibrate.ts         # 对 69.14m/88m/29.2s 锚点的校准工具(开发用)
│   ├── render/                  # fold2d.ts / flight2d.ts(相机、地面、轨迹、纪录幽灵)
│   ├── ui/                      # 纸张选择、机型图鉴、折纸视图、投掷台、挑战赛
│   └── main.ts
└── tests/                       # geometry / extract / model 的 vitest 单测
```

**核心原则不变:引擎与渲染分离;折叠结果是一个纯几何对象,气动参数全部由 `extract.ts` 从该对象 + 纸张规格推导。**

---

## 四、里程碑

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **M0 技术验证**(已有半成品原型) | 单文件 Canvas:尖头机折叠动画 + 2D 飞行 | 动画不出错;飞行手感自然 |
| **M1 工程化 + 首个完整闭环** | Vite/TS 重构;纸张库(A4/Letter/正方形 × 3 克重);经典尖头机;几何驱动的纵向飞行(m/CG/S/AR 全部由引擎计算);投掷台 | 换 80→100 gsm 纸,同一投掷成绩可感知变化;换纸张尺寸弹道改变 |
| **M2 经典机型库 + 折飞联动** | Suzanne / Mach 5 / Sky King 折序 + 历史卡片;折叠原语扩展(部分折/塞入);风场;纪录幽灵 | 三机型弹道特征分明:Mach 5 大力距离最远、Sky King 轻抛滞空最长;与锚点数量级吻合 |
| **M3 挑战赛 + 打磨** | 距离赛/滞空赛模式;历史纪录线(88 m / 29.2 s)挑战;成绩分享(URL 编码折序+投掷参数);音效纸感 | 可分享挑战链接;破纪录有仪式感 |
| **M4(远期)真 3D 与自由折** | Three.js 渲染;3DOF 飞行(横滚/偏航/上反角效应);用户画折痕自由折叠 | 自由折出能飞的机型 |

## 五、主要风险与对策

1. **历史机型折法超出 2D 引擎表达力**(Suzanne 的锁定机头等)→ 扩展原语 + 允许"简化步骤/跳转中间形态",保体验不保严格几何。
2. **气动校准**容易变成玄学 → `calibrate.ts` 固定锚点(三个世界纪录 + 尖头机常识区间)做回归;先单变量对照再调参。
3. **设计师署名与授权**:Collins/Toda 的折法均为其公开分享内容,机型库卡片必须注明设计者与出处,致敬不冒充。
4. 层序问题(自由折叠)严格隔离在 M4。

## 六、参考资料

**纪录与机型(已核实)**
- [CNN:Mach 5 — Boeing 工程师 88 m 世界纪录(2022.12)](https://www.cnn.com/2023/04/14/world/paper-airplane-boeing-engineers-world-record-scn)(含"40° 最佳投掷角""A4 最佳""滞空机设计哲学"等第一手设计细节)
- [AIAA:Boeing 工程师破纪录公告](https://aiaa.org/2023/04/17/boeing-engineers-break-world-record-for-longest-paper-airplane-flight)
- [Suzanne:Collins 设计,Ayoob 69.14 m(2012)](https://paperace.com/john-collins-and-joe-ayoob-paper-airplane-pioneers)、[Make: 折法教程](https://makezine.com/projects/worlds-best-paper-airplane)
- [Sky King:Toda 27.9 s 及 29.2 s 纪录沿革](https://paperace.com/takuo-toda)、[折法教程](https://www.instructables.com/Fold-Your-Own-Sky-King-Paper-Airplane-World-record)

**折叠与气动理论**
- Ghassaei [Origami Simulator](https://origamisimulator.org)([源码](https://github.com/amandaghassaei/OrigamiSimulator))
- Demaine [厚纸折叠与层序](https://erikdemaine.org/papers/ThickFolding_JMR/paper.pdf);[平折 origami 图灵完备](https://arxiv.org/html/2309.07932v4)
- [NYU 纸飞机空气动力学研究(JFM)报道](https://generalaviationnews.com/2022/10/03/for-latest-research-on-aerodynamics-scientists-turn-to-paper-airplanes)
- 同类项目:[paperfold-lab](https://github.com/TaoweNlin/paperfold-lab)、[suzanne-paper-plane-lab](https://github.com/Sonville/suzanne-paper-plane-lab)、[paper-folding 话题](https://github.com/topics/paper-folding)

**M0 半成品原型**(路线验证参考,未完整测试):`~/.zcode/v2/visualizations/0421763e…/paper-plane-workshop.html`
