// npm run empaquetar: el .zip trae el código y nunca los datos reales ni las credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "herramientas", "empaquetar.mjs");

/** Lee un .zip (directorio central) y devuelve { nombre: Buffer }. */
function leerZip(b) {
  const fin = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(fin >= 0, "sin fin de directorio central");
  const total = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16);
  const salida = {};
  for (let i = 0; i < total; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    const metodo = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), tam = b.readUInt32LE(p + 20), real = b.readUInt32LE(p + 24);
    const ln = b.readUInt16LE(p + 28), lx = b.readUInt16LE(p + 30), lc = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const nombre = b.slice(p + 46, p + 46 + ln).toString("utf8");
    const ini = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const datos = metodo === 8 ? zlib.inflateRawSync(b.slice(ini, ini + tam)) : b.slice(ini, ini + tam);
    assert.equal(datos.length, real, nombre);
    assert.equal(zlib.crc32 ? zlib.crc32(datos) : crc, crc, "CRC de " + nombre);
    salida[nombre] = datos;
    p += 46 + ln + lx + lc;
  }
  return salida;
}

function proyectoFalso() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "cg-emp-"));
  const poner = (f, c) => { fs.mkdirSync(path.dirname(path.join(raiz, f)), { recursive: true }); fs.writeFileSync(path.join(raiz, f), c); };
  poner("apps-script/Servidor.gs", "var VERSION = '9.9.9';\n");
  poner("apps-script/App.html", "<script>var á = 'ñandú';</script>\n".repeat(50));
  poner("apps-script/appsscript.json", "{}");
  poner("web/icono-192.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  poner("herramientas/armar-web.mjs", "// x\n");
  poner(".github/workflows/pruebas.yml", "name: Pruebas\n");
  poner("LEEME.md", "# Hola\n");
  poner("package.json", "{\"name\":\"x\"}");
  poner("vercel.json", "{}");
  poner(".gitignore", "base/\n");
  poner(".clasp.json.ejemplo", "{}");
  // lo que NUNCA debe entrar
  poner("base/base.json", "{\"nombres\":[\"Persona Real\"]}");
  poner("capturas/1.7.0/portal.png", "png");
  poner("dist/app.js", "generado");
  poner(".git/config", "[core]");
  poner("node_modules/x/index.js", "x");
  poner(".clasp.json", "{\"scriptId\":\"secreto\"}");
  poner(".clasprc.json", "{\"token\":\"secreto\"}");
  poner(".publicar.json", "{}");
  poner(".env", "CLAVE=secreta");
  poner("pruebas/fuentes/minutario.xlsx", "x");
  poner("pruebas/exportado.json", "{}");
  poner("apps-script/escaneo.pdf", "%PDF");
  poner("Directorio.xlsx", "x");
  poner("respaldo.csv", "a,b");
  poner("notas-personales.txt", "x");
  return raiz;
}

test("empaquetar: solo código y documentación, con una carpeta por versión", () => {
  const raiz = proyectoFalso();
  const destino = path.join(os.tmpdir(), "cg-emp-" + process.pid + ".zip");
  const r = spawnSync(process.execPath, [SCRIPT, destino], { encoding: "utf8", env: { ...process.env, CG_RAIZ: raiz } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const z = leerZip(fs.readFileSync(destino));
  const nombres = Object.keys(z).sort();
  assert.deepEqual(nombres, [".clasp.json.ejemplo", ".github/workflows/pruebas.yml", ".gitignore", "LEEME.md", "apps-script/App.html", "apps-script/Servidor.gs",
    "apps-script/appsscript.json", "herramientas/armar-web.mjs", "package.json", "vercel.json", "web/icono-192.png"].map((f) => "control-gestion-9.9.9/" + f).sort());
  assert.equal(z["control-gestion-9.9.9/apps-script/App.html"].toString("utf8"), fs.readFileSync(path.join(raiz, "apps-script/App.html"), "utf8"), "contenido idéntico (acentos incluidos)");
  for (const f of ["base/", "capturas/", "dist/", ".git/", "node_modules/", ".clasp.json", ".clasprc.json", ".env", "Directorio.xlsx", "respaldo.csv", "apps-script/escaneo.pdf", "pruebas/exportado.json"]) {
    assert.match(r.stdout, new RegExp("· " + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "avisa que dejó fuera " + f);
  }
  // Python (si está) también lo abre
  const py = ["python3", "python"].find((p) => spawnSync(p, ["-c", "1"]).status === 0);
  if (py) {
    const t = spawnSync(py, ["-I", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(len(z.namelist()))", destino], { encoding: "utf8" });
    assert.equal(t.status, 0, t.stderr);
    assert.equal(t.stdout.trim(), String(nombres.length));
  }
  fs.rmSync(raiz, { recursive: true, force: true }); fs.rmSync(destino, { force: true });
});

test("empaquetar: no deja guardar el .zip dentro del proyecto", () => {
  const raiz = proyectoFalso();
  const r = spawnSync(process.execPath, [SCRIPT, path.join(raiz, "dentro.zip")], { encoding: "utf8", env: { ...process.env, CG_RAIZ: raiz } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fuera de la carpeta del proyecto/);
  assert.equal(fs.existsSync(path.join(raiz, "dentro.zip")), false);
  fs.rmSync(raiz, { recursive: true, force: true });
});
