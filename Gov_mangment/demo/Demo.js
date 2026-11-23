// ربط الواجهة بالبيانات. الترتيب:
//   1) اختيار المحافظة  ->  قراءة ملفها (أو بداية فاضية)
//   2) أي تعديل في الخانات  ->  تحديث state  ->  إعادة الحساب والعرض  ->  حفظ تلقائي في ملف المحافظة
//   3) أزرار: عرض التقارير (صفحة طباعة)، تصدير CSV، مسح بيانات المحافظة
(function () {
  "use strict";

  const E = window.Engine;
  const S = window.Store;
  const C = window.Charts;
  const $ = (id) => document.getElementById(id);
  const fmtNum = E.fmtNum;
  const gov = "data/gov.json";

  let govs = [];
  let hasData = new Set(); // أرقام المحافظات اللي ليها ملف
  let state = null; // مشروع المحافظة المختارة (null = لسه ما اختارش)
  let result = null; // نتيجة الحساب الأخيرة
  let saveTimer = null;
  let seq = 0;

  const el = {
    gov: $("gov"), start: $("data"), buildings: $("count-bulid"), grids: $("count-grids"),
    rate: $("resut-workinginday"), teamsList: $("teams-list"), total: $("total-employees"),
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const newId = (p) => p + Date.now().toString(36) + seq++;
  const toInt = (v) => Math.max(0, Math.floor(Number(v) || 0));

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  /* ================= المحافظات ================= */
function optionLabel(g) {
  return g.name + (hasData.has(String(g.id)) ? " " : "");
}
function refreshOptions() {
  const cur = el.gov.value;
  el.gov.innerHTML = '<option value="">اختر</option>' +
    govs.map((g) => {
      const saved = hasData.has(String(g.id));
      return '<option value="' + g.id + '"' + (saved ? ' class="has-data"' : '') + '>' +
        esc(optionLabel(g)) + "</option>";
    }).join("");
  el.gov.value = cur;
}

  async function getGov() {
    try {
      const res = await fetch(gov);
      govs = await res.json();
    } catch (error) {
      console.error("Error fetching data:", error);
      toast("تعذر تحميل قايمة المحافظات");
      return;
    }
    hasData = new Set(await S.init());
    refreshOptions();
   setStatus(S.mode === "server"
  ? "اختر محافظة. بياناتها بتتحفظ في ملف data/projects. المحافظات اللي ليها بيانات محفوظة مكتوب جنبها كده."
  : "السيرفر مش شغال، فالحفظ هيبقى في المتصفح بس. شغّل node server.js لحفظ ملفات JSON.");
    let last = null;
    try { last = localStorage.getItem("gis:lastGov"); } catch (e) { /* عادي */ }
    if (last && govs.some((g) => String(g.id) === last)) {
      el.gov.value = last;
      await loadGov(last);
    } else {
      setLocked(true);
    }
  }

  function setLocked(locked) {
    document.querySelectorAll("aside input, aside button, aside select").forEach((c) => {
      if (c !== el.gov) c.disabled = locked;
    });
  }

  async function loadGov(id) {
    clearTimeout(saveTimer);
    if (!id) {
      state = null;
      setLocked(true);
      renderResults();
      return;
    }
    const g = govs.find((x) => String(x.id) === String(id));
    try {
      const saved = await S.load(id);
      state = saved ? Object.assign(E.newProject(g.id, g.name), saved) : E.newProject(g.id, g.name);
      state.govId = g.id;
      state.govName = g.name;
      if (!state.startDate) state.startDate = E.todayCairo();
      setStatus(saved ? "تم فتح ملف المحافظة data/projects/" + g.id + ".json" : "محافظة جديدة. أي حاجة تكتبها هتتحفظ تلقائي.");
    } catch (e) {
      console.error(e);
      state = E.newProject(g.id, g.name);
      setStatus("تعذر قراءة ملف المحافظة، بدأنا بيانات فاضية", true);
    }
    try { localStorage.setItem("gis:lastGov", String(id)); } catch (e) { /* عادي */ }
    setLocked(false);
    closeAbsenceForm();
    renderForm();
    renderResults();
  }

  /* ================= الحفظ التلقائي ================= */
  function setStatus(text, isError) {
    const s = $("save-status");
    s.textContent = text;
    s.classList.toggle("is-error", !!isError);
  }

  function scheduleSave() {
    if (!state) return;
    setStatus("جاري الحفظ…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 450);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!state) return;
    const s = state;
    try {
      s.updatedAt = new Date().toISOString();
      await S.save(s.govId, s);
      hasData.add(String(s.govId));
      refreshOptions();
      const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
      setStatus((S.mode === "server" ? "تم الحفظ في data/projects/" + s.govId + ".json" : "تم الحفظ في المتصفح") + " · " + t);
    } catch (e) {
      console.error(e);
      setStatus("فشل الحفظ: " + e.message, true);
    }
  }

  function changed() {
    updateTotals();
    renderResults();
    scheduleSave();
  }

  /* ================= رسم الفورم ================= */
  function renderForm() {
    el.start.value = state.startDate || "";
    el.buildings.value = state.buildings || "";
    el.grids.value = state.grids || "";
    el.rate.value = state.ratePerPerson || "";
    renderWorkdays();
    renderTeams();
    renderHolidays();
    renderAbsences();
    renderGridInfo();
    updateTotals();
  }

  function updateTotals() {
    el.total.textContent = E.totalPeople(state.teams);
  }

  function renderGridInfo() {
    const info = $("grids-info");
    const clear = $("grids-clear");
    if (state.gridList && state.gridList.length) {
      info.textContent = "تم قراءة " + fmtNum(state.gridList.length) + " جريد، إجمالي " + fmtNum(state.buildings) + " مبنى. الجريدات هتتوزع على التيمز واحدة واحدة.";
      clear.hidden = false;
    } else {
      info.textContent = "الملف فيه عمود لرقم الجريد وعمود لعدد المباني في الجريد.";
      clear.hidden = true;
    }
    $("avg-per-grid").textContent = state.buildings > 0 && state.grids > 0
      ? "متوسط " + fmtNum(state.buildings / state.grids) + " مبنى لكل جريد" : "";
  }

  /* ---------- أيام العمل ---------- */
  function renderWorkdays() {
    $("workdays").innerHTML = E.DAY_NAMES.map((n, i) =>
      '<label class="day"><input type="checkbox" value="' + i + '"' + (state.workDays.includes(i) ? " checked" : "") + "><span>" + n + "</span></label>"
    ).join("");
  }
  $("workdays").addEventListener("change", () => {
    state.workDays = Array.from(document.querySelectorAll("#workdays input:checked")).map((c) => Number(c.value));
    changed();
  });

  /* ---------- التيمز ---------- */
  function renderTeams() {
    el.teamsList.innerHTML = state.teams.map((t) =>
      '<div class="team-row" data-id="' + t.id + '">' +
        '<input type="text" class="team-name" value="' + esc(t.name) + '" aria-label="اسم التيم" placeholder="اسم التيم">' +
        '<div class="count-team">' +
          '<button type="button" data-action="minus" aria-label="نقص">−</button>' +
          '<span class="team-count">' + t.people + "</span>" +
          '<button type="button" data-action="plus" aria-label="زيادة">+</button>' +
        "</div>" +
        '<button type="button" data-action="delete" aria-label="حذف التيم">حذف</button>' +
      "</div>"
    ).join("") || '<span class="hint">مفيش تيمز لسه. اضغط "إضافة تيم".</span>';
  }

  el.teamsList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = btn.closest(".team-row");
    const t = state.teams.find((x) => x.id === row.dataset.id);
    const a = btn.dataset.action;
    if (a === "plus") t.people = Math.min(999, t.people + 1);
    if (a === "minus") t.people = Math.max(1, t.people - 1);
    if (a === "delete") {
      state.teams = state.teams.filter((x) => x.id !== t.id);
      state.absences = state.absences.filter((x) => x.teamId !== t.id);
      renderTeams();
      renderAbsences();
    } else {
      row.querySelector(".team-count").textContent = t.people;
    }
    changed();
  });
  el.teamsList.addEventListener("input", (e) => {
    if (!e.target.classList.contains("team-name")) return;
    const t = state.teams.find((x) => x.id === e.target.closest(".team-row").dataset.id);
    t.name = e.target.value;
    renderAbsences();
    changed();
  });
  $("add-team").addEventListener("click", () => {
    state.teams.push({ id: newId("t"), name: "تيم " + (state.teams.length + 1), people: 10 });
    renderTeams();
    changed();
    const names = el.teamsList.querySelectorAll(".team-name");
    names[names.length - 1].focus();
  });

  /* ---------- الأرقام الأساسية ---------- */
  function manualCounts() {
    // لو عدّل الأرقام بإيده، ملف الجريدات الأصلي ما بقاش مطابق، فبنشيله
    if (state.gridList) { state.gridList = null; }
    renderGridInfo();
  }
  el.buildings.addEventListener("input", () => { state.buildings = toInt(el.buildings.value); manualCounts(); changed(); });
  el.grids.addEventListener("input", () => { state.grids = toInt(el.grids.value); manualCounts(); changed(); });
  el.rate.addEventListener("input", () => { state.ratePerPerson = toInt(el.rate.value); changed(); });
  el.start.addEventListener("input", () => { state.startDate = el.start.value; changed(); });
  el.gov.addEventListener("change", () => loadGov(el.gov.value));

  /* ---------- ملف الجريدات (CSV) ---------- */
  function parseGridsCsv(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
    if (!lines.length) throw new Error("الملف فاضي");
    const delim = [",", ";", "\t"].map((d) => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
    const clean = (v) => String(v == null ? "" : v).replace(/[,٬\s]/g, "");
    const isNum = (v) => clean(v) !== "" && !isNaN(Number(clean(v)));
    const cols = Math.max.apply(null, rows.map((r) => r.length));
    const numericIn = (from) => {
      const out = [];
      for (let c = 0; c < cols; c++) if (rows.slice(from).every((r) => isNum(r[c]))) out.push(c);
      return out;
    };
    // السطر الأول عنوان لو فيه خلية مش رقم في عمود باقي صفوفه كلها أرقام
    const header = rows.length > 1 && numericIn(1).some((c) => !isNum(rows[0][c])) ? rows.shift() : null;
    if (!rows.length) throw new Error("الملف مفيهوش صفوف بيانات");
    const numericCols = numericIn(0);
    let bCol = -1;
    if (header) bCol = header.findIndex((h, c) => numericCols.includes(c) && /(build|bld|count|cnt|total|num|مبن|عدد)/i.test(h));
    if (bCol < 0) bCol = numericCols.length ? numericCols[numericCols.length - 1] : -1;
    if (bCol < 0) throw new Error("مفيش عمود أرقام لعدد المباني");
    let idCol = header ? header.findIndex((h, c) => c !== bCol && /(id|grid|name|code|جريد|رقم|اسم|كود)/i.test(h)) : -1;
    if (idCol < 0) idCol = bCol === 0 ? -1 : 0;
    return rows.map((r, i) => ({
      id: idCol >= 0 && r[idCol] ? r[idCol] : String(i + 1),
      buildings: Math.max(0, Math.round(Number(clean(r[bCol])))),
    }));
  }

  $("grids-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const list = parseGridsCsv(String(reader.result));
        state.gridList = list;
        state.grids = list.length;
        state.buildings = list.reduce((s, g) => s + g.buildings, 0);
        el.grids.value = state.grids;
        el.buildings.value = state.buildings;
        renderGridInfo();
        changed();
      } catch (err) {
        toast("تعذر قراءة الملف: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(f, "utf-8");
  });
  $("grids-clear").addEventListener("click", () => { state.gridList = null; renderGridInfo(); changed(); });

  /* ---------- الإجازات الرسمية ---------- */
  function renderHolidays() {
    state.holidays.sort((a, b) => (a.date < b.date ? -1 : 1));
    $("holidays").innerHTML = state.holidays.map((h) =>
      '<div class="chip chip-holiday" data-date="' + h.date + '"><span>' + E.fmtLong(h.date) + " · " + esc(h.note || "إجازة رسمية") +
      '</span><button type="button" aria-label="حذف الإجازة">×</button></div>'
    ).join("");
  }
  $("add-holiday").addEventListener("click", () => {
    const d = $("holiday-date").value;
    if (!d) return toast("اختر تاريخ الإجازة الأول");
    if (state.holidays.some((h) => h.date === d)) return toast("الإجازة دي مضافة قبل كده");
    state.holidays.push({ date: d, note: $("holiday-note").value.trim() });
    $("holiday-date").value = "";
    $("holiday-note").value = "";
    renderHolidays();
    changed();
  });
  $("holidays").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.holidays = state.holidays.filter((h) => h.date !== b.closest(".chip").dataset.date);
    renderHolidays();
    changed();
  });

  /* ---------- الغياب ---------- */
  function rangeText(a) {
    return a.from === a.to ? E.fmtShort(a.from) : E.fmtShort(a.from) + " إلى " + E.fmtShort(a.to);
  }
  function renderAbsences() {
    $("absences").innerHTML = state.absences.map((a) => {
      const t = state.teams.find((x) => x.id === a.teamId);
      return '<div class="chip chip-absence" data-id="' + a.id + '"><span>' + esc(t ? t.name : "تيم محذوف") + " · " + a.people +
        " فرد · " + rangeText(a) + (a.reason ? " · " + esc(a.reason) : "") +
        '</span><button type="button" aria-label="حذف الغياب">×</button></div>';
    }).join("");
  }
  function closeAbsenceForm() {
    $("absence-form").hidden = true;
    $("abs-error").textContent = "";
  }
  $("add-absence").addEventListener("click", () => {
    if (!state.teams.length) return toast("أضف تيم الأول");
    $("abs-team").innerHTML = state.teams.map((t) => '<option value="' + t.id + '">' + esc(t.name) + "</option>").join("");
    $("abs-people").value = 1;
    $("abs-from").value = $("abs-to").value = E.todayCairo();
    $("abs-reason").value = "";
    $("abs-error").textContent = "";
    $("absence-form").hidden = false;
    $("abs-team").focus();
  });
  $("abs-cancel").addEventListener("click", closeAbsenceForm);
  $("absence-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const team = state.teams.find((t) => t.id === $("abs-team").value);
    const people = toInt($("abs-people").value);
    const from = $("abs-from").value, to = $("abs-to").value;
    const err = $("abs-error");
    if (!team) return (err.textContent = "اختر التيم");
    if (people < 1) return (err.textContent = "عدد الغايبين لازم يكون 1 على الأقل");
    if (people > team.people) return (err.textContent = "عدد الغايبين أكبر من أفراد التيم (" + team.people + ")");
    if (!from || !to) return (err.textContent = "حدد تاريخ البداية والنهاية");
    if (from > to) return (err.textContent = "تاريخ النهاية قبل تاريخ البداية");
    state.absences.push({ id: newId("a"), teamId: team.id, people, from, to, reason: $("abs-reason").value.trim() });
    closeAbsenceForm();
    renderAbsences();
    changed();
  });
  $("absences").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.absences = state.absences.filter((a) => a.id !== b.closest(".chip").dataset.id);
    renderAbsences();
    changed();
  });

  /* ---------- مسح بيانات المحافظة ---------- */
  $("reset-gov").addEventListener("click", async () => {
    if (!state) return;
    if (!window.confirm("هتمسح كل بيانات محافظة " + state.govName + " نهائيًا (المباني والتيمز والإجازات والغياب). متأكد؟")) return;
    clearTimeout(saveTimer);
    try {
      await S.remove(state.govId);
    } catch (e) {
      return setStatus("فشل المسح: " + e.message, true);
    }
    hasData.delete(String(state.govId));
    refreshOptions();
    state = E.newProject(state.govId, state.govName);
    closeAbsenceForm();
    renderForm();
    renderResults();
    setStatus("اتمسحت بيانات المحافظة. تقدر تبدأ من الأول.");
  });

  /* ================= النتائج ================= */
  function setText(id, v) { $(id).textContent = v; }

  function renderResults() {
    const empty = $("empty"), box = $("results");
    if (!state) {
      result = null;
      empty.hidden = false;
      box.hidden = true;
      setText("empty-title", "اختر محافظة لتبدأ");
      setText("empty-msg", "اختار المحافظة من القايمة، وبعدها أدخل عدد المباني وأضف التيمز، وهتظهر النتائج هنا فورًا.");
      return;
    }
    result = E.calculate(state);
    if (!result.ok) {
      empty.hidden = false;
      box.hidden = true;
      setText("empty-title", "محافظة " + state.govName);
      setText("empty-msg", result.reason + " عشان تظهر النتائج.");
      return;
    }
    empty.hidden = true;
    box.hidden = false;
    const r = result;
    setText("end-date", E.fmtLong(r.endDate));
    setText("end-note", "بعد " + r.calendarDays + " يوم من " + E.fmtShort(r.startDate));
    setText("work-days", r.workDays);
    setText("work-days-note", "بدون الإجازات الأسبوعية والرسمية");
    setText("daily-total", fmtNum(r.dailyCapacity));
    setText("daily-note", r.people + " فرد × " + fmtNum(state.ratePerPerson));

const wd = state.workDays.length;
setText("weeks", E.weeksText(r.workDays, wd));
setText("weeks-unit", "");
setText("weeks-note", "أيام العمل ÷ " + wd + " = " + E.round1(r.workDays / wd) + " أسبوع");







    renderGantt();
    $("weekly-chart").innerHTML = C.weekly(E.weekly(r.days));
    $("progress-chart").innerHTML = C.progress(r.days, state.buildings);
    renderTeamsTable();
    renderImpact();
    renderScenarios();
  }

  function renderGantt() {
    const r = result;
    const dayMap = new Map(r.days.map((d) => [d.date, d]));
    const groups = [];
    r.timeline.forEach((x) => {
      const dt = E.parse(x.date);
      const key = E.fmt(E.addDays(dt, -dt.getUTCDay()));
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, n: 0 });
      groups[groups.length - 1].n++;
    });
    let h = "<thead><tr><th class='g-corner' rowspan='2'>التيم</th>" +
      groups.map((g, i) => "<th class='g-week' colspan='" + g.n + "'>أسبوع " + (i + 1) + "</th>").join("") + "</tr><tr>" +
      r.timeline.map((x) => "<th class='g-day'>" + E.parse(x.date).getUTCDate() + "</th>").join("") + "</tr></thead>";
    const body = state.teams.map((t) =>
      "<tr><th scope='row' class='g-team'>" + esc(t.name) + " <small>" + t.people + "</small></th>" +
      r.timeline.map((x) => {
        if (x.kind === "holiday") return "<td class='g-cell g-holiday' title='" + E.fmtLong(x.date) + " · إجازة رسمية'></td>";
        const c = dayMap.get(x.date).perTeam[t.id];
        const pr = c.present;
        if (!c.active) return "<td class='g-cell g-idle' title='" + E.fmtLong(x.date) + " · التيم خلّص نصيبه'></td>";
        return "<td class='g-cell " + (pr < t.people ? "g-absence" : "g-work") + "' title='" + E.fmtLong(x.date) + " · " + pr + " من " + t.people + "'></td>";
      }).join("") + "</tr>"
    ).join("");
    $("gantt").innerHTML = "<table class='gantt'>" + h + "<tbody>" + body + "</tbody></table>";
  }

  function renderTeamsTable() {
    const d = E.distribute(state, result);
    const dash = (v) => (v == null ? "—" : fmtNum(v));
    $("teams-table").innerHTML = d.rows.map((x) =>
      "<tr><td>" + esc(x.name) + "</td><td>" + x.people + "</td><td>" + fmtNum(x.daily) + "</td><td>" + fmtNum(x.weekly) +
      "</td><td>" + dash(x.grids) + "</td><td>" + fmtNum(x.buildings) + "</td><td>" + x.workDays + " يوم</td><td>" + (x.endDate ? E.fmtShort(x.endDate) : "—") + "</td></tr>"
    ).join("");
    const t = d.totals;
    $("teams-foot").innerHTML = "<tr><td>الإجمالي</td><td>" + t.people + "</td><td>" + fmtNum(t.daily) + "</td><td>" + fmtNum(t.weekly) +
      "</td><td>" + dash(t.grids) + "</td><td>" + fmtNum(t.buildings) + "</td><td>" + result.workDays + " يوم</td><td>" + E.fmtShort(result.endDate) + "</td></tr>";
  }

  // أثر الغياب: كل تيم لوحده، وبعدين أثره على الإجمالي
  function renderImpact() {
    const panel = $("impact-panel");
    panel.hidden = !state.absences.length;
    if (!state.absences.length) return;
    const r = result, d = E.distribute(state, r);
    $("impact-summary").textContent = r.delay > 0
      ? "الإجمالي بقى " + r.workDays + " يوم عمل بدل " + r.baseWorkDays + " (+" + r.delay + " يوم بسبب الغياب)."
      : "الغياب مأثرش على الإجمالي: " + r.workDays + " يوم عمل زي ما هو.";
    $("impact-table").innerHTML = d.rows.map((x) => {
      const t = E.impactText(x, state.ratePerPerson);
      return "<tr><td>" + esc(x.name) + "</td><td>" + t.absent + "</td><td>" + t.lost + "</td><td class='" + (t.extraBad ? "bad" : "") + "'>" + t.extra +
        "</td><td>" + t.span + "</td><td class='" + (t.totalBad ? "bad" : "") + "'>" + t.total + "</td></tr>";
    }).join("");
  }

  function renderScenarios() {
    const rows = E.scenarios(state);
    $("scenarios-chart").innerHTML = C.scenarios(rows);
    $("scenarios-table").innerHTML = rows.map((s) => {
      let diff = "—", cls = "";
      if (!s.ok) diff = "غير ممكن";
      else if (s.diff !== 0 && s.diff !== null) {
        diff = (s.diff < 0 ? "−" : "+") + Math.abs(s.diff) + " يوم";
        cls = s.diff < 0 ? "good" : "bad";
      }
      return "<tr" + (s.key === "base" ? " class='row-base'" : "") + "><td>" + s.label + "</td><td>" + s.people + "</td><td>" +
        (s.ok ? s.workDays + " يوم" : "—") + "</td><td>" + (s.ok ? E.fmtLong(s.endDate) : "—") + "</td><td class='" + cls + "'>" + diff + "</td></tr>";
    }).join("");
  }

  /* ================= عرض التقارير (صفحة طباعة) ================= */
  $("btn1").addEventListener("click", async () => {
    if (!state || !result || !result.ok) return toast("اختر محافظة وأدخل عدد المباني وأضف تيم الأول عشان يتعمل التقرير");
    await flushSave(); // نتأكد إن آخر تعديل اتحفظ قبل ما صفحة التقرير تقراه
    const url = "report.html?gov=" + encodeURIComponent(state.govId);
    if (!window.open(url, "_blank")) window.location.href = url;
  });

  /* ================= تصدير CSV (بيتفتح في Excel) ================= */
  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  $("btn2").addEventListener("click", () => {
    if (!state || !result || !result.ok) return toast("مفيش نتائج للتصدير لسه");
    const r = result, d = E.distribute(state, r);
    const rows = [
      ["المحافظة", state.govName],
      ["تاريخ البداية", r.startDate],
      ["تاريخ الانتهاء المتوقع", r.endDate],
      ["أيام العمل", r.workDays],
      ["المدة بالأسابيع", r.weeks],
      ["أيام العمل بدون غياب", r.baseWorkDays],
      ["التأخير الإجمالي بسبب الغياب (يوم)", r.delay],
      ["عدد المباني", state.buildings],
      ["عدد الجريدات", state.grids],
      ["إنتاجية الفرد", state.ratePerPerson],
      [],
      ["التيم", "الأفراد", "يوميا", "اسبوعيا", "الجريدات", "المباني", "أيام التيم", "تاريخ انتهاء التيم", "أيام التيم بدون غياب", "التأخير جوه التيم (يوم)", "أثره على الإجمالي (يوم)"],
    ].concat(d.rows.map((x) => [x.name, x.people, x.daily, x.weekly, x.grids == null ? "" : x.grids, x.buildings, x.workDays, x.endDate || "", x.baseDays, x.delay, x.totalDelay]));
    rows.push([], ["اليوم", "التاريخ", "المنجز", "المتبقي"].concat(state.teams.map((t) => t.name)));
    r.days.forEach((x, i) => rows.push([i + 1, x.date, Math.round(x.done), Math.round(x.remaining)].concat(state.teams.map((t) => x.perTeam[t.id].done))));
    const csv = "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "gis-gov" + state.govId + "-" + r.startDate + ".csv"; // اسم بحروف إنجليزي عشان يشتغل في كل المتصفحات
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // لو القفل أو الإغلاق حصل قبل ما الحفظ يخلص
  window.addEventListener("beforeunload", () => { if (saveTimer) flushSave(); });

  getGov();
})();
