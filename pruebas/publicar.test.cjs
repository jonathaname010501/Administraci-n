// Pruebas de «npm run publicar» con un clasp de mentiras y un GitHub de mentiras
// (un repositorio git local). No toca Google ni GitHub de verdad.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const RAIZ = path.join(__dirname, "..");
const hayGit = spawnSync("git", ["--version"]).status === 0;
// Cuando «publicar» corre las pruebas, esta no se corre (si no, se llamaría a sí misma).
const saltar = process.env.CG_PUBLICANDO === "1" ? "se está corriendo desde npm run publicar" : !hayGit ? "sin git" : false;
const ID = "AKfycbxPRUEBA_de_implementacion_1234567890";

const CLASP_FALSO = `
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.CLASP_LOG, JSON.stringify(a) + "\\n");
if (a[0] === "--version") { console.log("3.4.1"); process.exit(0); }
if (a[0] === "list-deployments") { console.log("Found 2 deployments.\\n- AKfycbHEAD @HEAD\\n- ${ID} @7 - Versión 7"); process.exit(0); }
if (process.env.CLASP_FALLA && a[0] === process.env.CLASP_FALLA) { console.error("Error falso de " + a[0]); process.exit(1); }
console.log("ok " + a[0]);
`;

function g(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

/** Proyecto de mentiras en una carpeta temporal, con git y un «GitHub» local. */
function proyecto({ conId = true, prueba = "node -e process.exit(0)" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publicar-"));
  const remoto = fs.mkdtempSync(path.join(os.tmpdir(), "remoto-"));
  fs.mkdirSync(path.join(dir, "apps-script"));
  fs.mkdirSync(path.join(dir, "herramientas"));
  for (const f of ["Servidor.gs", "App.html"]) fs.copyFileSync(path.join(RAIZ, "apps-script", f), path.join(dir, "apps-script", f));
  fs.copyFileSync(path.join(RAIZ, "herramientas", "publicar.mjs"), path.join(dir, "herramientas", "publicar.mjs"));
  fs.copyFileSync(path.join(RAIZ, ".gitignore"), path.join(dir, ".gitignore"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: prueba } }));
  fs.writeFileSync(path.join(dir, ".clasp.json"), JSON.stringify({ scriptId: "1abcPRUEBA", rootDir: "apps-script" }));
  if (conId) fs.writeFileSync(path.join(dir, ".publicar.json"), JSON.stringify({ deploymentId: ID }));
  // datos reales que NUNCA deben subir
  fs.mkdirSync(path.join(dir, "base"));
  fs.writeFileSync(path.join(dir, "base", "base.json"), "{}");
  fs.writeFileSync(path.join(dir, "Minutario.xlsx"), "x");
  // el clasp de mentiras y su registro viven FUERA del proyecto
  const fuera = fs.mkdtempSync(path.join(os.tmpdir(), "clasp-falso-"));
  fs.writeFileSync(path.join(fuera, "clasp-falso.cjs"), CLASP_FALSO);
  g(remoto, ["init", "-q", "--bare"]);
  g(dir, ["init", "-q", "-b", "main"]);
  g(dir, ["config", "user.email", "prueba@example.com"]);
  g(dir, ["config", "user.name", "Prueba"]);
  g(dir, ["add", "-A"]);
  g(dir, ["commit", "-q", "-m", "inicio"]);
  g(dir, ["remote", "add", "origin", remoto]);
  g(dir, ["push", "-q", "-u", "origin", "main"]);
  return { dir, remoto, log: path.join(fuera, "clasp.log"), clasp: path.join(fuera, "clasp-falso.cjs") };
}

function publicar(p, args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(p.dir, "herramientas", "publicar.mjs"), ...args], {
    cwd: p.dir, encoding: "utf8", env: { ...process.env, CG_CLASP: p.clasp, CLASP_LOG: p.log, NO_COLOR: "1", CG_PUBLICANDO: "", ...env },
  });
  const llamadas = fs.existsSync(p.log) ? fs.readFileSync(p.log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { codigo: r.status, salida: r.stdout + r.stderr, clasp: llamadas.filter((a) => a[0] !== "--version") };
}

test("publicar: camino completo (pruebas, versiones, push, implementación, revisión y git)", { skip: saltar }, () => {
  const p = proyecto();
  fs.appendFileSync(path.join(p.dir, "apps-script", "App.html"), "\n");
  const r = publicar(p, ["Agregué varios destinatarios"]);
  assert.equal(r.codigo, 0, r.salida);
  assert.deepEqual(r.clasp, [["push", "--force"], ["update-deployment", ID, "-d", "Agregué varios destinatarios"]]);
  assert.match(r.salida, /1\/6 · Pruebas[\s\S]*2\/6 · Versiones[\s\S]*3\/6[\s\S]*4\/6[\s\S]*5\/6[\s\S]*6\/6[\s\S]*Listo/);
  assert.equal(g(p.remoto, ["log", "-1", "--format=%s", "main"]).trim(), "Agregué varios destinatarios");
  const subidos = g(p.remoto, ["ls-tree", "-r", "--name-only", "main"]);
  assert.doesNotMatch(subidos, /base\/|\.xlsx|\.publicar\.json|\.clasp\.json/, "los datos reales y la configuración local no subieron");
  assert.ok(JSON.parse(fs.readFileSync(path.join(p.dir, ".publicar.json"), "utf8")).columnas.Registros.includes("turnado_usuario"), "guarda las columnas publicadas");
});

test("publicar: sin mensaje, sin ID o con pruebas fallando no sube nada", { skip: saltar }, () => {
  const p = proyecto();
  let r = publicar(p, []);
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /Falta el mensaje/);
  assert.equal(r.clasp.length, 0);

  const sinId = proyecto({ conId: false });
  r = publicar(sinId, ["cambio"]);
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /Falta el ID de la implementación/);
  assert.match(r.salida, /servidor:implementaciones/);
  assert.match(r.salida, /@HEAD/, "muestra la lista para que copie el ID");
  assert.deepEqual(r.clasp, [["list-deployments"]], "solo consultó; no subió nada");

  const fallan = proyecto({ prueba: "node -e process.exit(1)" });
  r = publicar(fallan, ["cambio"]);
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /Las pruebas fallaron\. No se publicó nada/);
  assert.equal(r.clasp.length, 0);
});

test("publicar: versiones distintas o clasp push con error detienen todo", { skip: saltar }, () => {
  const p = proyecto();
  const app = path.join(p.dir, "apps-script", "App.html");
  fs.writeFileSync(app, fs.readFileSync(app, "utf8").replace(/var VERSION_APP = '[^']+'/, "var VERSION_APP = '9.9.9'"));
  let r = publicar(p, ["cambio"]);
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /No coinciden: Servidor\.gs dice [\d.]+ y App\.html dice 9\.9\.9/);
  assert.equal(r.clasp.length, 0);

  const q = proyecto();
  r = publicar(q, ["cambio"], { CLASP_FALLA: "push" });
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /clasp push falló\. La app publicada sigue igual/);
  assert.match(r.salida, /clasp login/);
  assert.deepEqual(r.clasp, [["push", "--force"]], "no publicó la implementación");
  assert.equal(g(q.remoto, ["log", "-1", "--format=%s", "main"]).trim(), "inicio", "no subió a GitHub");
});

test("publicar: si hay columnas nuevas pide correr instalar() antes de publicar", { skip: saltar }, () => {
  const p = proyecto();
  const cfg = JSON.parse(fs.readFileSync(path.join(p.dir, ".publicar.json"), "utf8"));
  cfg.columnas = { Registros: ["id"], Directorio: [], Usuarios: [], Bitacora: [], Config: [] };   // «lo publicado» no tenía las demás
  fs.writeFileSync(path.join(p.dir, ".publicar.json"), JSON.stringify(cfg));
  let r = publicar(p, ["columnas nuevas"]);
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /agrega columnas a la hoja: .*Registros\.turnado_usuario/);
  assert.match(r.salida, /falta correr instalar\(\)/);
  assert.deepEqual(r.clasp, [["push", "--force"]], "subió el código pero NO publicó la implementación");
  r = publicar(p, ["columnas nuevas", "--ya-corri-instalar"]);
  assert.equal(r.codigo, 0, r.salida);
  assert.deepEqual(r.clasp.at(-1), ["update-deployment", ID, "-d", "columnas nuevas"]);
  // la siguiente vez ya no pregunta
  r = publicar(p, ["otro cambio"]);
  assert.equal(r.codigo, 0, r.salida);
  assert.doesNotMatch(r.salida, /agrega columnas/);
});

test("publicar: se detiene si git iba a subir datos reales", { skip: saltar }, () => {
  const p = proyecto();
  fs.writeFileSync(path.join(p.dir, ".gitignore"), "dist/\n");   // alguien borró las reglas
  let r = publicar(p, ["cambio"]);
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /A \.gitignore le faltan reglas/);
  assert.equal(r.clasp.length, 0, "se revisa ANTES de subir nada");
  // y si ya se habían subido antes
  const q = proyecto();
  g(q.dir, ["add", "-f", "base/base.json"]);
  g(q.dir, ["commit", "-q", "-m", "ups"]);
  r = publicar(q, ["cambio"]);
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /YA están en git/);
  assert.match(r.salida, /git rm -r --cached base\//);
  assert.equal(r.clasp.length, 0);
});

test("publicar: solo sube código y documentación (un escaneo, una foto o un .json nuevos lo detienen)", { skip: saltar }, () => {
  for (const [ruta, motivo] of [["oficio-escaneado.pdf", /archivo de datos \(pdf\)/], ["apps-script/foto.jpg", /archivo de datos \(jpg\)/],
    ["exportacion.json", /archivo de datos \(json\)/], ["notas/pendientes.md", /no es código ni documentación/], ["Respaldo.ods", /archivo de datos \(ods\)/]]) {
    const p = proyecto();
    fs.mkdirSync(path.dirname(path.join(p.dir, ruta)), { recursive: true });
    fs.writeFileSync(path.join(p.dir, ruta), "x");
    const r = publicar(p, ["cambio"]);
    assert.equal(r.codigo, 1, ruta + "\n" + r.salida);
    assert.match(r.salida, /git iba a subir archivos que no son código/);
    assert.match(r.salida, motivo, ruta);
    assert.equal(r.clasp.length, 0, ruta + ": se revisa ANTES de subir nada");
  }
  // los íconos de la app y la documentación sí pasan
  const q = proyecto();
  fs.mkdirSync(path.join(q.dir, "web"));
  fs.writeFileSync(path.join(q.dir, "web", "icono-32.png"), "x");
  fs.writeFileSync(path.join(q.dir, "CAMBIOS.md"), "# Cambios\n");
  const r = publicar(q, ["íconos y documentación"]);
  assert.equal(r.codigo, 0, r.salida);
  assert.match(g(q.remoto, ["ls-tree", "-r", "--name-only", "main"]), /web\/icono-32\.png/);
});
