/* ============================================================
 * 翎雁 LY-100 · 平台交互层
 * ============================================================ */
"use strict";

(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const fmt = (v, d = 1) => Number(v).toFixed(d);

  /* ============ Hero 任务控制台遥测 ============ */
  function telemetry() {
    const cv = $("#telemetry");
    if (!cv) return;
    let t = 0, hist = [];
    const DPR = window.devicePixelRatio || 1;
    function loop() {
      if (!cv.isConnected) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * DPR) { cv.width = w * DPR; cv.height = h * DPR; }
      const g = cv.getContext("2d");
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, w, h);
      t += 0.008;
      // 状态行
      const alt = 120, spd = 19 + Math.sin(t * 1.7) * 0.8, bat = Math.max(22, 100 - (t * 4) % 78);
      g.font = '11px "JetBrains Mono", monospace';
      g.fillStyle = "#8b91a5";
      g.fillText("MODE  CRUISE   WP 07/22   LINK  -62 dBm   GPS  18", 16, 22);
      g.fillText("ALT " + alt.toFixed(1) + " m", 16, 42);
      g.fillText("GS  " + spd.toFixed(1) + " m/s", 130, 42);
      g.fillText("BAT " + bat.toFixed(0) + " %", 240, 42);
      // 滚动曲线
      hist.push([alt / 2 + Math.sin(t * 2.2) * 6 + (Math.sin(t * .9) + 1) * 5, spd * 3 + Math.sin(t * 3.1) * 4, bat]);
      if (hist.length > 90) hist.shift();
      const cols = ["#4285f4", "#9b72cb", "#d96570"];
      const names = ["ALT/2", "GS×3", "BAT"];
      // 三条曲线（ALT、GS）
      for (let c = 0; c < 2; c++) {
        g.beginPath();
        hist.forEach((row, i) => {
          const x = 16 + (w - 32) * i / 89;
          const y = h - 24 - (row[c] / 100) * (h - 70);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.strokeStyle = cols[c]; g.lineWidth = 1.6; g.stroke();
      }
      // 电量条
      const bw = (w - 32) * bat / 100;
      g.fillStyle = "rgba(232,235,244,.10)";
      g.fillRect(16, h - 16, w - 32, 6);
      const bg = g.createLinearGradient(16, 0, 16 + bw, 0);
      bg.addColorStop(0, "#4285f4"); bg.addColorStop(1, "#d96570");
      g.fillStyle = bg; g.fillRect(16, h - 16, bw, 6);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  /* ============ 滚动显现 + 数字计数 ============ */
  function reveal() {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.18 });
    $$(".rv").forEach(el => io.observe(el));
    const io2 = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      io2.unobserve(e.target);
      const el = e.target, target = parseFloat(el.dataset.count), dec = +(el.dataset.dec || 0);
      const t0 = performance.now();
      (function tick(now) {
        const p = Math.min(1, (now - t0) / 1200), ease = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * ease).toFixed(dec);
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }), { threshold: 0.5 });
    $$(".num").forEach(el => io2.observe(el));
  }

  /* ============ 设计舱 ============ */
  let CFG = JSON.parse(JSON.stringify(ENG.DEFAULT));

  function renderDesign() {
    const m = ENG.mass(CFG);
    const cv = $("#massBar");
    CHART.stackBar(cv, m.items.map(i => [i[0], i[1]]));
    // 关键读数
    const vt = ENG.vtol(CFG, m.mtow);
    const en = ENG.endurance(CFG, m.mtow);
    const st = ENG.stall(CFG, m.mtow);
    $("#dMtow").textContent = fmt(m.mtow, 2);
    $("#dEnd").textContent = fmt(en.enduranceH * 60, 0);
    $("#dRange").textContent = fmt(en.rangeKm, 0);
    $("#dStall").textContent = fmt(st.v, 1);
    $("#dHover").textContent = fmt(vt.pHover, 0);
    $("#dDisc").textContent = fmt(vt.discLoad, 0);
    // 合规卡
    const cp = ENG.compliance(CFG, m.mtow);
    $("#dCat").textContent = cp.category + "无人机";
    const ok = $("#dCompOk");
    ok.classList.toggle("warn", !cp.light);
    ok.textContent = cp.light ? "✓ 满足轻型类别（MTOW < 7 kg）" : "✗ 超出轻型上限 7 kg，进入小型类别，适航要求显著提高";
    // 载荷清单
    const ul = $("#loadList");
    ul.innerHTML = "";
    Object.entries(CFG.loads).forEach(([k, l]) => {
      const li = document.createElement("li");
      li.innerHTML = `<label class="chk"><input type="checkbox" data-load="${k}" ${l.on ? "checked" : ""}><span>${l.name}</span><b>${(l.m * 1000).toFixed(0)} g</b></label>`;
      ul.appendChild(li);
    });
    $$("#loadList input").forEach(cb => cb.addEventListener("change", () => {
      CFG.loads[cb.dataset.load].on = cb.checked;
      renderDesign(); renderPerf(); renderSurvey();
    }));
    // 电池滑块读数
    $("#battCapV").textContent = fmt(CFG.batt.capAh, 1) + " Ah（双包 6S2P · " + fmt(CFG.batt.cells * 3.7 * CFG.batt.capAh, 0) + " Wh）";
  }

  function bindDesign() {
    const sl = $("#battCap");
    sl.addEventListener("input", () => { CFG.batt.capAh = +sl.value; renderDesign(); renderPerf(); renderSurvey(); });
  }

  /* ============ 性能舱 ============ */
  let wind = 0;

  function renderPerf() {
    const m = ENG.mass(CFG);
    const pts = ENG.polar(CFG, m.mtow);
    // 最小功率点
    let best = pts[0];
    pts.forEach(p => { if (p[1] < best[1]) best = p; });
    const cvA = $("#perfPolar");
    CHART.line(cvA, pts, {
      xLab: "真空速 (m/s)", yLab: "需用电功率 (W)", fill: true,
      marks: [
        { x: best[0], y: best[1], label: "最小功率 " + fmt(best[1], 0) + " W @ " + fmt(best[0], 1) + " m/s" },
        { x: CFG.vCruise, y: ENG.cruise(CFG, m.mtow, CFG.vCruise).Pelec, label: "巡航 " + fmt(CFG.vCruise, 0) + " m/s" },
      ],
      xFmt: v => fmt(v, 0), yFmt: v => fmt(v, 0),
    });
    // 航时-载荷（载荷从 0.4~1.6 kg 变化 → 调整固定项）
    const loadPts = [];
    for (let L = 0.4; L <= 1.61; L += 0.06) {
      const c2 = JSON.parse(JSON.stringify(CFG));
      const delta = L - ENG.mass(c2).loadsKg;
      c2.fixed.structure += delta;  // 近似：载荷变化等价为总重变化
      loadPts.push([L, ENG.endurance(c2, ENG.mass(c2).mtow).enduranceH * 60]);
    }
    const cur = ENG.mass(CFG).loadsKg;
    const curE = ENG.endurance(CFG, m.mtow).enduranceH * 60;
    CHART.line($("#perfLoad"), loadPts, {
      xLab: "任务载荷质量 (kg)", yLab: "理论航时 (min)", fill: true,
      marks: [{ x: cur, y: curE, label: "当前构型 " + fmt(curE, 0) + " min" }],
      xFmt: v => fmt(v, 1), yFmt: v => fmt(v, 0),
    });
    // 能量瀑布
    const en = ENG.endurance(CFG, m.mtow, wind);
    const eCruiseTotal = en.enduranceH * en.pCruise;
    CHART.waterfall($("#perfWater"), [
      ["垂起爬升", en.vtol.eClimb],
      ["倾转过渡", en.vtol.eTrans],
      ["巡航消耗", eCruiseTotal],
    ], en.vtol.eTotal + eCruiseTotal, en.avail);
    // 风场敏感性读数
    $("#windV").textContent = wind.toFixed(0) + " m/s 顶风";
    $("#pEnd").textContent = fmt(en.enduranceH * 60, 0);
    $("#pRange").textContent = fmt(en.rangeKm, 0);
    $("#pGround").textContent = fmt(CFG.vCruise - wind, 1);
  }

  function bindPerf() {
    const sl = $("#wind");
    sl.addEventListener("input", () => { wind = +sl.value; renderPerf(); });
    window.addEventListener("resize", () => { renderPerf(); });
  }

  /* ============ 任务舱 A：航测 ============ */
  const SP = { lenKm: 2.0, widKm: 0.5, altM: 120, sideOv: 65, fwdOv: 70, vGnd: 19 };

  function renderSurvey() {
    const m = ENG.mass(CFG);
    const r = ENG.survey(CFG, m.mtow, SP);
    MISSION.drawSurvey($("#surveyCv"), SP, r);
    $("#sGsd").textContent = fmt(r.gsd, 1);
    $("#sGsdNote").textContent = r.gsd <= 5 ? "满足 1:500 航测要求（≤5 cm）" : "低于精细测绘要求，建议降低航高";
    $("#sLines").textContent = r.nLines;
    $("#sPhotos").textContent = r.photos;
    $("#sPath").textContent = fmt(r.pathKm, 1);
    $("#sTime").textContent = fmt(r.tTot, 0);
    $("#sSortie").textContent = r.sorties === 1 ? "单架次可完成 ✓" : "建议拆分 " + r.sorties + " 架次";
    $("#sSortie").classList.toggle("warn", r.sorties > 1);
    $("#sSwath").textContent = fmt(r.swathW, 1) + " m";
    $("#sGap").textContent = fmt(r.lineGap, 1) + " m";
  }

  function bindSurvey() {
    // 初始以滑块显示值为准，保证读数与画面一致
    SP.altM = +$("#sAlt").value; $("#sAltV").textContent = SP.altM + " m";
    SP.sideOv = +$("#sSide").value; $("#sSideV").textContent = SP.sideOv + " %";
    SP.fwdOv = +$("#sFwd").value; $("#sFwdV").textContent = SP.fwdOv + " %";
    SP.lenKm = +$("#sLen").value; $("#sLenV").textContent = SP.lenKm.toFixed(1) + " km";
    SP.widKm = +$("#sWid").value; $("#sWidV").textContent = SP.widKm.toFixed(1) + " km";
    const map = {
      sAlt: ["altM", v => { SP.altM = v; $("#sAltV").textContent = v + " m"; }],
      sSide: ["sideOv", v => { SP.sideOv = v; $("#sSideV").textContent = v + " %"; }],
      sFwd: ["fwdOv", v => { SP.fwdOv = v; $("#sFwdV").textContent = v + " %"; }],
      sLen: ["lenKm", v => { SP.lenKm = v; $("#sLenV").textContent = v.toFixed(1) + " km"; }],
      sWid: ["widKm", v => { SP.widKm = v; $("#sWidV").textContent = v.toFixed(1) + " km"; }],
    };
    Object.entries(map).forEach(([id, [key, setV]]) => {
      const el = $("#" + id);
      el.addEventListener("input", () => { setV(+el.value); renderSurvey(); });
    });
    // 预设测区
    $$(".preset").forEach(b => b.addEventListener("click", () => {
      $$(".preset").forEach(x => x.classList.remove("on")); b.classList.add("on");
      const p = b.dataset.p;
      const set = (id, v) => { const el = $("#" + id); el.value = v; el.dispatchEvent(new Event("input")); };
      if (p === "town") { set("sLen", 2.0); set("sWid", 0.5); }        // 河道带状
      else if (p === "square") { set("sLen", 1.0); set("sWid", 1.0); } // 1 km² 标准
      else { set("sLen", 0.6); set("sWid", 0.6); }                     // 校园小测区
    }));
    renderSurvey();
  }

  /* ============ 任务舱 B：AI 巡检 ============ */
  let reportTimer = null;

  function bindPatrol() {
    const btn = $("#patrolBtn");
    const feed = $("#eventFeed");
    const rep = $("#reportBox");
    btn.addEventListener("click", () => {
      if (btn.dataset.run === "1") { MISSION.stopInspection(); resetPatrol(); return; }
      btn.dataset.run = "1";
      btn.textContent = "■ 停止任务";
      feed.innerHTML = ""; rep.textContent = "";
      MISSION.startInspection($("#patrolCv"),
        (t, progress) => {
          const li = document.createElement("li");
          const lon = (121.5037 + t.x / 111000).toFixed(6);
          const lat = (31.2829 + t.y / 111000).toFixed(6);
          li.innerHTML = `<span class="dot" style="background:${t.kind.color}"></span><div><b>${t.kind.name}</b> 置信度 ${(t.conf * 100).toFixed(1)}%<small>WGS84 ${lon}E, ${lat}N · 已留证</small></div>`;
          feed.prepend(li);
        },
        (found) => {
          btn.dataset.run = "0"; btn.textContent = "▶ 重新执行巡检";
          const meta = { altM: SP.altM, v: SP.vGnd, wind: 3.2, photos: 412, area: "某河段沿线 2.0 km² 示范区（演示数据）" };
          const txt = MISSION.report(found, meta);
          let i = 0;
          clearInterval(reportTimer);
          reportTimer = setInterval(() => {
            rep.textContent = txt.slice(0, i += 3);
            if (i >= txt.length) clearInterval(reportTimer);
          }, 12);
        });
    });
  }

  function resetPatrol() {
    const btn = $("#patrolBtn");
    btn.dataset.run = "0"; btn.textContent = "▶ 执行 AI 巡检任务";
    clearInterval(reportTimer);
  }

  /* ============ 安全舱 ============ */
  function bindSafety() {
    $("#safeBtn").addEventListener("click", () => {
      const m = ENG.mass(CFG);
      const cp = ENG.compliance(CFG, m.mtow);
      const alt = +$("#safeAlt").value;
      const zone = $("#safeZone").value;
      const list = cp.items.slice();
      if (alt > 120) list.unshift({ t: "作业真高 " + alt + " m > 120 m：超出微型/轻型适飞上限，须提前申请空域并获批后方可实施", ok: false });
      if (zone === "airport") list.unshift({ t: "作业区位于机场净空保护区附近：须向民航及属地公安报批，纳入管制空域计划", ok: false });
      if (zone === "urban") list.push({ t: "人口密集区上空：建议投保第三者责任险并设立应急降落区", ok: true });
      const ul = $("#safeList");
      ul.innerHTML = "";
      list.forEach(it => {
        const li = document.createElement("li");
        li.className = it.ok ? "ok" : "bad";
        li.innerHTML = `<span class="sym">${it.ok ? "check_circle" : "bolt"}</span>${it.t}`;
        ul.appendChild(li);
      });
      $("#safeOut").classList.add("show");
    });
  }

  /* ============ 导航 ============ */
  function bindNav() {
    const nav = $(".site-nav");
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    const btn = $("#navToggle");
    if (btn) btn.addEventListener("click", () => $("#navLinks").classList.toggle("open"));
  }

  document.addEventListener("DOMContentLoaded", () => {
    telemetry(); reveal();
    renderDesign(); bindDesign();
    renderPerf(); bindPerf();
    bindSurvey();
    bindPatrol();
    bindSafety();
    bindNav();
    // 重算触发：面板进入视口时再画一次，防止初始化时画布宽度为 0
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) {
        if (e.target.id === "secPerf") renderPerf();
        if (e.target.id === "secDesign") renderDesign();
        if (e.target.id === "secMission") renderSurvey();
        io.unobserve(e.target);
      }
    }), { threshold: 0.1 });
    ["secDesign", "secPerf", "secMission"].forEach(id => { const el = $("#" + id); el && io.observe(el); });
  });
})();
