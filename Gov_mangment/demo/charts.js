// رسم الجرافات بالكود (SVG) من غير أي مكتبة. كل دالة بترجّع نص SVG جاهز يتحط في الصفحة.
// الألوان من style/main.css (الكلاسات .chart .bar وغيره)، فالجرافات بتاخد ألوانك.
window.Charts = (function () {
  "use strict";
  const E = window.Engine;
  const W = 560; // عرض الرسم الداخلي (بيتمدد ليملا الكارت)
  const PAD = { top: 28, bottom: 46, left: 12, right: 64 }; // اليمين لأرقام المحور (الصفحة RTL)

  const svg = (h, label, body) =>
    '<svg class="chart" viewBox="0 0 ' + W + " " + h + '" width="100%" role="img" aria-label="' + label + '">' + body + "</svg>";

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    return steps.find((s) => n <= s + 1e-9) * p;
  }
  const axisNum = (v) => (v >= 1000 ? E.fmtNum(v / 1000) + " ألف" : String(Math.round(v)));

  // خطوط الشبكة وأرقام المحور الرأسي (يمين)
  function yAxis(h, max, unitFmt) {
    const plotH = h - PAD.top - PAD.bottom;
    const x1 = PAD.left, x2 = W - PAD.right;
    let out = "";
    [0, 0.5, 1].forEach((f) => {
      const y = PAD.top + plotH * (1 - f);
      out += '<line class="' + (f === 0 ? "base" : "grid") + '" x1="' + x1 + '" x2="' + x2 + '" y1="' + y + '" y2="' + y + '"/>';
      out += '<text x="' + (x2 + 8) + '" y="' + (y + 4) + '">' + unitFmt(max * f) + "</text>";
    });
    return out;
  }

  // الأسبوع الأول على اليمين (اتجاه القراءة العربي)
  function weekly(weeks) {
    const H = 250;
    const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
    const max = niceMax(Math.max.apply(null, weeks.map((w) => w.done)));
    const n = weeks.length, slot = plotW / n, bw = Math.min(64, slot * 0.7);
    let out = yAxis(H, max, axisNum);
    const step = Math.max(1, Math.ceil(26 / slot));
    weeks.forEach((w, i) => {
      const cx = W - PAD.right - slot * (i + 0.5);
      const h = (w.done / max) * plotH;
      const y = PAD.top + plotH - h;
      out += '<rect class="bar" x="' + (cx - bw / 2) + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="3"/>';
      if (n <= 14) out += '<text class="val" x="' + cx + '" y="' + (y - 6) + '" text-anchor="middle">' + (slot >= 56 ? E.fmtNum(w.done) : axisNum(w.done)) + "</text>";
      if (i % step === 0) {
        out += '<text x="' + cx + '" y="' + (H - 26) + '" text-anchor="middle">' + (slot >= 60 ? "أسبوع " : "") + (i + 1) + "</text>";
        if (slot >= 80) out += '<text class="sub" x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle">' + E.fmtShort(w.firstDate) + "</text>";
      }
    });
    return svg(H, "المباني المنجزة في كل أسبوع", out);
  }

  // المباني المنجزة بالتراكم عبر أيام العمل
  function progress(days, total) {
    const H = 250;
    const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
    const n = days.length;
    const xAt = (i) => W - PAD.right - (i / n) * plotW; // i = 0 هو البداية (يمين)
    const yAt = (v) => PAD.top + plotH * (1 - v / total);
    const pts = [[xAt(0), yAt(0)]].concat(days.map((d, i) => [xAt(i + 1), yAt(d.cum)]));
    const line = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
    const area = line + " " + pts[pts.length - 1][0].toFixed(1) + "," + yAt(0) + " " + pts[0][0].toFixed(1) + "," + yAt(0);
    let out = yAxis(H, total, axisNum);
    out += '<polygon class="area" points="' + area + '"/><polyline class="line" points="' + line + '"/>';
    const last = pts[pts.length - 1];
    out += '<circle class="dot" cx="' + last[0] + '" cy="' + last[1] + '" r="4.5"/>';
    out += '<text x="' + xAt(0) + '" y="' + (H - 14) + '" text-anchor="middle">' + E.fmtShort(days[0].date) + "</text>";
    out += '<text x="' + Math.max(xAt(n), 34) + '" y="' + (H - 14) + '" text-anchor="middle">' + E.fmtShort(days[n - 1].date) + "</text>";
    return svg(H, "المباني المنجزة بالتراكم", out);
  }

  // مقارنة أيام العمل بين السيناريوهات
  function scenarios(rows) {
    const H = 250;
    const ok = rows.filter((r) => r.ok);
    if (!ok.length) return "";
    const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
    const max = niceMax(Math.max.apply(null, ok.map((r) => r.workDays)));
    const slot = plotW / rows.length, bw = Math.min(70, slot * 0.6);
    let out = yAxis(H, max, (v) => Math.round(v) + " يوم");
    rows.forEach((r, i) => {
      const cx = W - PAD.right - slot * (i + 0.5);
      if (r.ok) {
        const h = (r.workDays / max) * plotH, y = PAD.top + plotH - h;
        out += '<rect class="' + (r.key === "base" ? "bar" : "bar2") + '" x="' + (cx - bw / 2) + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="3"/>';
        out += '<text class="val" x="' + cx + '" y="' + (y - 6) + '" text-anchor="middle">' + r.workDays + " يوم</text>";
      }
      out += '<text x="' + cx + '" y="' + (H - 26) + '" text-anchor="middle">' + r.short + "</text>";
      out += '<text class="sub" x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle">' + r.people + " فرد</text>";
    });
    return svg(H, "أيام العمل في كل سيناريو", out);
  }

  return { weekly, progress, scenarios };
})();
