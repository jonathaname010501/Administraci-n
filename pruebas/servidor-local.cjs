// ════════════════════════════════════════════════════════════════════════
//  servidor-local.cjs · Corre la app como si fuera Apps Script, en local,
//  para probarla en un navegador real (Playwright).
//
//   node pruebas/servidor-local.cjs [puerto]
//
//  · GET  /           → doGet() del servidor real, con un "google.script.run"
//                       de prueba que manda las llamadas a /__run.
//  · POST /__run      → llama la función pública del servidor (las privadas,
//                       las que terminan en _, se rechazan como en Google).
//  · GET  /__admin    → usuario y contraseña temporal que dio instalar().
// ════════════════════════════════════════════════════════════════════════
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno } = require("./simulador.cjs");

const PUERTO = Number(process.argv[2] || 4321);
const RUTA_BASE = path.join(__dirname, "..", "base", "base.json");
if (!fs.existsSync(RUTA_BASE)) {
  console.error("Falta base/base.json (los datos migrados; no van en GitHub). Cópialo del zip original.");
  process.exit(1);
}
const e = crearEntorno();
e.cargarBase(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "base", "base.json"), "utf8")));
const salida = e.comoDueno("instalar");
const m = salida.match(/Usuario: (\S+)\s+Contraseña temporal: (\S+)/);
e.comoAnonimo();
e.estado.url = `http://localhost:${PUERTO}/`;

const FUENTES = path.join(__dirname, "fuentes");
const SHIM = `<script>
window.google = { script: { run: (function () {
  function corredor(ok, mal) {
    return new Proxy({}, { get: function (_, nombre) {
      if (nombre === 'withSuccessHandler') return function (f) { return corredor(f, mal); };
      if (nombre === 'withFailureHandler') return function (f) { return corredor(ok, f); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/__run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: nombre, args: args }) })
          .then(function (r) { return r.json(); })
          .then(function (r) { setTimeout(function () { if (r.ok) ok && ok(r.valor); else mal && mal(new Error(r.error)); }, 120); })
          .catch(function (err) { mal && mal(err); });
      };
    } });
  }
  return corredor(null, null);
})() } };
</script>`;

function pagina() {
  let html = e.run("doGet").html;
  // Sin internet en el entorno de pruebas: fuentes locales si las hay
  if (fs.existsSync(FUENTES)) {
    html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/, '<link rel="stylesheet" href="/__fuentes/fuentes.css">');
  }
  return html.replace("<head>", "<head>" + SHIM);
}

http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(pagina());
  }
  if (req.url === "/favicon.ico") { res.writeHead(204); return res.end(); }
  if (req.method === "GET" && req.url === "/__admin") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ usuario: m[1], clave: m[2] }));
  }
  if (req.method === "GET" && req.url.startsWith("/__fuentes/")) {
    const f = path.join(FUENTES, path.basename(req.url));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".css") ? "text/css" : "font/ttf" });
    return res.end(fs.readFileSync(f));
  }
  // Como la URL /exec de Apps Script: la usa la página publicada (Vercel).
  // Google no contesta la consulta previa (OPTIONS); aquí tampoco, para que
  // la prueba falle si el navegador la llegara a necesitar.
  if (req.url === "/exec" && req.method === "OPTIONS") { res.writeHead(405); return res.end(); }
  if (req.url === "/exec" && req.method === "POST") {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      const r = e.post(cuerpo);
      res.writeHead(200, { "Content-Type": r.mime, "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(r.json));
    });
    return;
  }
  if (req.method === "POST" && req.url === "/__run") {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      let r;
      try {
        const { fn, args } = JSON.parse(cuerpo);
        r = { ok: true, valor: e.run(fn, ...(args || [])) };
      } catch (err) {
        r = { ok: false, error: err.message };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r));
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PUERTO, () => console.log(`Control de Gestión (simulado) en http://localhost:${PUERTO}  ·  admin: ${m[1]} / ${m[2]}`));
