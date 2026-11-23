// طبقة الحفظ. لو السيرفر (server.js) شغال: بتحفظ ملف JSON لكل محافظة في data/projects.
// لو الصفحة اتفتحت من غير السيرفر: بتحفظ في المتصفح (localStorage) كحل بديل.
window.Store = (function () {
  "use strict";
  let mode = "local";
  const KEY = (id) => "gis:project:" + id;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { localStorage.setItem(k, v); },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* مفيش مشكلة */ } },
  };

  function localIds() {
    const ids = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("gis:project:") === 0) ids.push(k.slice(12));
      }
    } catch (e) { /* المتصفح مانع التخزين */ }
    return ids;
  }

  // بنجرّب السيرفر الأول. أي فشل = نرجع للتخزين المحلي.
  async function init() {
    try {
      const r = await fetch("api/projects", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.ids)) {
          mode = "server";
          return j.ids.map(String);
        }
      }
    } catch (e) { /* السيرفر مش شغال */ }
    mode = "local";
    return localIds();
  }

  async function load(id) {
    if (mode === "server") {
      const r = await fetch("api/projects/" + id, { cache: "no-store" });
      if (!r.ok) throw new Error("تعذر قراءة الملف (" + r.status + ")");
      return r.json(); // null لو المحافظة ملهاش ملف
    }
    const raw = ls.get(KEY(id));
    return raw ? JSON.parse(raw) : null;
  }

  async function save(id, data) {
    if (mode === "server") {
      const r = await fetch("api/projects/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("تعذر الحفظ (" + r.status + ")");
      return;
    }
    ls.set(KEY(id), JSON.stringify(data));
  }

  async function remove(id) {
    if (mode === "server") {
      const r = await fetch("api/projects/" + id, { method: "DELETE" });
      if (!r.ok) throw new Error("تعذر المسح (" + r.status + ")");
      return;
    }
    ls.del(KEY(id));
  }

  return { init, load, save, remove, get mode() { return mode; } };
})();
