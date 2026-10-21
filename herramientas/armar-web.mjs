// ════════════════════════════════════════════════════════════════════════
//  armar-web.mjs · Arma la versión para Vercel con los MISMOS archivos que
//  se pegan en Apps Script (apps-script/*.html). No hay que mantener dos
//  copias de la app: se escribe una vez y sale en los dos lados.
//
//   CG_API_URL=https://script.google.com/macros/s/XXXX/exec  node herramientas/armar-web.mjs
//
//  Sale en dist/:
//    index.html   sin código en línea (la CSP de vercel.json lo prohíbe)
//    estilos.css · excel.js · app.js   (con ?v=huella para que no se quede
//                                       la versión vieja en el navegador)
//    config.js    window.CG_API = la URL /exec de Apps Script
//    favicon.svg
// ════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(RAIZ, "apps-script");
const DIST = join(RAIZ, "dist");

const api = (process.env.CG_API_URL || "").trim();
const local = process.env.CG_PERMITIR_LOCAL === "1";
const valida = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(api) || (local && /^http:\/\/localhost:\d+\/exec$/.test(api));
if (!valida) {
  console.error(
    "\n✘ Falta CG_API_URL o no es válida.\n" +
      "  Debe ser la URL de la aplicación web de Apps Script, la que termina en /exec:\n" +
      "  https://script.google.com/macros/s/AKfy…/exec\n" +
      "  En Vercel: Settings → Environment Variables → CG_API_URL\n"
  );
  process.exit(1);
}

const leer = (n) => readFileSync(join(SRC, n), "utf8");
const sinEtiqueta = (s, tag) => s.replace(new RegExp(`^\\s*<${tag}>`), "").replace(new RegExp(`</${tag}>\\s*$`), "").trim() + "\n";
const huella = (s) => createHash("sha256").update(s).digest("hex").slice(0, 10);

const archivos = {
  "estilos.css": sinEtiqueta(leer("Estilos.html"), "style"),
  "excel.js": sinEtiqueta(leer("Excel.html"), "script"),
  "app.js": sinEtiqueta(leer("App.html"), "script"),
  "config.js": `// Generado por armar-web.mjs: dirección del servidor (Apps Script)\nwindow.CG_API = ${JSON.stringify(api)};\n`,
  "favicon.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#8f4889"/>' +
    '<rect y="54" width="64" height="10" fill="#b28e5c"/><text x="32" y="41" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">CG</text></svg>\n',
};
for (const [n, c] of Object.entries(archivos)) {
  if (/<\/(script|style)\b/i.test(c)) throw new Error(`${n}: quedó una etiqueta de cierre </script> o </style> dentro`);
}
const v = Object.fromEntries(Object.entries(archivos).map(([n, c]) => [n, huella(c)]));

let html = leer("Index.html")
  .replace(/\s*<base target="_top">/, "")
  .replace("<meta charset=\"utf-8\">", '<meta charset="utf-8">\n  <meta name="referrer" content="no-referrer">\n  <title>Control de Gestión</title>\n  <link rel="icon" href="favicon.svg?v=' + v["favicon.svg"] + '" type="image/svg+xml">')
  .replace("<!--ESTILOS-->", `<link rel="stylesheet" href="estilos.css?v=${v["estilos.css"]}">`)
  .replace("<!--EXCEL-->", `<script src="excel.js?v=${v["excel.js"]}"></script>`)
  .replace("<!--APP-->", `<script src="config.js?v=${v["config.js"]}"></script>\n  <script src="app.js?v=${v["app.js"]}"></script>`);

if (/<!--(ESTILOS|EXCEL|APP)-->/.test(html)) throw new Error("Index.html: faltó reemplazar algún marcador");
if (/<script>(?!<\/script>)|<style>/.test(html)) throw new Error("Index.html: quedó código en línea (la CSP lo bloquearía)");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, "index.html"), html);
for (const [n, c] of Object.entries(archivos)) writeFileSync(join(DIST, n), c);
console.log(`✔ dist/ listo · servidor: ${api}`);
