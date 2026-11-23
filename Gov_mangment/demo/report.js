// صفحة التقرير: بتقرا ملف المحافظة (من نفس مكان الحفظ) وبتبني تقرير للطباعة:
// خلاصة المحافظة (كام يوم)، المدخلات، النتائج، الجرافات، تقرير مستقل لكل تيم، والسيناريوهات.
(async function () {
  "use strict";
  const E = window.Engine, S = window.Store, C = window.Charts;
  const root = document.getElementById("report-body");
  const fmtNum = E.fmtNum, fmtLong = E.fmtLong, fmtShort = E.fmtShort;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  document.getElementById("print-btn").addEventListener("click", () => window.print());

  function fail(msg) {
    root.innerHTML = '<div class="r-empty"><h1>' + esc(msg) + '</h1><p><a href="index.html">رجوع لصفحة التخطيط</a></p></div>';
    document.getElementById("print-btn").disabled = true;
  }

  const gov = new URLSearchParams(location.search).get("gov");
  if (!gov) return fail("اختر محافظة من صفحة التخطيط الأول");
  await S.init();
  let p;
  try { p = await S.load(gov); } catch (e) { return fail("تعذر قراءة بيانات المحافظة"); }
  if (!p) return fail("مفيش بيانات محفوظة للمحافظة دي");
  p = Object.assign(E.newProject(p.govId, p.govName), p);

  const r = E.calculate(p);
  if (!r.ok) return fail(r.reason);
  const d = E.distribute(p, r);
  const weeks = E.weekly(r.days);
  const sc = E.scenarios(p);
  document.title = "تقرير محافظة " + p.govName;

  const wdNames = p.workDays.map((i) => E.DAY_NAMES[i]).join("، ");
  const kv = (rows) => '<table class="kv"><tbody>' + rows.map((x) => "<tr><th>" + x[0] + "</th><td>" + x[1] + "</td></tr>").join("") + "</tbody></table>";
  const teamName = (id) => { const t = p.teams.find((x) => x.id === id); return t ? esc(t.name) : "تيم محذوف"; };
  const range = (a) => (a.from === a.to ? fmtShort(a.from) : fmtShort(a.from) + " إلى " + fmtShort(a.to));

  /* ---------- أقسام التقرير ---------- */
  const head =
    '<header><div class="r-meta">تقرير تخطيط مشروع GIS · أُعد في ' + fmtLong(E.todayCairo()) + "</div>" +
    "<h1>المدة المتوقعة لإنجاز تحديث مباني محافظة " + esc(p.govName) + "</h1></header>";

  const summary =
    '<section class="r-summary"><div class="r-label">الخلاصة</div>' +
    '<p class="r-big">محافظة ' + esc(p.govName) + " هتاخد " + r.workDays + " يوم عمل (" + r.weeks + " أسبوع)، وتنتهي يوم " + fmtLong(r.endDate) + ".</p>" +
    "<p>بداية المشروع " + fmtLong(r.startDate) + " (" + r.calendarDays + " يوم من البداية للنهاية). الحساب على " + fmtNum(p.buildings) +
    " مبنى" + (p.grids ? " في " + fmtNum(p.grids) + " جريد" : "") + "، و" + p.teams.length + " تيمز عددها " + r.people + " فرد، بإنتاج " + fmtNum(p.ratePerPerson) + " مبنى لكل فرد في اليوم.</p></section>";

  const inputs = "<section><h2>المدخلات والافتراضات</h2>" + kv([
    ["المحافظة", esc(p.govName)],
    ["تاريخ البداية", fmtLong(r.startDate)],
    ["عدد المباني", fmtNum(p.buildings)],
    ["عدد الجريدات", p.grids ? fmtNum(p.grids) + (p.gridList ? " (من ملف الجريدات)" : "") : "—"],
    ["التيمز", p.teams.length + " تيمز: " + p.teams.map((t) => esc(t.name) + " (" + t.people + ")").join("، ") + ". التيم ليدر غير محسوب."],
    ["إنتاجية الفرد", fmtNum(p.ratePerPerson) + " مبنى في اليوم"],
    ["أيام العمل", wdNames],
    ["إجازات رسمية", p.holidays.length ? p.holidays.map((h) => fmtLong(h.date) + (h.note ? " (" + esc(h.note) + ")" : "")).join("<br>") : "لا يوجد"],
    ["الغياب", p.absences.length ? p.absences.map((a) => teamName(a.teamId) + ": " + a.people + " فرد، " + range(a) + (a.reason ? " (" + esc(a.reason) + ")" : "")).join("<br>") : "لا يوجد"],
  ]) + "</section>";

  const results = "<section><h2>نتائج المحافظة</h2>" + kv([
    ["تاريخ الانتهاء المتوقع", "<strong>" + fmtLong(r.endDate) + "</strong>"],
    ["أيام العمل", "<strong>" + r.workDays + " يوم</strong>"],
    ["المدة بالأسابيع", r.weeks + " أسبوع (أيام العمل ÷ " + p.workDays.length + ")"],
    ["الإنتاج اليومي الكلي", fmtNum(r.dailyCapacity) + " مبنى (" + r.people + " فرد × " + fmtNum(p.ratePerPerson) + ")"],
    ["الإنتاج في الأسبوع الكامل", fmtNum(r.dailyCapacity * p.workDays.length) + " مبنى"],
  ]) + "</section>";

  const charts =
    "<section><h2>الإنتاج الأسبوعي</h2><figure><figcaption>الشكل 1: المباني المنجزة في كل أسبوع</figcaption>" + C.weekly(weeks) + "</figure></section>" +
    "<section><h2>تقدم المشروع</h2><figure><figcaption>الشكل 2: المباني المنجزة بالتراكم حتى تاريخ الانتهاء</figcaption>" + C.progress(r.days, p.buildings) + "</figure></section>";

  const dash = (v) => (v == null ? "—" : fmtNum(v));
  const overview = "<section><h2>ملخص التيمز</h2><table><caption>الجدول 1: نصيب كل تيم ومدته. النصيب بحسب عدد أفراد التيم، ومدة كل تيم بعد الإجازات والغياب.</caption>" +
    "<thead><tr><th>التيم</th><th>الأفراد</th><th>يوميًا</th><th>أسبوعيًا</th><th>الجريدات</th><th>المباني</th><th>أيام التيم</th><th>ينتهي</th></tr></thead><tbody>" +
    d.rows.map((x) => "<tr><td>" + esc(x.name) + "</td><td>" + x.people + "</td><td>" + fmtNum(x.daily) + "</td><td>" + fmtNum(x.weekly) + "</td><td>" + dash(x.grids) +
      "</td><td>" + fmtNum(x.buildings) + "</td><td>" + x.workDays + "</td><td>" + (x.endDate ? fmtShort(x.endDate) : "—") + "</td></tr>").join("") +
    "</tbody><tfoot><tr><td>الإجمالي</td><td>" + d.totals.people + "</td><td>" + fmtNum(d.totals.daily) + "</td><td>" + fmtNum(d.totals.weekly) + "</td><td>" + dash(d.totals.grids) +
    "</td><td>" + fmtNum(d.totals.buildings) + "</td><td>" + r.workDays + "</td><td>" + fmtShort(r.endDate) + "</td></tr></tfoot></table></section>";

  // أثر الغياب
  const impactSec = !p.absences.length ? "" : "<section><h2>أثر الغياب</h2><p class='r-lead'>" +
    (r.delay > 0 ? "الإجمالي " + r.workDays + " يوم عمل بدل " + r.baseWorkDays + " (+" + r.delay + " يوم بسبب الغياب)."
                 : "الغياب مأثرش على الإجمالي: " + r.workDays + " يوم عمل.") + "</p>" +
    "<table><caption>الجدول 2: الوقت الإضافي جوه كل تيم وأثره على إجمالي المحافظة.</caption>" +
    "<thead><tr><th>التيم</th><th>أيام الغياب</th><th>مباني ضايعة</th><th>وقت إضافي جوه التيم</th><th>أيام التيم (قبل ← بعد)</th><th>أثره على الإجمالي</th></tr></thead><tbody>" +
    d.rows.map((x) => { const t = E.impactText(x, p.ratePerPerson);
      return "<tr><td>" + esc(x.name) + "</td><td>" + t.absent + "</td><td>" + t.lost + '</td><td class="' + (t.extraBad ? "bad" : "") + '">' + t.extra +
        "</td><td>" + t.span + '</td><td class="' + (t.totalBad ? "bad" : "") + '">' + t.total + "</td></tr>"; }).join("") +
    "</tbody></table></section>";

  // تقرير مستقل لكل تيم
  const perTeam = "<section><h2>تقرير كل تيم</h2><div style='display:grid;gap:16px'>" + d.rows.map((x) => {
    const abs = p.absences.filter((a) => a.teamId === x.id);
    let cum = 0;
    const it = E.impactText(x, p.ratePerPerson);
    const lead = x.endDate
      ? "يحتاج " + x.workDays + " يوم عمل (" + E.round1(x.workDays / p.workDays.length) + " أسبوع) لإنجاز " + fmtNum(x.buildings) + " مبنى، وينتهي يوم " + fmtLong(x.endDate) + "."
      : "مفيش مباني متوزعة على التيم ده.";
    const weekRows = x.weeks.map((w, i) => {
      cum += w.done;
      return "<tr><td>أسبوع " + (i + 1) + "</td><td>" + fmtShort(w.firstDate) + (w.firstDate === w.lastDate ? "" : " إلى " + fmtShort(w.lastDate)) +
        "</td><td>" + w.days + "</td><td>" + fmtNum(w.done) + "</td><td>" + fmtNum(cum) + "</td></tr>";
    }).join("");
    return '<div class="team-report"><h3>' + esc(x.name) + " <span>(" + x.people + " أفراد)</span></h3>" +
      '<p class="r-lead">' + lead + "</p>" +
      kv([
        ["الإنتاج اليومي", fmtNum(x.daily) + " مبنى (" + x.people + " × " + fmtNum(p.ratePerPerson) + ")"],
        ["الإنتاج الأسبوعي", fmtNum(x.weekly) + " مبنى"],
        ["الجريدات المسندة", dash(x.grids)],
        ["المباني المسندة", fmtNum(x.buildings)],
        ["أيام الغياب", x.absentPersonDays ? x.absentPersonDays + " فرد/يوم" : "لا يوجد"],
        ...(x.absentPersonDays ? [["المباني الضايعة", it.lost], ["الوقت الإضافي جوه التيم", it.extra], ["أثره على الإجمالي", it.total]] : []),
      ]) +
      (abs.length ? "<ul>" + abs.map((a) => "<li>غياب " + a.people + " فرد: " + range(a) + (a.reason ? " (" + esc(a.reason) + ")" : "") + "</li>").join("") + "</ul>" : "") +
      (weekRows ? "<table><thead><tr><th>الأسبوع</th><th>الفترة</th><th>أيام العمل</th><th>المنجز</th><th>التراكمي</th></tr></thead><tbody>" + weekRows + "</tbody></table>" : "") +
      "</div>";
  }).join("") + "</div></section>";

  const scen = "<section><h2>مقارنة السيناريوهات</h2><figure><figcaption>الشكل 3: أيام العمل المطلوبة في كل سيناريو</figcaption>" + C.scenarios(sc) + "</figure>" +
    "<table><thead><tr><th>السيناريو</th><th>الأفراد</th><th>أيام العمل</th><th>تاريخ الانتهاء</th><th>الفرق</th></tr></thead><tbody>" +
    sc.map((s) => {
      let diff = "—", cls = "";
      if (!s.ok) diff = "غير ممكن";
      else if (s.diff) { diff = (s.diff < 0 ? "−" : "+") + Math.abs(s.diff) + " يوم"; cls = s.diff < 0 ? "good" : "bad"; }
      return "<tr" + (s.key === "base" ? ' class="row-base"' : "") + "><td>" + s.label + "</td><td>" + s.people + "</td><td>" + (s.ok ? s.workDays + " يوم" : "—") +
        "</td><td>" + (s.ok ? fmtLong(s.endDate) : "—") + '</td><td class="' + cls + '">' + diff + "</td></tr>";
    }).join("") + "</tbody></table></section>";

  const notes = "<section><h2>ملاحظات</h2><ul class='notes'>" +
    "<li>الإنتاجية ثابتة عند " + fmtNum(p.ratePerPerson) + " مبنى لكل فرد في اليوم، ولا تشمل وقت مراجعة الجودة.</li>" +
    "<li>مدة المحافظة محسوبة يومًا بيوم، وبتخصم الإجازات الأسبوعية والرسمية وغياب الأفراد في أيامه بالظبط.</li>" +
    "<li>نصيب كل تيم بيتحدد بعدد أفراده، وكل تيم بيتحسب لوحده: غياب أي فرد بيأخر تيمه بس، والمحافظة بتنتهي لما آخر تيم يخلص.</li>" +
    "<li>أي تعديل في صفحة التخطيط بيغير التقرير تلقائيًا عند فتحه من جديد.</li></ul></section>";

  root.innerHTML = head + summary + inputs + results + charts + overview + impactSec + perTeam + scen + notes;
})();
