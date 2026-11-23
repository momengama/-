// سيرفر صغير بدون أي مكتبات: بيقدّم صفحات الموقع وبيحفظ ملف JSON لكل محافظة.
// التشغيل:  node server.js   ثم افتح  http://localhost:3000
//
// الـ API:
//   GET    /api/projects        -> قايمة أرقام المحافظات اللي ليها ملف
//   GET    /api/projects/:id    -> بيانات المحافظة (أو null لو ملهاش ملف)
//   PUT    /api/projects/:id    -> حفظ بيانات المحافظة في data/projects/:id.json
//   DELETE /api/projects/:id    -> مسح ملف المحافظة

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data", "projects");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 5 * 1024 * 1024; // 5MB تكفي لآلاف الجريدات

fs.mkdirSync(DATA_DIR, { recursive: true });

// أرقام المحافظات المسموحة تيجي من data/gov.json، فمفيش اسم ملف غريب يتكتب.
const govs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "gov.json"), "utf8"));
const validIds = new Set(govs.map((g) => String(g.id)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const fileOf = (id) => path.join(DATA_DIR, id + ".json");

async function handleApi(req, res, pathname) {
  if (pathname === "/api/projects" && req.method === "GET") {
    const ids = fs
      .readdirSync(DATA_DIR)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => f.replace(".json", ""))
      .filter((id) => validIds.has(id));
    return sendJson(res, 200, { ids });
  }

  const m = pathname.match(/^\/api\/projects\/(\d+)$/);
  if (!m || !validIds.has(m[1])) return sendJson(res, 404, { error: "محافظة غير موجودة" });
  const id = m[1];

  if (req.method === "GET") {
    // محافظة من غير ملف: بنرجّع null (مش 404) عشان المتصفح ما يطبعش خطأ في الكونسول
    if (!fs.existsSync(fileOf(id))) return send(res, 200, "null");
    return send(res, 200, fs.readFileSync(fileOf(id), "utf8"));
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return sendJson(res, 400, { error: "JSON غير صالح" });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return sendJson(res, 400, { error: "شكل البيانات غير صحيح" });
    }
    // نكتب في ملف مؤقت وبعدين نبدّل، عشان الملف ما يتبوظش لو الجهاز فصل أثناء الحفظ
    const tmp = fileOf(id) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
    fs.renameSync(tmp, fileOf(id));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "DELETE") {
    if (fs.existsSync(fileOf(id))) fs.unlinkSync(fileOf(id));
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: "طريقة غير مسموحة" });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(ROOT, rel));
  // منع الخروج بره مجلد المشروع، ومنع تحميل ملف السيرفر نفسه
  if (!file.startsWith(ROOT + path.sep) || path.basename(file) === "server.js") {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
}

http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");
      serveStatic(req, res, pathname);
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: "خطأ في السيرفر" });
    }
  })
  .listen(PORT, () => {
    console.log("التطبيق شغال على: http://localhost:" + PORT);
    console.log("ملفات المحافظات بتتحفظ في: " + DATA_DIR);
  });
