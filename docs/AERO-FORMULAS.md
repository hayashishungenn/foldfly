# 气动公式审计清单(Phase 02 / 2.1)

> 逐项记录 `src/aero/*` 与 `scripts/*` 的公式、变量、单位、适用条件、来源分类与调用路径。
> **分类标记**:【G】几何精算 · 【C】经典气动近似 · 【E】实验测量参数 · 【P】经验代理(拟合/映射,非几何推导) · 【U】未验证代理 · 【D】仅展示推算(不参与飞行求解) · 【X】实验选项(非常规 gameplay)。

参考坐标与单位见 [COORDINATES.md](COORDINATES.md)。所有角度内部为弧度、长度 m、质量 kg、力 N、力矩 N·m、压强 Pa、密度 kg/m³、黏度 m²/s。

## 1. 几何与质量属性(extract.ts, mass3d.ts)

| 量 | 公式 / 方法 | 单位 | 分类 | 来源与适用条件 | 调用方 |
|---|---|---|---|---|---|
| 纸层总面积 | Σ area(polygon),层重叠按每层分别计 | m² | 【G】 | shoelace 面积,凸剖分后逐层累加 | extract→mass/inertia |
| 总质量 m | Σ(层面积) × gsm / 1000 | kg | 【G】 | gsm 为 g/m²,除以 1000 得 kg/m²;A4 80gsm=4.9896 g 可独立解析校验 | extract→integrator/solver |
| 重心 CG | 3D 面片路径:Σ(Aᵢ·centroidᵢ)/ΣAᵢ;2D 路径:翼层加质心 + 机身层投影替换 | m | 【G】/【C】 | 3D 路径由 massFaces3d 精确积分;2D 路径中机身竖直层 x 坐标以 bodyAxisX 代替,属等效投影近似 | extract→pitch moment/AC 余量 |
| 翼面投影面积 S | 翼层多边形并集(非负面积环差) | m² | 【G】 | polygon-clipping 布尔并集,纳米网格吸附防退化;重叠纸层**不**重复计入受力面积 | extract→q/AR/CD |
| 翼展 b | max(x) − min(x) of wing layers | m | 【G】 | 平展投影宽度 | extract→AR/solver |
| 翼弦 c | max(y) − min(y) of wing layers | m | 【G】 | 纵向全长;平均气动弦以面积/展长替代时不另算 | extract→Re/静稳定余量 |
| 展弦比 AR | b² / S | — | 【G】 | 标准定义 | extract→CLα/CDi |
| 机身侧面积 | 中条机身层投影并集 | m² | 【G】/【C】 | 竖直机身按侧视投影,左右半幅可重合 | extract→bodyRatio/侧向稳定 |
| 湿润面积 S_wet | 2×(翼轮廓并集 + 机身侧面积) | m² | 【C】 | 双面近似,忽略折层间不可湿表面与机身厚度 | extract→skinFriction |
| 俯仰惯量 Iyy | Σ∫(y−CG_y)² dA × gsm/1000 + 竖直高度贡献 | kg·m² | 【G】/【C】 | 2 点高斯积分精确至三次;竖直贡献按 bodySide 二阶矩 | extract→pitchAcceleration |
| 翼面阻尼二阶矩 | ∫y_rel² dA / S | m² | 【G】 | 解析多边形二阶矩 | extract→pitch damping |
| 等效摩擦弦 | (Σchord / ∫√chord dx)² | m | 【C】 | 层流板等效弦,使 q·cf(S,S_wet) 与条带积分一致 | extract→skinFriction |
| 气动焦点 AC | 逐 x 条带前缘 1/4 弦加权 | m | 【C】 | 经典四分之一弦近似,非实测压力中心 | extract→staticMargin/solver |
| 静稳定余量 SM | (AC_y − CG_y) / c | — | 【C】 | 正=稳定 | extract→UI/诊断/门控 |
| 龙骨后舵臂 | ΣA_aft·(centroid_y−CG_y)/ΣA_aft | m | 【G】/【C】 | 竖直龙骨面积分布几何推导 | extract→v5 风标稳定 |
| 3D 面片面积 | 扇形三角化叉积 | m² | 【G】 | 空间多边形三角积分 | mass3d→3D 质量/CG |

## 2. 基础气动力(model.ts)

| 量 | 公式 | 分类 | 来源与适用范围 |
|---|---|---|---|
| 有限翼升力斜率 CLα | 2π·AR/(AR+2) | 【C】 | 小展弦比修正的经典有限翼公式;与 Polhamus Kp 中斜率(2πAR/(AR+2√(1+(AR/2)²)))来源不同,**不可混用**(2.6) |
| 失速过渡 | (1−tanh((|α|−14°)/6°))/2 | 【E】 | JFM 2022 §5 平板失速实验拟合(14°/6°) |
| 分离流升力 | 0.95·(CLα/5.2)·sin(2|α|) | 【E】 | JFM 平板实验 0.95 与二维斜率 5.2 归一 |
| 低迎角升力 | attachedSlope·sin(|α|),系数由过渡连续条件求得 | 【C】 | 连续拼接,非实测 |
| 零升阻力 CD0 | 0.025 + 0.01·(b·c/S) | 【P】 | 经验拟合值,非几何精算 |
| 诱导阻力 CDi | CL²/(π·AR·0.8) | 【C】/【P】 | 诱导阻力经典式,0.8 奥斯瓦尔德效率为经验取值 |
| 分离流/背向阻力 | (1−过渡)·1.9·sin²|α| | 【E】 | JFM 平板背流系数 1.9 |
| skinFrictionCoefficient | 1.328/√(V·c_eq/ν),翼+机身分别算后归一到 S | 【C】/【X】 | 层流平板公式,**实验对照选项** dragModel='skin-friction',不含形状/干扰阻力 |
| pitchAcceleration | q·S·(−normal·lever − slope·ω·dampingArm/V [+ axial·cgDepth]) / Iyy | 【C】/【X】 | 四分之一弦压力中心 + 分布阻尼近似;高度力矩为实验选项 |

## 3. 经验构型门控与代理(integrator.ts 的 v5 gameplay 路径)

| 参数 | 公式 | 分类 | 物理含义审查(2.7) |
|---|---|---|---|
| fullness | S/(b·c) | 【G】 | 几何比值,但用作“钝头折痕”门控输入是经验映射 |
| cambered | smoothstep(0.61,0.655,fullness) | 【P】 | 无实测拱度;用饱满度代理“折叠机头是否形成弯度” |
| enduranceMode | cambered·smoothstep(1.45,1.68,AR)·smoothstep(0.062,0.042,SM) | 【P】 | 为 Sky King 量级拟合的高 AR/低 SM 门控,非可测物理属性 |
| penetratorMode | cambered·smoothstep(0.095,0.12,SM)·smoothstep(1.08,1.4,c/S) | 【P】 | 为 Mach 5 拟合的高 SM 穿透门控 |
| distanceGliderMode | cambered·(1−endurance)(1−penetrator)·smoothstep(0.92,1.04,c/b)·smoothstep(0.088,0.068,SM) | 【P】 | 为 Suzanne 拟合的宽弦门控 |
| clCamber | 1.92·slowEndurance | 【P】/【U】 | 拱度升力增益系数 1.92 无实测来源,门控产物 |
| eOswald | 0.8+0.15·distanceGlider+0.05·penetrator+7.2·slowEndurance | 【P】/【U】 | **最高约 8.2,远超经典 e≤1**;是为 2D 复现室内滞空的工程等效,非真实 Oswald 效率 |
| weightSupport | 0.76+0.0512·distanceGlider−0.0285·penetrator+0.224·slowEndurance | 【P】 | 配平升力占重量比例的经验拟合 |
| finenessPenalty | 1+0.45·max(0,1.05−c/b)+0.25·bodyRatio | 【P】 | 机身/折层附加 CD0 经验惩罚 |
| climbUnload / steepClimbPenalty / climbDragOpen / highSpeedEnduranceBrake | smoothstep 组合,系数 0.024/0.62/0.035/0.55 等 | 【P】 | 爬升姿态修正,无独立实验来源 |
| forceScale lift/drag | 1−0.10(1−q) / 1+0.25(1−q) | 【P】 | 折痕质量退化通道,系数为工程估计 |
| shapeKeep | min(1,q·crispness/crispness_copy) | 【P】 | 材质定形代理;封顶 1,只允许退化 |

**这些系数全部不是几何精确推导的结果,不得在 UI/文档中描述为几何计算值。**

## 4. 侧向稳定(v5)

| 量 | 公式 | 分类 | 来源 |
|---|---|---|---|
| cyBeta | 1.1·(1+0.5·min(1,bodyRatio)) | 【P】 | 平板侧力系数工程估计 |
| cnBeta | π·(A_keel_aft·l_t)/(S·b) | 【C】 | 低 AR 尾鳍斜率 2π·2/(2+2)=π × 尾鳍体积 |
| cnrNorm | −2·cnBeta·(l_t/b) − cyBeta/3 | 【C】/【P】 | 尾鳍阻尼经典式 + 翼面展向阻尼类比(1/3 为展向二阶矩归一) |
| clBeta | −1.1·(bodySideArea·cgDepth)/(S·b) | 【P】 | 龙骨/钟摆横滚恢复代理 |
| clpNorm | −2.2·AR/(AR+1.5) | 【P】 | 滚转阻尼工程估计 |
| Ixx/Izz | m(b/4)² / Iyy+m(b/4)² | 【C】/【P】 | 翼质量分布代理 |

## 5. 极曲线与展示指标(polar.ts, diagnostics.ts)

| 量 | 分类 | 说明 |
|---|---|---|
| effectiveCoefficients | 【P】 | 与 integrator v5 **同一门控家族的另一份实现**(2.5/2.11 要求统一入口);未含 foldQuality/material 通道,与实时积分条件不一致 |
| computeReynoldsNumber | 【C】/【D】 | Re=V·c/ν,ν=1.511e-5(NASA,20°C);仅展示 |
| computePolhamusBreakdown | 【C】/【D】 | Polhamus 1966 势流/涡升分解;**仅展示涡升占比,未参与飞行合力** |
| groundEffectDragFactor | 【C】/【D】 | McCormick/Wieselsberger 近地因子;**仅展示"减阻比例",未改变轨迹**(2.12) |
| computeStabilityModes | 【C】/【D】 | Stengel 短周期/Phugoid 解析模态;仅展示 |
| telemetryAt | 【C】/【D】 | 由 30 Hz 位置采样差分反推速度、再算 α/CL/CD/力矢量(2.10 要求改为积分状态遥测);与实时积分存在插值/差分误差 |
| analyzeTrajectoryPhases | 【D】 | 能量状态分段与文案,含插值推算 |

## 6. 数值与实验选项

| 项 | 公式/行为 | 分类 | 说明 |
|---|---|---|---|
| RK2 中点积分 | x+=v_mid·dt, v+=a_mid·dt, dt=1/hz | 【C】 | 240 Hz gameplay;120/480/960/1920 用于收敛验证 |
| 落地插值 | fraction=y_old/(y_old−y_new) 线性插值 x/t/pitch | 【C】 | 事件定位;无强制落地/速度裁剪 |
| experimentalHeightMoment | 俯仰力矩 +axial·cgDepth | 【X】 | 高度力矩实验选项,历史收敛研究中验证 |
| pitchModel='empirical' | 固定俯仰恢复 −12(α−eq)−3ω | 【P】/【X】 | 仅对照,不用于 gameplay |
| dragModel='skin-friction' | 层流摩擦下界 | 【X】 | 仅对照 |
| 空气密度 ρ=1.225 kg/m³、g=9.81 m/s² | 常量 | 【E】 | 标准海平面近似,输入层不可调(2.12 要求结构化环境) |

## 7. 调用路径摘要

```
papers.ts(gsm) + fold/* → extract.ts(Aero) ─┬→ integrator.ts(simulate) → Flight.samples
                                            ├→ polar.ts(effectiveCoefficients, computeAeroPolar, sweepLaunchAngles→simulate)
                                            └→ diagnostics.ts(telemetryAt/analyzeFlight) → UI 受力矢量/文案
model.ts(coefficients/pitchAcceleration) ← integrator.ts + polar.ts(独立调用 effectiveCoefficients 内部再调 coefficients)
calibrate.ts → extract+simulate(校验报告);scripts/* → 同上 + sweep/convergence/height-moment
```

**审计结论(驱动 Phase 02 后续任务)**:同一门控家族在 integrator 与 polar 各实现一份(违反 2.5);遥测靠位置差分反推(违反 2.10);大气环境与机体状态未结构化(2.4/2.12);eOswald≈8 与展示型 Polhamus/地面效应均需明确标注;无门控基准模型尚未建立(2.7)。

## 8. Phase 02 模型审查结论(2.6–2.9)

**2.6 基础升阻力模型**:`coefficients()` 使用有限翼斜率 2πAR/(AR+2)、JFM 平板失速参数(14°/6°、0.95、1.9)、经典诱导阻力与零升阻力经验值。负/正迎角严格反对称、阻力对称(测试覆盖 5°–175°);低迎角与失速过渡连续;零空速时 solver 气动力为 0;极低速/极高速度无非物理发散(见 solver-invariants.test.ts)。**注意**:`polar.ts` 的 Polhamus Kp 斜率 2πAR/(AR+2√(1+(AR/2)²)) 与基础模型斜率来源不同,已在 solver 中分别用于配平与俯仰阻尼,不混用。

**2.7 经验门控**:cambered/enduranceMode/penetratorMode/distanceGliderMode/slowEndurance/clCamber/eOswald/配平补偿/爬升阻力修正均为【P】经验代理,不是可测物理量;其中 eOswald 最高约 8.2 明确超出经典 e≤1 适用范围,是 2D 平面复现室内滞空的工程等效。已新增 `model:'baseline'` 无门控基准变体(纯函数 `prepareSolver`/`solveAero`,不参与 gameplay、不改变已发布成绩版本),供后续用独立实验数据逐步替换代理项。**未**仅把门控搬到另一文件后宣称完成物理升级。

**2.8 阻力分项**:诱导阻力 CL²/(π·AR·e) 与零升阻力、分离流阻力分别记录于 `AeroSolution.dragBreakdown`;机身/折层附加阻力以 finenessPenalty 并入零升项(不重复累加);形状阻力与翼身干扰阻力暂无可靠折纸机数据,**未实现并已明示**。地面效应/VDM 仅展示,未加入合力。阻力方向严格与相对空速相反(solver-invariants 测试)。

**2.9 配平与俯仰稳定**:力矩 = qS(−normal·lever − slope·ω_pitch·dampingArm/V + 实验高度力矩),压力中心在配平后迎角处按四分之一弦与翼心插值;静稳定余量 SM=(AC−CG)/c 决定恢复/发散行为。基准模型不添加任何强制姿态恢复力——不稳定构型 continuing 发散(分离流大迎角恢复来自物理极曲线,不是人为回正)。平衡迎角/配平速度/短周期与 Phugoid 周期见 polar.ts(展示型解析近似)。

**2.10–2.12 实施**:`Flight.samples` 写入实际积分状态与统一求解结果(vx/vy/vz/alpha/beta/q/cl/cd/加速度),遥测优先读取这些字段,旧存档回退差分;极曲线由 solver 固定水平参考条件生成并标注;结构化环境(风/垂直风/密度/黏度/种子)经 `SimulationOptions.environment` 注入并参与实际求解,展示型指标明确不参与轨迹。
