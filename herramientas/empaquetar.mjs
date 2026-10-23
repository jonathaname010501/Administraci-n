// ════════════════════════════════════════════════════════════════════════
//  empaquetar.mjs · Arma un .zip del proyecto SIN datos reales, para
//  compartirlo o pedir ayuda (Windows, Mac, Linux; sin instalar nada).
//
//    npm run empaquetar                → ../control-gestion-<versión>.zip
//    npm run empaquetar -- ruta.zip    → donde tú digas
//
//  Solo entra código y documentación (la misma lista que deja subir
//  npm run publicar). Nunca entran: base/, capturas/, dist/, .git/,
//  node_modules/, .clasp.json, .clasprc.json, .publicar.json, .env,
//  ni archivos de datos (.xlsx, .csv, .json, .pdf, fotos…), salvo
//  package.json, vercel.json, appsscript.json y los íconos de web/.
//  Al final dice qué dejó fuera, para que lo revises.
// ════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const RAIZ = resolve(process.env.CG_RAIZ || join(dirname(fileURLToPath(import.meta.url)), ".."));

/* Carpetas que ni se recorren (datos, generados, credenciales). */
const CARPETAS_FUERA = new Set([".git", "node_modules", "base", "capturas", "dist", "__pycache__", ".vercel", "fuentes"]);
/* Lo que sí entra: código y documentación (igual que PERMITIDOS de publicar.mjs). */
const INCLUIR = [/^apps-script\//, /^herramientas\//, /^pruebas\//, /^web\//, /^\.github\//, /^[^/]+\.md$/i,
  /^package(-lock)?\.json$/, /^vercel\.json$/, /^\.gitignore$/, /^\.gitattributes$/, /^\.clasp\.json\.ejemplo$/, /^\.claspignore$/];
/* Aunque estén en una carpeta permitida, estos nunca entran. */
const PROHIBIDOS = [/(^|\/)\.clasprc\.json$/, /(^|\/)\.clasp\.json$/, /(^|\/)\.publicar\.json$/, /(^|\/)\.env(\.|$)/];
const EXT_DATOS = /\.(pdf|xlsx?|xlsm|ods|csv|tsv|docx?|odt|rtf|zip|rar|7z|json|jpe?g|png|gif|webp|heic|heif|tiff?|bmp|txt|eml|msg|pgm)$/i;
const EXCEPCIONES = [/^web\/[^/]+\.(png|svg)$/i, /^package(-lock)?\.json$/, /^vercel\.json$/, /^apps-script\/appsscript\.json$/];

function decidir(f) {
  if (PROHIBIDOS.some((re) => re.test(f))) return "credenciales";
  if (!INCLUIR.some((re) => re.test(f))) return "no es código ni documentación";
  if (EXT_DATOS.test(f) && !EXCEPCIONES.some((re) => re.test(f))) return "archivo de datos";
  return null;
}

function recorrer(dir, fuera, dentro) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name), rel = relative(RAIZ, abs).split(sep).join("/");
    if (e.isDirectory()) {
      if (CARPETAS_FUERA.has(e.name)) { fuera.push([rel + "/", "carpeta de datos o generada"]); continue; }
      recorrer(abs, fuera, dentro);
    } else if (e.isFile()) {
      const motivo = decidir(rel);
      if (motivo) fuera.push([rel, motivo]); else dentro.push(rel);
    }
  }
}

/* ── ZIP mínimo (deflate), sin librerías ── */
const TABLA = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABLA[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function fechaDos(d) {
  const a = Math.max(1980, d.getFullYear());
  return { hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dia: ((a - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function zip(entradas) {
  const partes = [], central = [];
  let pos = 0;
  for (const { nombre, datos, fecha } of entradas) {
    const n = Buffer.from(nombre, "utf8"), comp = deflateRawSync(datos, { level: 9 }), crc = crc32(datos), t = fechaDos(fecha);
    const usar = comp.length < datos.length, cuerpo = usar ? comp : datos, metodo = usar ? 8 : 0;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(metodo, 8);
    loc.writeUInt16LE(t.hora, 10); loc.writeUInt16LE(t.dia, 12); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(cuerpo.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26); loc.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(metodo, 10);
    cen.writeUInt16LE(t.hora, 12); cen.writeUInt16LE(t.dia, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(cuerpo.length, 20);
    cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0o100644 << 16 >>> 0, 38); cen.writeUInt32LE(pos, 42);
    partes.push(loc, n, cuerpo); central.push(cen, n);
    pos += loc.length + n.length + cuerpo.length;
  }
  const cd = Buffer.concat(central), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, cd, fin]);
}

/* ── principal ── */
const servidor = join(RAIZ, "apps-script", "Servidor.gs");
if (!existsSync(servidor)) { console.error("✘ No encuentro apps-script/Servidor.gs en " + RAIZ); process.exit(1); }
const version = (readFileSync(servidor, "utf8").match(/VERSION\s*=\s*'([^']+)'/) || [, "sin-version"])[1];
const destino = resolve(process.argv[2] || join(RAIZ, "..", "control-gestion-" + version + ".zip"));
if (destino.startsWith(RAIZ + sep)) { console.error("✘ Guarda el .zip fuera de la carpeta del proyecto (si no, se metería a git)."); process.exit(1); }

const fuera = [], dentro = [];
recorrer(RAIZ, fuera, dentro);
dentro.sort();
const carpeta = "control-gestion-" + version + "/";
const bytes = zip(dentro.map((f) => ({ nombre: carpeta + f, datos: readFileSync(join(RAIZ, f)), fecha: statSync(join(RAIZ, f)).mtime })));
writeFileSync(destino, bytes);

console.log("✔ " + destino);
console.log("  " + dentro.length + " archivos de código y documentación · " + (bytes.length / 1024).toFixed(0) + " KB · versión " + version);
if (fuera.length) {
  console.log("  Se quedaron fuera (revisa que no falte nada):");
  for (const [f, m] of fuera) console.log("    · " + f + "  (" + m + ")");
}
