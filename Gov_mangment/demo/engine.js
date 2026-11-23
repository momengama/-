// محرك الحساب. بيشتغل في المتصفح (window.Engine) وفي Node (للاختبار).
// كل الدوال نقية: نفس المدخلات تدي نفس النتيجة، ومفيش حاجة بتتغير برّه.
//
// فكرة الحساب:
//   1) نصيب كل تيم من المباني بيتحدد بعدد أفراده (من غير ما نحسب الغياب).
//   2) كل تيم بيتحسب لوحده يوم بيوم: أيام عمله، إجازاته، وغياب أفراده هو بس.
//   3) إجمالي المحافظة بينتهي لما آخر تيم يخلص. فغياب فرد في تيم بيأخر التيم ده،
//      وبيأخر الإجمالي بس لو التيم ده بقى هو الأطول.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY = 24 * 60 * 60 * 1000;
  const MAX_CALENDAR_DAYS = 5000;
  // رقم اليوم زي JavaScript: الأحد = 0 ... السبت = 6
  const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  /* ---------- التواريخ والأرقام ---------- */
  const parse = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const fmt = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  const todayCairo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const fmtNum = (n) => Math.round(n).toLocaleString("en-US");
  const round1 = (n) => Math.round(n * 10) / 10;
  const longFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const shortFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" });
  const fmtLong = (iso) => longFmt.format(parse(iso));
  const fmtShort = (iso) => shortFmt.format(parse(iso));
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY);

  /* ---------- شكل بيانات المحافظة (ده اللي بيتحفظ في ملف JSON) ---------- */
  function newProject(govId, govName) {
    return {
      version: 1,
      govId: govId,
      govName: govName,
      startDate: todayCairo(),
      buildings: 0,
      grids: 0,
      gridList: null, // لو اترفع ملف الجريدات: [{ id, buildings }]
      ratePerPerson: 600,
      teams: [], // [{ id, name, people }]
      workDays: [0, 1, 2, 3, 4], // الأحد إلى الخميس، والجمعة والسبت إجازة
      holidays: [], // [{ date, note }]
      absences: [], // [{ id, teamId, people, from, to, reason }]
      updatedAt: null,
    };
  }

  const totalPeople = (teams) => teams.reduce((s, t) => s + (Number(t.people) || 0), 0);

  function validate(p) {
    if (!(p.buildings > 0)) return "أدخل عدد المباني";
    if (!p.teams.length || totalPeople(p.teams) <= 0) return "أضف تيم واحد على الأقل";
    if (!(p.ratePerPerson > 0)) return "أدخل إنتاجية الفرد";
    if (!p.workDays.length) return "اختر يوم عمل واحد على الأقل في الأسبوع";
    return null;
  }

  /* ---------- تجميع على الأسابيع (الأسبوع بيبدأ الأحد) ---------- */
  function weekly(items) {
    const weeks = [];
    let current = null;
    for (const it of items) {
      const dt = parse(it.date);
      const key = fmt(addDays(dt, -dt.getUTCDay()));
      if (!current || current.key !== key) {
        current = { key, firstDate: it.date, lastDate: it.date, done: 0, days: 0 };
        weeks.push(current);
      }
      current.lastDate = it.date;
      current.done += it.done;
      current.days += 1;
    }
    return weeks;
  }

  /* ---------- نصيب كل تيم (بعدد الأفراد، من غير غياب) ---------- */
  // توزيع عدد صحيح بنسب (أكبر باقي) بحيث المجموع يطلع بالظبط
  function apportion(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return weights.map(() => 0);
    const raw = weights.map((w) => (total * w) / sum);
    const base = raw.map(Math.floor);
    let left = total - base.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < left; k++) base[order[k % order.length][1]]++;
    return base;
  }

  // لو عندنا الجريدات الحقيقية: نوزعها واحدة واحدة، الأكبر الأول، على التيم الأقل تحميلًا نسبةً لطاقته
  function assignGrids(gridList, caps) {
    const out = caps.map(() => ({ grids: 0, buildings: 0 }));
    const sorted = gridList.slice().sort((a, b) => b.buildings - a.buildings);
    for (const g of sorted) {
      let best = 0;
      let bestLoad = Infinity;
      caps.forEach((c, i) => {
        const load = c > 0 ? (out[i].buildings + g.buildings) / c : Infinity;
        if (load < bestLoad) {
          bestLoad = load;
          best = i;
        }
      });
      out[best].grids += 1;
      out[best].buildings += g.buildings;
    }
    return out;
  }

  function shares(p) {
    const weights = p.teams.map((t) => Number(t.people) || 0);
    if (p.gridList && p.gridList.length) {
      const a = assignGrids(p.gridList, weights);
      return { buildings: a.map((x) => x.buildings), grids: a.map((x) => x.grids) };
    }
    return {
      buildings: apportion(p.buildings, weights),
      grids: p.grids > 0 ? apportion(p.grids, weights) : p.teams.map(() => null),
    };
  }

  /* ---------- محاكاة تيم واحد يوم بيوم ---------- */
  function makeCtx(p) {
    return { p, holidays: new Set(p.holidays.map((h) => h.date)), start: p.startDate || todayCairo() };
  }

  // كام فرد من التيم موجود في اليوم ده (بعد خصم غياب التيم ده بس)؟
  function presentOn(ctx, team, iso, useAbsences) {
    if (!useAbsences) return Number(team.people) || 0;
    const absent = ctx.p.absences
      .filter((a) => a.teamId === team.id && iso >= a.from && iso <= a.to)
      .reduce((s, a) => s + (Number(a.people) || 0), 0);
    return Math.max(0, (Number(team.people) || 0) - absent);
  }

  // بترجّع [{ date, done, present }] لكل يوم عمل للتيم لحد ما يخلص نصيبه، أو null لو المدة طويلة قوي
  function runTeam(ctx, team, share, useAbsences) {
    const p = ctx.p;
    const out = [];
    let rem = share;
    let d = parse(ctx.start);
    for (let guard = 0; rem > 0 && guard < MAX_CALENDAR_DAYS; guard++, d = addDays(d, 1)) {
      if (!p.workDays.includes(d.getUTCDay())) continue; // إجازة أسبوعية
      const iso = fmt(d);
      if (ctx.holidays.has(iso)) continue; // إجازة رسمية
      const pr = presentOn(ctx, team, iso, useAbsences);
      const done = Math.min(pr * p.ratePerPerson, rem);
      rem -= done;
      out.push({ date: iso, done, present: pr });
    }
    return rem > 0 ? null : out;
  }

  /* ---------- الحساب الأساسي ---------- */
  function calculate(p) {
    const reason = validate(p);
    if (reason) return { ok: false, reason };

    const rate = p.ratePerPerson;
    const ctx = makeCtx(p);
    const sh = shares(p);

    const runs = p.teams.map((t, i) => runTeam(ctx, t, sh.buildings[i], true));
    if (runs.some((r) => r === null)) return { ok: false, reason: "المدة أطول من المسموح، راجع الأرقام" };
    const bases = p.teams.map((t, i) => runTeam(ctx, t, sh.buildings[i], false));

    const longest = runs.reduce((m, r) => (r.length > m.length ? r : m), []);
    const endDate = longest[longest.length - 1].date;
    const baseWorkDays = bases.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);

    // الجدول اليومي الإجمالي: مجموع شغل التيمز، لحد ما آخر تيم يخلص
    const maps = runs.map((r) => new Map(r.map((x) => [x.date, x])));
    const days = [];
    const timeline = []; // كل أيام العمل في الأسبوع، بما فيها الإجازات الرسمية (للجدول الزمني)
    let remaining = p.buildings;
    let cum = 0;
    let d = parse(ctx.start);
    for (let guard = 0; guard < MAX_CALENDAR_DAYS; guard++, d = addDays(d, 1)) {
      const iso = fmt(d);
      if (iso > endDate) break;
      if (!p.workDays.includes(d.getUTCDay())) continue;
      if (ctx.holidays.has(iso)) {
        timeline.push({ date: iso, kind: "holiday" });
        continue;
      }
      const perTeam = {};
      let done = 0;
      p.teams.forEach((t, i) => {
        const e = maps[i].get(iso);
        const pr = presentOn(ctx, t, iso, true);
        perTeam[t.id] = { present: pr, cap: pr * rate, done: e ? e.done : 0, active: !!e };
        done += e ? e.done : 0;
      });
      remaining -= done;
      cum += done;
      days.push({ date: iso, done, remaining: Math.max(0, remaining), cum, perTeam });
      timeline.push({ date: iso, kind: "work" });
    }

    const people = totalPeople(p.teams);
    return {
      ok: true,
      startDate: ctx.start,
      endDate,
      workDays: days.length,
      baseWorkDays, // المدة لو مفيش غياب
      delay: days.length - baseWorkDays, // التأخير الإجمالي بسبب الغياب
      calendarDays: diffDays(ctx.start, endDate) + 1,
      weeks: round1(days.length / p.workDays.length),
      people,
      dailyCapacity: people * rate,
      days,
      timeline,
      teams: p.teams.map((t, i) => ({ id: t.id, buildings: sh.buildings[i], grids: sh.grids[i], run: runs[i], base: bases[i] })),
    };
  }

  /* ---------- نتيجة كل تيم لوحده + أثره على الإجمالي ---------- */
  function distribute(p, res) {
    const rate = p.ratePerPerson;
    const wdCount = p.workDays.length;
    const baseLens = res.teams.map((t) => t.base.length);

    const rows = p.teams.map((t, i) => {
      const tr = res.teams[i];
      const run = tr.run;
      const daily = t.people * rate;
      const absentPersonDays = run.reduce((s, x) => s + (t.people - x.present), 0);
      const lostBuildings = absentPersonDays * rate; // فرد/يوم × إنتاجية الفرد
      const otherBase = baseLens.reduce((m, v, j) => (j === i ? m : Math.max(m, v)), 0);
      return {
        id: t.id,
        name: t.name,
        people: t.people,
        daily,
        weekly: daily * wdCount,
        grids: tr.grids,
        buildings: tr.buildings,
        workDays: run.length,
        endDate: run.length ? run[run.length - 1].date : null,
        baseDays: tr.base.length,
        delay: run.length - tr.base.length, // الوقت الإضافي جوه التيم (أيام عمل)
        absentPersonDays,
        lostBuildings,
        delayEquiv: daily > 0 ? round1(lostBuildings / daily) : 0, // الفاقد بالأيام (كسر)
        totalDelay: Math.max(otherBase, run.length) - res.baseWorkDays, // لو الغياب ده لوحده، الإجمالي بيتأخر كام
        weeks: weekly(run),
      };
    });

    const sum = (key) => rows.reduce((s, r) => s + (r[key] || 0), 0);
    return {
      rows,
      totals: {
        people: sum("people"),
        daily: sum("daily"),
        weekly: sum("weekly"),
        grids: rows[0].grids === null ? null : sum("grids"),
        buildings: sum("buildings"),
      },
    };
  }

  // ملخص الأثر لكل تيم + الإجمالي (للاختبار والعرض)
  function impact(p) {
    const res = calculate(p);
    if (!res.ok) return res;
    const d = distribute(p, res);
    return {
      ok: true,
      baseDays: res.baseWorkDays,
      days: res.workDays,
      delay: res.delay,
      teams: d.rows.map((r) => ({
        id: r.id, name: r.name, baseDays: r.baseDays, days: r.workDays, delay: r.delay,
        lostBuildings: r.lostBuildings, totalDelay: r.totalDelay,
      })),
    };
  }

  // نصوص جاهزة للعرض في الجدول والتقرير
  function impactText(x, rate) {
    const has = x.absentPersonDays > 0;
    return {
      absent: has ? x.absentPersonDays + " فرد/يوم" : "—",
      lost: has ? x.absentPersonDays + " × " + fmtNum(rate) + " = " + fmtNum(x.lostBuildings) + " مبنى" : "—",
      extra: !has ? "—"
        : x.delay > 0 ? "+" + x.delay + " يوم عمل (الفاقد يعادل " + x.delayEquiv + " يوم)"
        : "لا تأخير (الفاقد يعادل " + x.delayEquiv + " يوم واتعوّض)",
      span: x.baseDays + " ← " + x.workDays + " يوم",
      total: x.totalDelay > 0 ? "+" + x.totalDelay + " يوم" : has ? "لا يؤثر" : "—",
      totalBad: x.totalDelay > 0,
      extraBad: x.delay > 0,
    };
  }

  // "4 أسابيع ويومين" بدل 4.4 (الأيام أيام عمل)
  function weeksText(days, wd) {
    const cnt = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n + " " + (n <= 10 ? few : many));
    const fw = Math.floor(days / wd), rd = days % wd;
    if (fw === 0) return cnt(rd, "يوم عمل", "يومين عمل", "أيام عمل", "يوم عمل");
    return cnt(fw, "أسبوع", "أسبوعين", "أسابيع", "أسبوع") + (rd ? " و" + cnt(rd, "يوم", "يومين", "أيام", "يوم") : "");
  }

  /* ---------- مقارنة السيناريوهات ---------- */
  function scenarios(p) {
    const clone = () => JSON.parse(JSON.stringify(p));
    const people = totalPeople(p.teams);
    const avg = Math.max(1, Math.round(people / Math.max(1, p.teams.length)));

    const plus = clone();
    plus.teams.forEach((t) => (t.people += 1));

    const extra = clone();
    extra.teams.push({ id: "__new", name: "تيم جديد", people: avg });

    const minus = clone();
    minus.teams.forEach((t) => (t.people -= 1));
    minus.teams = minus.teams.filter((t) => t.people > 0);
    minus.absences = minus.absences.filter((a) => minus.teams.some((t) => t.id === a.teamId));

    const defs = [
      { key: "base", label: "الوضع الحالي", short: "الحالي", p },
      { key: "plus", label: "زيادة فرد في كل تيم", short: "+1 فرد/تيم", p: plus },
      { key: "team", label: "إضافة تيم جديد (" + avg + " أفراد)", short: "تيم جديد", p: extra },
      { key: "minus", label: "نقص فرد من كل تيم", short: "−1 فرد/تيم", p: minus },
    ];
    const base = calculate(p);
    return defs.map((s) => {
      const r = s.key === "base" ? base : calculate(s.p);
      return {
        key: s.key,
        label: s.label,
        short: s.short,
        people: totalPeople(s.p.teams),
        ok: r.ok,
        workDays: r.ok ? r.workDays : null,
        endDate: r.ok ? r.endDate : null,
        diff: r.ok && base.ok ? r.workDays - base.workDays : null,
      };
    });
  }

  return {
    DAY_NAMES, newProject, totalPeople, validate, calculate, weekly, apportion, distribute, impact, impactText, scenarios, weeksText,
    parse, fmt, addDays, todayCairo, fmtNum, fmtLong, fmtShort, round1, diffDays,
  };
});
