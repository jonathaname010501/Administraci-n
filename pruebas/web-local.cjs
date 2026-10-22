// ════════════════════════════════════════════════════════════════════════
//  web-local.cjs · Sirve dist/ (la versión para Vercel) con los MISMOS
//  encabezados de seguridad de vercel.json, para probarla en navegador.
//  La CSP se ajusta solo para dejar hablar con el servidor local.
//
//   CG_PERMITIR_LOCAL=1 CG_API_URL=http://localhost:4321/exec node herramientas/armar-web.mjs
//   node pruebas/servidor-local.cjs 4321      (en otra terminal)
//   node pruebas/web-local.cjs 4322
// ════════════════════════════════════════════════════════════════════════
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PUERTO = Number(process.argv[2] || 4322);
const API = process.argv[3] || "http://localhost:4321";
const DIST = path.join(__dirname, "..", "dist");
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
const encabezados = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
encabezados["Content-Security-Policy"] = encabezados["Content-Security-Policy"].replace(/connect-src [^;]+/, "connect-src " + API);
delete encabezados["Strict-Transport-Security"];
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

http.createServer((req, res) => {
  const ruta = decodeURIComponent(req.url.split("?")[0]);
  const archivo = path.join(DIST, ruta === "/" ? "index.html" : path.normalize(ruta).replace(/^([/\\])+/, ""));
  if (!archivo.startsWith(DIST) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404, encabezados); return res.end("No existe");
  }
  res.writeHead(200, { ...encabezados, "Content-Type": TIPOS[path.extname(archivo)] || "application/octet-stream" });
  res.end(fs.readFileSync(archivo));
}).listen(PUERTO, () => console.log(`dist/ en http://localhost:${PUERTO} (API ${API})`));
