/* ============================================================
 * 翎雁 LY-100 · 任务舱仿真
 * A. 航测覆盖航线：牛耕分解 + 半 U 型转弯 + 照片点位
 * B. AI 巡检模拟：城市场景扫描 → 机载识别事件流 → 巡检报告
 * ============================================================ */
"use strict";

const MISSION = (() => {
  const CSS = getComputedStyle(document.documentElement);
  const COL = {
    blue: CSS.getPropertyValue("--blue").trim(), violet: CSS.getPropertyValue("--violet").trim(),
    pink: CSS.getPropertyValue("--pink").trim(), ink: CSS.getPropertyValue("--ink").trim(),
    ink2: CSS.getPropertyValue("--ink-2").trim(), ink3: CSS.getPropertyValue("--ink-3").trim(),
  };
  const MONO = '10px "JetBrains Mono", monospace';

  /* ---------- 公共画布准备 ---------- */
  function prep(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  function grid(g, w, h, step = 40) {
    g.strokeStyle = "rgba(33,34,38,.06)"; g.lineWidth = 1;
    for (let x = 0; x < w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }

  /* ============================================================
   * A. 航测覆盖
   * ============================================================ */
  let photoPts = [];

  /* p: 任务参数；r: ENG.survey() 的返回结果（nLines/shotGap 等派生量） */
  function drawSurvey(cv, p, r) {
    const { g, w, h } = prep(cv);
    grid(g, w, h);
    // 测区外框（按测区宽高比适配画布）
    const m = 46;
    const ar = p.widKm / p.lenKm;               // 宽/高
    const availW = w - 2 * m, availH = h - 2 * m;
    let rw = availW, rh = rw / ar;
    if (rh > availH) { rh = availH; rw = rh * ar; }
    const x0 = (w - rw) / 2, y0 = (h - rh) / 2;
    // 比例尺（像素/米）
    const s = rw / (p.widKm * 1000);

    g.fillStyle = "rgba(66,133,244,.05)";
    g.fillRect(x0, y0, rw, rh);
    g.strokeStyle = COL.ink; g.lineWidth = 1.4;
    g.strokeRect(x0, y0, rw, rh);
    // 图廓刻度
    g.strokeStyle = COL.ink; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = x0 + rw * i / 4;
      g.beginPath(); g.moveTo(t, y0 - 6); g.lineTo(t, y0); g.stroke();
      g.beginPath(); g.moveTo(t, y0 + rh); g.lineTo(t, y0 + rh + 6); g.stroke();
      const t2 = y0 + rh * i / 4;
      g.beginPath(); g.moveTo(x0 - 6, t2); g.lineTo(x0, t2); g.stroke();
      g.beginPath(); g.moveTo(x0 + rw, t2); g.lineTo(x0 + rw + 6, t2); g.stroke();
    }
    // 航线（牛耕）：行数与曝光间隔来自 ENG.survey 结果
    const n = r.nLines, gapY = rh / n;
    const grad = g.createLinearGradient(x0, 0, x0 + rw, 0);
    grad.addColorStop(0, COL.blue); grad.addColorStop(.5, COL.violet); grad.addColorStop(1, COL.pink);
    g.strokeStyle = grad; g.lineWidth = 1.8; g.lineJoin = "round";
    photoPts = [];
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const y = y0 + gapY * (i + 0.5);
      const ltr = i % 2 === 0;
      const xa = x0, xb = x0 + rw;
      if (i === 0) g.moveTo(ltr ? xa : xb, y);
      g.lineTo(ltr ? xb : xa, y);
      if (i < n - 1) {
        const yn = y0 + gapY * (i + 1.5);
        // 半 U 型转弯，统一向测区外侧凸（真实航飞转弯在测区外完成）
        g.arc(ltr ? xb : xa, (y + yn) / 2, (yn - y) / 2,
              ltr ? -Math.PI / 2 : Math.PI / 2,
              ltr ? Math.PI / 2 : -Math.PI / 2,
              !ltr);
      }
      // 照片点
      const step = r.shotGap * s;
      if (step > 7) {
        const from = ltr ? xa + 10 : xb - 10, to = ltr ? xb - 10 : xa + 10;
        for (let d = 0; d <= Math.abs(to - from); d += step) {
          photoPts.push({ x: ltr ? from + d : from - d, y });
        }
      }
    }
    g.stroke();
    // 照片点（稀疏绘制，避免密集卡顿）
    const skip = Math.max(1, Math.ceil(photoPts.length / 240));
    g.fillStyle = "rgba(66,133,244,.75)";
    for (let i = 0; i < photoPts.length; i += skip) {
      const q = photoPts[i];
      g.beginPath(); g.arc(q.x, q.y, 1.6, 0, 7); g.fill();
    }
    // 起降点
    g.beginPath(); g.moveTo(x0 + 8, y0 + gapY * .5);
    g.fillStyle = "#fff"; g.strokeStyle = COL.pink; g.lineWidth = 2;
    g.arc(x0 + 8, y0 + gapY * .5, 5, 0, 7); g.fill(); g.stroke();
    g.fillStyle = COL.ink2; g.font = MONO; g.textAlign = "left"; g.textBaseline = "top";
    g.fillText("HOME（车载起降点）", x0 + 16, y0 + gapY * .5 - 4);
    // 指北针 + 比例尺
    g.textAlign = "right"; g.fillStyle = COL.ink;
    g.fillText("N ▲", x0 + rw - 4, y0 + 6);
    const barM = 200, bx = x0 + rw - 8 - barM * s, by = y0 + rh + 18;
    g.strokeStyle = COL.ink; g.strokeRect(bx, by, barM * s, 4);
    g.fillRect(bx, by, barM * s / 2, 4);
    g.fillStyle = COL.ink2; g.textAlign = "center";
    g.fillText("0", bx, by + 8); g.fillText("200 m", bx + barM * s, by + 8);
  }

  /* ============================================================
   * B. AI 巡检模拟
   * ============================================================ */
  const KINDS = [
    { key: "pollution", name: "疑似污染源", color: "#2f6f8f" },
    { key: "illegal",   name: "疑似违法建筑", color: "#d96570" },
    { key: "debris",    name: "建筑垃圾堆积", color: "#e2a33c" },
  ];

  function genScene(seed = 7, phase = 1) {
    // 程序化城市场景：街区块 + 河道 + 目标点（坐标按 720×380 设计稿归一化）
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const blocks = [];
    for (let bx = 0; bx < 6; bx++) for (let by = 0; by < 4; by++) {
      if (rnd() < 0.14) continue;
      blocks.push({ x: 40 + bx * 116 + rnd() * 10, y: 36 + by * 106 + rnd() * 8, w: 78 + rnd() * 26, h: 62 + rnd() * 30 });
    }
    const targets = [];
    if (phase === 1) {
      const spots = [[180, 150], [420, 96], [600, 210], [260, 320], [520, 300], [680, 130], [120, 250], [470, 180]];
      spots.forEach((pt, i) => targets.push({ x: pt[0], y: pt[1], kind: KINDS[i % 3], conf: 0.82 + rnd() * 0.16 }));
    } else {
      // 第二期：两期对比。上期 8 处中 6 处已整改销号；2 处逾期未改；1 处新增疑似违建
      const spots = [[420, 96, "keep"], [520, 300, "keep"], [350, 240, "new"]];
      // 保留项与新增项均为违法建筑，须与第 1 期对应目标同类
      spots.forEach((pt) => targets.push({ x: pt[0], y: pt[1], kind: KINDS[1], conf: 0.86 + rnd() * 0.12, isNew: pt[2] === "new" }));
    }
    return { blocks, targets };
  }

  /* 将场景坐标映射到实际画布尺寸（设计稿 720×380 → 画布 w×h）。
   * 同时换算米制实地坐标：约定设计稿 720 px 跨 1440 m（2 m/px），与窗口宽度无关，
   * 供 WGS84 坐标解算使用。 */
  const DESIGN_W = 720, DESIGN_H = 380, M_PER_PX = 2;

  function mapScene(objs, w, h) {
    return objs.map(o => ({
      ...o,
      x: o.x / DESIGN_W * w,
      y: o.y / DESIGN_H * h,
      mx: o.x * M_PER_PX,          // 东向偏移 m（自场景原点）
      my: o.y * M_PER_PX,          // 南向偏移 m
    }));
  }

  const PATH = [];          // 巡检路径（ Snake 扫描）
  function buildPath(w, h) {
    PATH.length = 0;
    for (let i = 0; i < 4; i++) {
      const y = 70 + i * ((h - 140) / 3);
      if (i % 2 === 0) { PATH.push([36, y]); PATH.push([w - 36, y]); }
      else { PATH.push([w - 36, y]); PATH.push([36, y]); }
    }
    return PATH;
  }

  function lerpPath(t) {
    const seg = t * (PATH.length - 1);
    const i = Math.min(PATH.length - 2, Math.floor(seg));
    const f = seg - i;
    return [PATH[i][0] + (PATH[i + 1][0] - PATH[i][0]) * f, PATH[i][1] + (PATH[i + 1][1] - PATH[i][1]) * f];
  }

  let simState = null;

  function startInspection(cv, onEvent, onDone, phase = 1) {
    const { w, h } = prep(cv);
    buildPath(w, h);
    const sc = genScene(7, phase);
    simState = { cv, w, h, t: 0, phase,
      blocks: mapScene(sc.blocks, w, h),
      targets: mapScene(sc.targets, w, h),
      found: [], onEvent, onDone, raf: null, last: performance.now() };
    const step = (now) => {
      if (!simState) return;
      const dt = Math.min(50, now - simState.last) / 1000;
      simState.last = now;
      simState.t += dt * 0.055;                       // 全程约 18 s
      renderInspection();
      if (simState.t >= 1) { const d = simState.onDone, f = simState.found.slice(); stopInspection(); d && d(f); return; }
      simState.raf = requestAnimationFrame(step);
    };
    simState.raf = requestAnimationFrame(step);
    return simState;
  }

  function stopInspection() {
    if (simState && simState.raf) cancelAnimationFrame(simState.raf);
    simState = null;
  }

  function renderInspection() {
    const st = simState; if (!st) return;
    const { g, w, h } = prep(st.cv);
    g.fillStyle = "rgba(248,249,251,.92)"; g.fillRect(0, 0, w, h);
    // 城市街块
    st.blocks.forEach(b => {
      g.fillStyle = "rgba(33,34,38,.06)";
      g.beginPath(); g.roundRect(b.x, b.y, b.w * st.w / 720, b.h * st.h / 380, 6); g.fill();
      g.strokeStyle = "rgba(33,34,38,.12)"; g.lineWidth = 1; g.stroke();
    });
    // 河道
    g.strokeStyle = "rgba(47,111,143,.30)"; g.lineWidth = 10; g.lineCap = "round";
    g.beginPath(); g.moveTo(0, h * .62);
    g.bezierCurveTo(w * .3, h * .5, w * .55, h * .8, w, h * .58); g.stroke(); g.lineCap = "butt";
    g.fillStyle = "rgba(47,111,143,.55)"; g.font = MONO; g.textAlign = "left";
    g.fillText("河段 K3+200 ~ K3+800", 20, h * .62 - 16);
    // 巡检路径
    g.strokeStyle = "rgba(155,114,203,.35)"; g.lineWidth = 1.4; g.setLineDash([6, 5]);
    g.beginPath(); PATH.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
    g.setLineDash([]);
    // 无人机当前位置与视场
    const [px, py] = lerpPath(Math.min(1, st.t));
    const R = 74;
    const grad = g.createRadialGradient(px, py, 6, px, py, R);
    grad.addColorStop(0, "rgba(66,133,244,.16)"); grad.addColorStop(1, "rgba(66,133,244,0)");
    g.fillStyle = grad; g.beginPath(); g.arc(px, py, R, 0, 7); g.fill();
    g.strokeStyle = "rgba(66,133,244,.5)"; g.setLineDash([4, 4]); g.lineWidth = 1.2;
    g.beginPath(); g.arc(px, py, R, 0, 7); g.stroke(); g.setLineDash([]);
    // 目标：进入过视场即识别，识别后框与标注持续保留（已识别留证）
    st.targets.forEach(t => {
      const d = Math.hypot(t.x - px, t.y - py);
      const seen = d < R;
      if (seen && !st.found.includes(t)) {
        st.found.push(t);
        st.onEvent && st.onEvent(t, st.t);
      }
      const ided = st.found.includes(t);
      if (ided) {
        g.fillStyle = t.color;
        g.strokeStyle = t.color; g.lineWidth = t.isNew ? 2.4 : 1.6;
        g.strokeRect(t.x - 13, t.y - 13, 26, 26);
        [[-13, -13], [13, -13], [-13, 13], [13, 13]].forEach(c => { g.beginPath(); g.moveTo(t.x + c[0], t.y + c[1] * 0.4); g.lineTo(t.x + c[0], t.y + c[1]); g.lineTo(t.x + c[0] * 0.4, t.y + c[1]); g.stroke(); });
        g.font = MONO; g.textAlign = "left"; g.textBaseline = "bottom";
        g.fillText((t.isNew ? "【新增】" : "") + t.kind.name + " " + (t.conf * 100).toFixed(1) + "%", t.x + 16, t.y - 10);
      } else if (seen) {
        // 视场内尚未确认的目标：虚线提示
        g.strokeStyle = "rgba(33,34,38,.35)"; g.setLineDash([3, 3]); g.lineWidth = 1;
        g.strokeRect(t.x - 11, t.y - 11, 22, 22); g.setLineDash([]);
      }
      g.fillStyle = ided ? t.color : "rgba(33,34,38,.45)";
      g.beginPath(); g.arc(t.x, t.y, 3.4, 0, 7); g.fill();
    });
    // 无人机图标
    g.strokeStyle = COL.ink; g.lineWidth = 2;
    [[-10, -8], [10, -8], [-10, 8], [10, 8]].forEach(a => {
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + a[0], py + a[1]); g.stroke();
      g.beginPath(); g.arc(px + a[0], py + a[1], 3.4, 0, 7); g.stroke();
    });
    g.beginPath(); g.roundRect(px - 6, py - 5, 12, 10, 3); g.fillStyle = COL.ink; g.fill();
    // 进度
    g.fillStyle = COL.ink2; g.font = MONO; g.textAlign = "left"; g.textBaseline = "top";
    g.fillText("巡检进度 " + Math.min(100, st.t * 100).toFixed(0) + "%   ·   已识别 " + st.found.length + " 处", 14, 12);
  }

  /* ============================================================
   * C. 双机对飞协同仿真（线性目标单程巡检）
   * ============================================================ */
  let relayState = null;

  function startRelay(cv, cfg, L_km, wAlong, onDone) {
    const { g, w, h } = prep(cv);
    const sim = ENG.relaySim(cfg, ENG.mass(cfg).mtow, L_km, wAlong);
    relayState = { cv, w, h, t: 0, sim, raf: null, last: performance.now(), onDone };
    const durS = Math.max(2, sim.dual.tMin) * 0.35;   // 动画时长（压缩）
    const stepFn = (now) => {
      if (!relayState) return;
      const dt = Math.min(50, now - relayState.last) / 1000;
      relayState.last = now;
      relayState.t += dt / durS;
      renderRelay();
      if (relayState.t >= 1) { const d = relayState.onDone, st = relayState.sim; stopRelay(); d && d(st); return; }
      relayState.raf = requestAnimationFrame(stepFn);
    };
    relayState.raf = requestAnimationFrame(stepFn);
  }

  function stopRelay() {
    if (relayState && relayState.raf) cancelAnimationFrame(relayState.raf);
    relayState = null;
  }

  function renderRelay() {
    const st = relayState; if (!st) return;
    const { g, w, h } = prep(st.cv);
    g.fillStyle = "rgba(248,249,251,.92)"; g.fillRect(0, 0, w, h);
    grid(g, w, h);
    const sim = st.sim;
    const m = 70, y = h * 0.42, span = w - 2 * m;
    const pxPerKm = span / sim.L_km;
    const xMeet = m + sim.dual.xKm * pxPerKm;
    // 河道
    g.strokeStyle = "rgba(47,111,143,.5)"; g.lineWidth = 14; g.lineCap = "round";
    g.beginPath(); g.moveTo(m, y); g.lineTo(w - m, y); g.stroke(); g.lineCap = "butt";
    g.fillStyle = "rgba(47,111,143,.6)"; g.font = MONO; g.textAlign = "center";
    g.fillText("河道 " + sim.L_km.toFixed(1) + " km（线性巡检目标）", w / 2, y + 30);
    // 相遇点旗标
    g.strokeStyle = COL.violet; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(xMeet, y - 46); g.lineTo(xMeet, y + 22); g.stroke();
    g.fillStyle = COL.violet;
    g.beginPath(); g.moveTo(xMeet, y - 46); g.lineTo(xMeet + 26, y - 40); g.lineTo(xMeet, y - 34); g.fill();
    g.fillText("相遇点 " + sim.dual.xKm.toFixed(2) + " km", xMeet, y - 54);
    // 起降点
    g.fillStyle = COL.ink; g.textAlign = "left";
    g.fillText("HOME_A（车载投放）", m - 40, y + 48);
    g.textAlign = "right";
    g.fillText("HOME_B（车载投放）", w - m + 40, y + 48);
    // 双机位置（同时完工：t 归一化墙钟）
    const t = Math.min(1, st.t);
    const ax = m + t * (xMeet - m);
    const bx = (w - m) - t * (w - m - xMeet);
    [[ax, COL.blue, "A"], [bx, COL.pink, "B"]].forEach(([px, c, tag]) => {
      g.strokeStyle = c; g.lineWidth = 2;
      [[-9, -7], [9, -7], [-9, 7], [9, 7]].forEach(a => {
        g.beginPath(); g.moveTo(px, y - 12); g.lineTo(px + a[0], y - 12 + a[1]); g.stroke();
        g.beginPath(); g.arc(px + a[0], y - 12 + a[1], 3, 0, 7); g.stroke();
      });
      g.beginPath(); g.roundRect(px - 5, y - 16, 10, 9, 3); g.fillStyle = c; g.fill();
      g.fillStyle = c; g.font = MONO; g.textAlign = "center";
      g.fillText("LY-100-" + tag, px, y - 34);
    });
    // 已覆盖航段
    g.lineWidth = 5;
    g.strokeStyle = "rgba(66,133,244,.85)";
    g.beginPath(); g.moveTo(m, y); g.lineTo(ax, y); g.stroke();
    g.strokeStyle = "rgba(217,101,112,.85)";
    g.beginPath(); g.moveTo(w - m, y); g.lineTo(bx, y); g.stroke();
    g.lineWidth = 1;
    // 进度
    g.fillStyle = COL.ink2; g.font = MONO; g.textAlign = "left"; g.textBaseline = "top";
    g.fillText("协同巡检进度 " + (t * 100).toFixed(0) + "%   ·   风场感知相遇点调度", 14, 12);
  }

  /* 生成标准化巡检报告文本（模拟机载数据 → 地面站大模型成报）。
   * 坐标换算：目标携带米制偏移 mx/my（设计稿 2 m/px，与窗口宽度无关），
   * 纬度 1° ≈ 111 320 m，经度 1° ≈ 111 320 × cos(纬度) m。 */
  function report(found, meta) {
    const cnt = { pollution: 0, illegal: 0, debris: 0 };
    found.forEach(t => cnt[t.kind.key]++);
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    const ts = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
    const lon0 = 121.5037, lat0 = 31.2829; // 示例作业区（示意坐标）
    const M_PER_DEG_LAT = 111320;
    const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180); // ≈ 95 136 m @ 31.28°N
    const lines = [];
    lines.push("低空巡检标准化工作报告");
    lines.push("任务编号：LY100-PATROL-" + ts.replace(/[-: ]/g, "").slice(0, 12));
    lines.push("巡检时间：" + ts + "   机型：翎雁 LY-100（小型）   航高：" + meta.altM + " m（真高）");
    lines.push("作业空域：适飞空域·已开电子围栏   飞手：持证（CAAC）   风速：" + meta.wind + " m/s");
    lines.push("──────────────────────────────");
    lines.push("一、任务概况");
    lines.push("本次任务对 " + meta.area + " 开展低空例行巡检，巡航地速 " + meta.v + " m/s，");
    lines.push("机载边缘 AI 全程实时识别，共采集影像 " + meta.photos + " 张，识别疑似目标 " + found.length + " 处。");
    lines.push("二、问题清单");
    const idx = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];
    found.forEach((t, i) => {
      const lon = (lon0 + t.mx / M_PER_DEG_LON).toFixed(6), lat = (lat0 + t.my / M_PER_DEG_LAT).toFixed(6);
      lines.push(idx[i] + " " + (t.isNew ? "【新增】" : "") + t.kind.name + "（置信度 " + (t.conf * 100).toFixed(1) + "%）· WGS84 " + lon + "E " + lat + "N · 已留证（可见光+位置包）");
    });
    if (!found.length) lines.push("（无）");
    lines.push("三、统计：疑似污染源 " + cnt.pollution + " 处；疑似违法建筑 " + cnt.illegal + " 处；建筑垃圾堆积 " + cnt.debris + " 处。");
    if (meta.phase === 2) {
      const nNew = found.filter(t => t.isNew).length;
      const nKeep = found.length - nNew;
      lines.push("三′、两期对比（本期为第 2 期）：上期识别 8 处；已整改销号 " + (8 - nKeep) + " 处；逾期未改 " + nKeep + " 处；");
      lines.push("本期通过两期事件对比自动发现新增疑似违法建筑 " + nNew + " 处（问题清单红标项），已推送属地网格。");
      lines.push("四、处置建议：新增目标按\"即查即拆\"流程 48 小时内现场核定；逾期未改目标启动执法程序并同步街镇。");
    } else {
      lines.push("四、处置建议：请按网格化属地管理流程派单核查，48 小时内复核销号；复核影像可调用本任务原始数据包。");
    }
    lines.push("五、数据说明：识别结果为 AI 辅助初筛，须经人工复核后方可作为执法依据（人机协同审核制度）。");
    return lines.join("\n");
  }

  return { drawSurvey, startInspection, stopInspection, report, KINDS, startRelay, stopRelay };
})();
