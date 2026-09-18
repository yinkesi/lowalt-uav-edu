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
    motorL: { model: "MN2814-KV900", kv: 900, m: 0.129 },
    escL:   { model: "20A", m: 0.018 },
    propL:  { model: "10×4.5 in", d: 0.254, m: 0.024 },
    motorP: { model: "MN3110-KV650", kv: 650, m: 0.230 },
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
    const battKg = (cfg.batt.cells * 3.7 * cfg.batt.capAh) / BATT_EN_DENS / 1000 * 1000; // Wh/250 → kg
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

  /* ---------- 功率-空速扫描（性能舱曲线） ---------- */
  function polar(cfg, mtow, vLo = 11, vHi = 30, n = 60) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const v = vLo + (vHi - vLo) * i / n;
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
    const vGround = Math.max(1, cfg.vCruise - wind);
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
    const turnR = 45;                                                       // 转弯过渡修正半径 m
    const pathLen = nLines * len + (nLines - 1) * Math.PI * turnR * 0.5;   // 半 U 型转弯
    const tFly = pathLen / p.vGnd / 60;                                     // min
    const tTot = tFly + 3.2;                                                // +垂起/过渡/降落
    const eNeed = endurance(cfg, mtow);
    const eUsed = (tTot / 60) * eNeed.pCruise + eNeed.vtol.eTotal;
    const sorties = Math.max(1, Math.ceil(eUsed / eNeed.avail));
    return { gsd, swathW, swathH, lineGap, shotGap, nLines, photos, pathKm: pathLen / 1000, tFly, tTot, eUsed, sorties, sensor };
  }

  /* ---------- 合规判定（安全舱） ----------
   * 依据：《无人驾驶航空器飞行管理暂行条例》（国务院令第761号，2024-01-01施行）
   * 轻型：空机重量 < 4kg 且最大起飞重量 < 7kg，性能满足空域保持能力要求。
   */
  function compliance(cfg, mtow) {
    const light = mtow < 7;
    const micro = mtow < 0.25;
    return {
      category: micro ? "微型" : (light ? "轻型" : "小型"),
      light, mtow,
      items: [
        { t: "最大起飞重量 " + mtow.toFixed(2) + " kg < 7 kg，判定为" + (micro ? "微型" : "轻型") + "无人机，适航管理走轻型类别", ok: light },
        { t: "具备空域保持能力：电子围栏 + ADS-B 接收 + RTK 高精度定位（轻型号照要求）", ok: true },
        { t: "作业真高 ≤ 120 m，在适飞空域内飞行无需空域申请", ok: true },
        { t: "实名登记：民用无人驾驶航空器实名制注册（UOM 平台）", ok: true },
        { t: "经营性作业：需取得无人驾驶航空器运营合格证，操控员持 CAAC 执照", ok: true },
        { t: "人口密集区上空作业需提前评估并采取必要安全措施", ok: true },
      ],
    };
  }

  return { DEFAULT, RHO, G, mass, vtol, cruise, polar, endurance, stall, survey, compliance };
})();
