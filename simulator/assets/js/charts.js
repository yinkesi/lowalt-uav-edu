/* ============================================================
 * 翎雁 LY-100 · Canvas 图表引擎（零依赖）
 * 折线图 / 重量堆叠条 / 能量瀑布 / 航线图共用绘图工具。
 * ============================================================ */
"use strict";

const CHART = (() => {
  const CSS = getComputedStyle(document.documentElement);
  const C = {
    blue: CSS.getPropertyValue("--blue").trim() || "#4285f4",
    violet: CSS.getPropertyValue("--violet").trim() || "#9b72cb",
    pink: CSS.getPropertyValue("--pink").trim() || "#d96570",
    ink: CSS.getPropertyValue("--ink").trim() || "#212226",
    ink2: CSS.getPropertyValue("--ink-2").trim() || "#5d6270",
    ink3: CSS.getPropertyValue("--ink-3").trim() || "#8f95a3",
    line: "rgba(33,34,38,.10)",
  };
  const FONT = '12px "JetBrains Mono", Consolas, monospace';

  function prep(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = FONT;
    return { g, w, h };
  }

  function axes(g, box, xMin, xMax, yMin, yMax, xLab, yLab, xFmt = v => v, yFmt = v => v, yTicks = 5) {
    const { x0, y0, x1, y1 } = box;
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.fillStyle = C.ink3;
    for (let i = 0; i <= yTicks; i++) {
      const y = y1 + (y0 - y1) * i / yTicks;
      const val = yMax - (yMax - yMin) * i / yTicks;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(yFmt(val), x0 - 8, y);
    }
    const xTicks = 6;
    g.textAlign = "center"; g.textBaseline = "top";
    for (let i = 0; i <= xTicks; i++) {
      const x = x0 + (x1 - x0) * i / xTicks;
      g.fillText(xFmt(xMin + (xMax - xMin) * i / xTicks), x, y0 + 8);
    }
    g.strokeStyle = C.ink2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.stroke();
    if (yLab) { g.save(); g.translate(12, (y0 + y1) / 2); g.rotate(-Math.PI / 2); g.textAlign = "center"; g.fillStyle = C.ink2; g.fillText(yLab, 0, 0); g.restore(); }
    if (xLab) { g.textAlign = "right"; g.fillStyle = C.ink2; g.fillText(xLab, x1, y0 + 24); }
  }

  /* 折线图：pts = [[x,y],...]，marks = [{x,y,label}] */
  function line(cv, pts, opt = {}) {
    const { g, w, h } = prep(cv);
    const pad = { l: 52, r: 16, t: 18, b: 34 };
    const box = { x0: pad.l, y0: h - pad.b, x1: w - pad.r, y1: pad.t };
    let xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let xMin = opt.xMin ?? Math.min(...xs), xMax = opt.xMax ?? Math.max(...xs);
    let yMin = opt.yMin ?? 0, yMax = opt.yMax ?? Math.max(...ys) * 1.08;
    axes(g, box, xMin, xMax, yMin, yMax, opt.xLab || "", opt.yLab || "", opt.xFmt || (v => v), opt.yFmt || (v => v));
    const X = v => box.x0 + (box.x1 - box.x0) * (v - xMin) / (xMax - xMin || 1);
    const Y = v => box.y0 - (box.y0 - box.y1) * (v - yMin) / (yMax - yMin || 1);
    // 渐变描边
    const grad = g.createLinearGradient(box.x0, 0, box.x1, 0);
    grad.addColorStop(0, C.blue); grad.addColorStop(.52, C.violet); grad.addColorStop(1, C.pink);
    g.beginPath();
    pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])));
    g.strokeStyle = grad; g.lineWidth = 2.4; g.lineJoin = "round"; g.stroke();
    if (opt.fill) {
      g.lineTo(X(pts[pts.length - 1][0]), box.y0); g.lineTo(X(pts[0][0]), box.y0); g.closePath();
      const fg = g.createLinearGradient(0, box.y1, 0, box.y0);
      fg.addColorStop(0, "rgba(66,133,244,.14)"); fg.addColorStop(1, "rgba(217,101,112,.02)");
      g.fillStyle = fg; g.fill();
    }
    (opt.marks || []).forEach(mk => {
      // 标注点：位置钳制在绘图区内，避免文字出界
      const mx = Math.max(box.x0 + 70, Math.min(box.x1 - 40, X(mk.x)));
      const x = X(mk.x), y = Y(mk.y);
      g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fillStyle = C.ink; g.fill();
      g.beginPath(); g.arc(x, y, 2, 0, 7); g.fillStyle = "#fff"; g.fill();
      g.fillStyle = C.ink; g.textAlign = "center"; g.textBaseline = "bottom";
      g.fillText(mk.label || "", mx, Math.max(12, y - 10));
    });
  }

  /* 水平堆叠条（重量堆叠）：items = [label, kg]，布局 [条 | 数值 | 标签] */
  function stackBar(cv, items, totalLabel) {
    const { g, w, h } = prep(cv);
    const colors = [C.blue, C.violet, C.pink, "#3aa475", "#e2a33c", "#7d8ce0", "#c77f57"];
    const x0 = 12, x1 = w - 158, rowH = Math.min(30, (h - 44) / items.length);
    const total = items.reduce((s, it) => s + it[1], 0);
    g.font = '11px "JetBrains Mono", monospace';
    items.forEach((it, i) => {
      const y = 22 + i * rowH, bh = Math.min(rowH - 9, 20);
      const bw = Math.max((x1 - x0) * it[1] / total, 2.5);
      g.fillStyle = colors[i % colors.length];
      g.beginPath(); g.roundRect(x0, y, bw, bh, 4); g.fill();
      // 数值列（固定位置，右对齐）+ 标签列
      g.fillStyle = C.ink; g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(it[1].toFixed(2), w - 146, y + bh / 2);
      g.fillStyle = C.ink2; g.textAlign = "left";
      g.fillText(it[0], w - 138, y + bh / 2, 136);
      // 空心描边表示占比满格参考线
      g.strokeStyle = "rgba(33,34,38,.08)";
      g.strokeRect(x0, y, x1 - x0, bh);
    });
    g.fillStyle = C.ink; g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.font = '12px "JetBrains Mono", monospace';
    g.fillText(totalLabel || ("MTOW = " + total.toFixed(2) + " kg"), x0, 12);
  }

  /* 瀑布图：stages = [label, Wh]，最后自动追加剩余量柱 */
  function waterfall(cv, stages, usedWh, availWh) {
    const { g, w, h } = prep(cv);
    const pad = { l: 52, r: 14, t: 20, b: 40 };
    const box = { x0: pad.l, y0: h - pad.b, x1: w - pad.r, y1: pad.t };
    const max = availWh;
    const n = stages.length + 1;                 // +1 给剩余量
    const gap = (box.x1 - box.x0) / n;
    const colW = gap * 0.62;
    const Y = v => box.y0 - (box.y0 - box.y1) * v / max;
    let acc = 0;
    stages.forEach((s, i) => {
      const x = box.x0 + gap * i + (gap - colW) / 2;
      const y0 = Y(acc), y1 = Y(acc + s[1]);
      if (!isFinite(y0) || !isFinite(y1)) return;
      const grad = g.createLinearGradient(0, y1, 0, y0);
      grad.addColorStop(0, C.blue); grad.addColorStop(1, C.violet);
      g.fillStyle = grad;
      g.beginPath(); g.roundRect(x, y0, colW, Math.max(y0 - y1, 2), 4); g.fill();
      g.fillStyle = C.ink2; g.textAlign = "center"; g.textBaseline = "bottom";
      g.fillText("-" + s[1].toFixed(0) + " Wh", x + colW / 2, y0 - 4);
      g.textBaseline = "top"; g.fillStyle = C.ink3;
      g.font = '10px "JetBrains Mono", monospace';
      g.fillText(s[0], x + colW / 2, box.y0 + 8);
      g.font = FONT;
      acc += s[1];
    });
    // 剩余量柱
    const rem = Math.max(0, availWh - usedWh);
    const xr = box.x0 + gap * (n - 1) + (gap - colW) / 2;
    g.fillStyle = "rgba(58,164,117,.85)";
    g.beginPath(); g.roundRect(xr, Y(rem), colW, Math.max(Y(0) - Y(rem), 2), 4); g.fill();
    g.fillStyle = C.ink; g.textAlign = "center"; g.textBaseline = "bottom";
    g.fillText("余 " + rem.toFixed(0) + " Wh", xr + colW / 2, Math.max(12, Y(rem) - 4));
    g.font = '10px "JetBrains Mono", monospace'; g.fillStyle = C.ink3; g.textBaseline = "top";
    g.fillText("安全余量", xr + colW / 2, box.y0 + 8);
    // 可用总能量基线
    g.strokeStyle = C.pink; g.setLineDash([5, 4]); g.beginPath();
    g.moveTo(box.x0, Y(availWh)); g.lineTo(box.x1, Y(availWh)); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.pink; g.textAlign = "left"; g.textBaseline = "bottom";
    g.fillText("可用 " + availWh.toFixed(0) + " Wh", box.x0 + 4, Y(availWh) - 3);
  }

  return { line, stackBar, waterfall, C };
})();
