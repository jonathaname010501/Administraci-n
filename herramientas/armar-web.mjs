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
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(RAIZ, "apps-script");
const WEB = join(RAIZ, "web");   // íconos de la app (colibrí institucional)
const NOMBRE = "Control de Gestión";
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
  // Para instalar la app en el celular o la computadora, con su nombre e ícono
  "manifest.webmanifest": JSON.stringify({
    name: NOMBRE,
    short_name: NOMBRE,
    description: "Registro y seguimiento de oficios de la Subsecretaría de Territorios de Paz e Igualdad.",
    lang: "es-MX",
    start_url: "./",
    scope: "./",
    display: "standalone",
    theme_color: "#8f4889",
    background_color: "#ffffff",
    icons: [
      { src: "icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2) + "\n",
};
for (const [n, c] of Object.entries(archivos)) {
  if (/<\/(script|style)\b/i.test(c)) throw new Error(`${n}: quedó una etiqueta de cierre </script> o </style> dentro`);
}
const iconos = readdirSync(WEB).filter((n) => /\.png$/.test(n));
for (const n of ["icono-32.png", "icono-180.png", "icono-192.png", "icono-512.png", "icono-maskable-512.png"]) {
  if (!iconos.includes(n)) throw new Error(`Falta web/${n}`);
}
const v = Object.fromEntries(Object.entries(archivos).map(([n, c]) => [n, huella(c)]));
for (const n of iconos) v[n] = huella(readFileSync(join(WEB, n)));

const cuerpo = leer("Index.html").trim();
if (/<script|<style|<!--/i.test(cuerpo)) throw new Error("Index.html debe ser solo el cuerpo (sin <script>, <style> ni comentarios)");
const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${NOMBRE}</title>
  <meta name="application-name" content="${NOMBRE}">
  <meta name="apple-mobile-web-app-title" content="${NOMBRE}">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#8f4889">
  <link rel="icon" type="image/png" sizes="32x32" href="icono-32.png?v=${v["icono-32.png"]}">
  <link rel="icon" type="image/png" sizes="192x192" href="icono-192.png?v=${v["icono-192.png"]}">
  <link rel="apple-touch-icon" href="icono-180.png?v=${v["icono-180.png"]}">
  <link rel="manifest" href="manifest.webmanifest?v=${v["manifest.webmanifest"]}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <!-- Abre de antemano la conexión con el servidor de Google (la primera llamada tarda menos) -->
  <link rel="preconnect" href="https://script.google.com" crossorigin>
  <link rel="preconnect" href="https://script.googleusercontent.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cabin:wght@500;600;700&family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="estilos.css?v=${v["estilos.css"]}">
</head>
<body>
${cuerpo}
  <script src="excel.js?v=${v["excel.js"]}"></script>
  <script src="config.js?v=${v["config.js"]}"></script>
  <script src="app.js?v=${v["app.js"]}"></script>
</body>
</html>
`;

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, "index.html"), html);
for (const [n, c] of Object.entries(archivos)) writeFileSync(join(DIST, n), c);
for (const n of iconos) copyFileSync(join(WEB, n), join(DIST, n));
console.log(`✔ dist/ listo · servidor: ${api}`);
