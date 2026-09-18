/* ============================================================
 * 翎雁 LY-100 · 工程计算模型 (Engineering Model)
 * 设计舱 / 性能舱 / 任务舱 / 安全舱 共用的同一套算法。
 * 模型性质：方案阶段工程估算（概念设计 CFD/台架数据拟合系数），
 *           精度定位为"方案论证级"，不替代风洞实测。
 * 单位：SI（m, kg, s, W, Wh），显示层自行换算。
 * ============================================================ */
"use strict";

const ENG = (() => {

  /* ---------- 常量与环境 ---------- */
  const RHO = 1.225;          // 海平面标准大气密度 kg/m³
  const G = 9.81;
  const BATT_EN_DENS = 250;   // 高比能锂离子电芯 21700 组能量密度 Wh/kg
  const BATT_USABLE = 0.85;   // 放电深度与线损折减后的可用容量系数
  const ESC_EFF = 0.95;
  const HOV_W_SPEC = 165;     // 悬停电功率比功率基准 W/kg（同类 5kg 级垂起台架拟合）

  /* ---------- 默认构型（与《一体化设计方案》基准构型一致） ---------- */
  const DEFAULT = {
    wing:   { b: 2.6, S: 0.62, airfoil: "NACA2412", e: 0.85, CD0: 0.035 },
    batt:   { cells: 6, capAh: 16.0 },           // 6S2P 21700
    motorL: { model: "AT2814-KV900", kv: 900, m: 0.129 },
    escL:   { model: "20A", m: 0.018 },
    propL:  { model: "10×4.5 in", d: 0.254, m: 0.024 },
    motorP: { model: "MN3110-KV700", kv: 700, m: 0.230 },
    escP:   { model: "40A", m: 0.040 },
    propP:  { model: "13×6.5 in", d: 0.330, m: 0.045 },
    fixed:  {                                    // 与载荷选择无关的机体项
      structure: 1.30, avionics: 0.30, wiring: 0.18,
    },
    loads:  {                                    // 任务载荷（可勾选）
      eoGimbal:  { name: "三轴云台可见光相机", m: 0.62, on: true },
      multiSpec: { name: "五通道多光谱模块",   m: 0.18, on: true },
      edgeAI:    { name: "机载边缘 AI 模块（6 TOPS NPU）", m: 0.18, on: true },
      adsb:      { name: "ADS-B 接收 / 电子围栏终端", m: 0.04, on: true },
    },
    vCruise: 19.0,                               // 基准巡航真速 m/s
    vtolAlt: 120,                                // 垂起作业高度 m
  };

  /* ---------- 重量堆叠 ---------- */
  function mass(cfg) {
    const f = cfg.fixed;
    // 250 Wh/kg 为电芯级能量密度；成组系数（BMS/箱体）约 +15%~20%，概念设计阶段并入结构余量
    const battKg = (cfg.batt.cells * 3.7 * cfg.batt.capAh) / BATT_EN_DENS;
    const loadsKg = Object.values(cfg.loads).reduce((s, l) => s + (l.on ? l.m : 0), 0);
    const propulsionL = 4 * (cfg.motorL.m + cfg.escL.m + cfg.propL.m);
    const propulsionP = cfg.motorP.m + cfg.escP.m + cfg.propP.m;
    const items = [
      ["机体结构（机身/机翼/尾翼）", f.structure],
      ["升力动力 ×4（电机+电调+桨）", propulsionL],
      ["巡航动力 ×1（尾推电机+电调+桨）", propulsionP],
      ["动力电池组", battKg],
      ["飞行航电（双飞控/RTK/数传）", f.avionics],
      ["任务载荷", loadsKg],
      ["线缆与紧固件", f.wiring],
    ];
    const mtow = items.reduce((s, it) => s + it[1], 0);
    return { items, mtow, loadsKg, battKg, structureRatio: f.structure / mtow };
  }

  /* ---------- VTOL 垂直段 ---------- */
  function vtol(cfg, mtow) {
    const disc = 4 * Math.PI * Math.pow(cfg.propL.d / 2, 2);      // 4 桨总盘面积
    const discLoad = mtow * G / disc;                             // 盘载荷 N/m²
    const pHover = HOV_W_SPEC * mtow * (0.85 + 0.15 * discLoad / 243); // 盘载荷修正
    const tClimb = cfg.vtolAlt / 4.0;                             // 4 m/s 爬升
    const eClimb = pHover * 1.35 * tClimb / 3600;                 // 爬升段功率系数 1.35
    const eTrans = 9.0;                                           // 倾转过渡段经验值 Wh（45 s 均值 700 W）
    const pTO = pHover * 1.45;                                    // 起飞瞬间峰值
    return { disc, discLoad, pHover, pTO, tClimb, eClimb, eTrans, eTotal: eClimb + eTrans };
  }

  /* ---------- 巡航平飞段 ---------- */
  function cruise(cfg, mtow, vAir) {
    const { S, e, CD0 } = cfg.wing;
    const AR = cfg.wing.AR || cfg.wing.b * cfg.wing.b / S;   // 展弦比（未配置时派生）
    const q = 0.5 * RHO * vAir * vAir;
    const CL = mtow * G / (q * S);
    const CD = CD0 + CL * CL / (Math.PI * AR * e);
    const D = CD * q * S;
    const Paero = D * vAir;                       // 需用气动功率 W
    const Pelec = Paero / (0.60 * ESC_EFF);       // 螺旋桨推进效率 0.60（台架拟合）
    return { CL, CD, D, Paero, Pelec };
  }

  /* ---------- 功率-空速扫描（性能舱曲线），不绘制失速以下区段 ---------- */
  function polar(cfg, mtow, vLo = 11, vHi = 30, n = 60) {
    const lo = Math.max(vLo, stall(cfg, mtow).v * 1.1);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const v = lo + (vHi - lo) * i / n;
      pts.push([v, cruise(cfg, mtow, v).Pelec]);
    }
    return pts;
  }

  /* ---------- 续航与航程（含顶风修正） ---------- */
  function endurance(cfg, mtow, wind = 0) {
    const battWh = cfg.batt.cells * 3.7 * cfg.batt.capAh;
    const avail = battWh * BATT_USABLE;
    const vt = vtol(cfg, mtow);
    const pc = cruise(cfg, mtow, cfg.vCruise).Pelec;
    const tCruise = Math.max(0, (avail - vt.eTotal) / pc);        // h
    const vGround = Math.max(0, cfg.vCruise - wind);
    return {
      battWh, avail, vtol: vt, pCruise: pc,
      enduranceH: tCruise,
      rangeKm: tCruise * vGround * 3600 / 1000,
      iCruise: pc / (cfg.batt.cells * 3.7),
    };
  }

  /* ---------- 失速与速度裕度 ---------- */
  function stall(cfg, mtow) {
    const CLmax = 1.15;
    const v = Math.sqrt(2 * mtow * G / (RHO * cfg.wing.S * CLmax));
    return { v, margin: cfg.vCruise / v };
  }

  /* ---------- 航测覆盖（任务舱 A） ---------- */
  function survey(cfg, mtow, p) {
    // p: { lenKm, widKm, altM, sideOv, fwdOv, vGnd }
    const sensor = { pxUm: 1.2, swMm: 9.6, shMm: 7.2, fMm: 8.8, mp: 48 }; // 1/1.3" 48MP
    const gsd = sensor.pxUm * 1e-6 * p.altM / (sensor.fMm * 1e-3) * 100;   // cm
    const swathW = sensor.swMm / sensor.fMm * p.altM;                      // 旁向幅宽 m
    const swathH = sensor.shMm / sensor.fMm * p.altM;                      // 航向幅宽 m
    const lineGap = swathW * (1 - p.sideOv / 100);
    const shotGap = swathH * (1 - p.fwdOv / 100);
    const nLines = Math.max(1, Math.ceil(p.widKm * 1000 / lineGap));
    const len = p.lenKm * 1000;
    const perLineShots = Math.floor(len / shotGap) + 1;
    const photos = nLines * perLineShots;
    const turnR = 45;                                                       // 半 U 型转弯过渡半径 m
    const pathLen = nLines * len + (nLines - 1) * Math.PI * turnR * 0.5;   // 90° 弧长，等效半径 R/2
    const tFly = pathLen / p.vGnd / 60;                                     // min
    const tTot = tFly + 3.2;                                                // +垂起/过渡/降落
    const eNeed = endurance(cfg, mtow);
    const eUsed = (tTot / 60) * eNeed.pCruise + eNeed.vtol.eTotal;
    const sorties = Math.max(1, Math.ceil(eUsed / eNeed.avail));
    return { gsd, swathW, swathH, lineGap, shotGap, nLines, photos, pathKm: pathLen / 1000, tFly, tTot, eUsed, sorties, sensor };
  }

  /* ---------- 合规判定（安全舱） ----------
   * 依据：《无人驾驶航空器飞行管理暂行条例》（国务院令第761号，2024-01-01施行）第62条；
   * 空机重量按民航局口径【含电池、不含任务载荷】（AC-91-FS-2015-31 §3.16）。
   * 微型：空机重量 ≤ 0.25kg；
   * 轻型：空机重量 ≤ 4kg 且 MTOW ≤ 7kg（另需空域保持能力等条件）；
   * 小型：空机重量 ≤ 15kg 且 MTOW ≤ 25kg（空机 > 4kg 时即落此类别，
   *        操控员须持 CAAC 执照、作业单位须取得运营合格证）。
   */
  function compliance(cfg, mtow) {
    const m = mass(cfg);
    const emptyKg = mtow - m.loadsKg;             // 空机重量（含电池）
    const micro = emptyKg <= 0.25;
    const light = !micro && mtow <= 7 && emptyKg <= 4;
    const small = !micro && !light && mtow <= 25 && emptyKg <= 15;
    return {
      category: micro ? "微型" : (light ? "轻型" : (small ? "小型" : "中型及以上")),
      light, small, mtow, emptyKg,
      items: [
        { t: "最大起飞重量 " + mtow.toFixed(2) + " kg ≤ 25 kg，空机重量（含电池，不含任务载荷）" + emptyKg.toFixed(2) + " kg > 4 kg，判定为小型无人机（条例第 62 条）", ok: small },
        { t: "小型类别强制要求：操控员持 CAAC 执照（第 16 条），作业单位取得运营合格证（第 11 条）", ok: true },
        { t: "具备空域保持能力与可靠被监视能力：电子围栏 + 远程识别广播（GB 42590）+ ADS-B 接收", ok: true },
        { t: "作业真高 ≤ 120 m 且位于管制空域之外，适飞空域内飞行无需空域申请（第 19/31 条）", ok: true },
        { t: "实名登记：民用无人驾驶航空器综合管理平台（UOM）实名注册", ok: true },
        { t: "建议投保第三者责任险，人口密集区上空作业提前评估并设应急降落区", ok: true },
      ],
    };
  }

  /* ---------- WFEA：风场感知分段自适应巡航 ----------
   * 相对无风最省能量工作点，逆风段被风场推向更高真空速、顺风段可更低——
   * 两段各自取能量最优点，得到能量-时间 Pareto 上的能量优先工作点。
   * 段能耗 E(d,w) = min_v  P_elec(v)·d / (v − w)，w 为航向上风速投影（正=顶风）。
   * 返回 { vAir, energyWh, tMin }。 */
  function segmentEnergy(cfg, mtow, distM, wAlong) {
    const m = mass(cfg);
    const vS = stall(cfg, mtow).v * 1.15;
    let best = null;
    for (let v = vS; v <= 28; v += 0.25) {
      const vg = v - wAlong;
      if (vg < 2) continue;                       // 地速过低，不进入可行域
      const tS = distM / vg;
      const E = cruise(cfg, mtow, v).Pelec * tS / 3600;
      if (!best || E < best.E) best = { vAir: v, E, tMin: tS / 60 };
    }
    if (!best) {                                  // 极端侧风/超界防御：取扫描上限
      const P = cruise(cfg, mtow, 28).Pelec;
      best = { vAir: 28, E: P * distM / (28 - wAlong) / 3600, tMin: distM / (28 - wAlong) / 60 };
    }
    return best;
  }

  /* A/B 对比：航线总长 pathKm，风沿航线轴向分量 wAlong（|w|，往返各半）。
   * base：全程定速 vCruise；wfea：分段最优。返回对比结果。 */
  function wfeaCompare(cfg, mtow, pathKm, wAlong) {
    const halfM = pathKm * 500;                   // 往返各半
    // 基线：定速
    const pBase = cruise(cfg, mtow, cfg.vCruise).Pelec;
    const tUpBase = halfM / Math.max(1, cfg.vCruise - wAlong);
    const tDnBase = halfM / (cfg.vCruise + wAlong);
    const Ebase = pBase * (tUpBase + tDnBase) / 3600;
    // WFEA：逆风段/顺风段各自取最优真空速
    const up = segmentEnergy(cfg, mtow, halfM, wAlong);
    const dn = segmentEnergy(cfg, mtow, halfM, -wAlong);
    const Ewfea = up.E + dn.E;
    return {
      base: { energyWh: Ebase, tMin: (tUpBase + tDnBase) / 60, vAir: cfg.vCruise },
      wfea: { energyWh: Ewfea, tMin: up.tMin + dn.tMin, vUp: up.vAir, vDown: dn.vAir },
      savingPct: (1 - Ewfea / Ebase) * 100,
      wAlong,
    };
  }

  /* ---------- 双机对飞协同调度（线性目标单程巡检） ----------
   * A 机自西端、B 机自东端（车载投放）相向飞行，同时完工于相遇点 x。
   * 同时完工条件 x/(v−w) = (L−x)/(v+w) ⇒ x = L·(v−w)/(2v)：
   * 顶风越大，逆风飞行单机分配的航段越短，相遇点越靠近其出发端。
   * 单程不返航的可行性由视觉引导车载精准降落（±10 cm）支撑。 */
  function relaySim(cfg, mtow, L_km, wAlong) {
    const v = cfg.vCruise;
    const en = endurance(cfg, mtow);
    const tSingleS = L_km * 1000 / Math.max(1, v - wAlong);   // s（米制距离 ÷ 真空速）
    const xKm = L_km * (v - wAlong) / (2 * v);
    const tDualS = L_km * 1000 / (2 * v);                      // 两机同时完工，墙钟与风无关
    const eSingle = en.pCruise * tSingleS / 3600;              // 能量 = 定速功率 × 自身航时
    const eEach = en.pCruise * tDualS / 3600;                  // 两机等时 ⇒ 能量精确减半
    return {
      single: { tMin: tSingleS / 60, energyWh: eSingle },
      dual: { tMin: tDualS / 60, energyWhA: eEach, energyWhB: eEach, xKm },
      L_km, wAlong,
    };
  }

  return { DEFAULT, RHO, G, mass, vtol, cruise, polar, endurance, stall, survey, compliance, segmentEnergy, wfeaCompare, relaySim };
})();
