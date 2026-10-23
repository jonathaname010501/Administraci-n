// Pruebas de la 1.7.0: concurrencia, acceso, contraseñas, dos pasos, caché,
// bitácora, lote, días inhábiles, avisos, respaldos y plantilla del oficio.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test, assert, crearEntorno, preparar, alta, entrar, nuevoOficio, testBase, PDF } = require("./comun.cjs");

/* ── Ayudas ───────────────────────────────────────────────────────── */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function deBase32(s) {
  s = s.replace(/\s+/g, "").toUpperCase();
  let bits = 0, valor = 0; const out = [];
  for (const ch of s) { valor = (valor << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secreto, ms, paso = 0) {
  const t = Math.floor(ms / 30000) + paso, msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(t / 2 ** 32), 0); msg.writeUInt32BE(t >>> 0, 4);
  const h = crypto.createHmac("sha1", Buffer.isBuffer(secreto) ? secreto : deBase32(secreto)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  return String(((h[off] & 127) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 1e6).padStart(6, "0");
}
const ahora = (e) => Date.now() + e.reloj.offset;
const fila = (e, hoja, col, valor) => {
  const h = e.hoja(hoja), cab = h.datos[0];
  return h.datos.find((f, i) => i > 0 && f && f[cab.indexOf(col)] === valor);
};
const celda = (e, hoja, usuario, col) => { const h = e.hoja(hoja), cab = h.datos[0]; return fila(e, hoja, "usuario", usuario)[cab.indexOf(col)]; };
const ponerCelda = (e, hoja, usuario, col, v) => { const h = e.hoja(hoja), cab = h.datos[0]; fila(e, hoja, "usuario", usuario)[cab.indexOf(col)] = v; };
const bitacora = (e) => { const h = e.hoja("Bitacora"); return h.datos.slice(1).filter(Boolean).map((f) => ({ fecha: f[0], usuario: f[1], accion: f[2], id: f[3], detalle: f[4] })); };

/** Que nada escriba en la Bitácora sin el candado (si no, dos peticiones pisan el mismo renglón). */
function vigilarBitacora(e) {
  const h = e.hoja("Bitacora"), sinCandado = [];
  const real = h.getRange.bind(h);
  h.getRange = (...a) => { const r = real(...a); const sv = r.setValues.bind(r); r.setValues = (v) => { if (!e.candado.tomado) sinCandado.push(v[0]); return sv(v); }; return r; };
  return sinCandado;
}

/* ── 1 · Concurrencia ─────────────────────────────────────────────── */

test("bitácora: TODO se escribe con el candado (entrar, salir, descargar, exportar, respaldo, informes, cambiar contraseña)", () => {
  const e = preparar({ conBase: false });
  const sin = vigilarBitacora(e);
  const t = alta(e, "beto", "captura", "*", { informes: true });
  const r = e.api(t, "guardar", nuevoOficio()).datos.registro;
  e.api(t, "subirArchivo", { id: r.id, clase: "oficio", nombre: "a.pdf", mime: "application/pdf", base64: PDF });
  e.api(t, "descargarArchivo", { id: r.id, clase: "oficio" });
  e.api(e.admin, "exportar", { tipo: "TODOS" });
  e.api(e.admin, "respaldo");
  e.api(t, "informes", { desde: "2026-01-01", hasta: "2026-12-31", excel: true });
  e.api(null, "entrar", { usuario: "beto", clave: "mala" });
  const t2 = entrar(e, "beto");
  e.api(t2, "cambiarClave", { actual: "Ahuehuete2026x", nueva: "Colibri-Azul-77" });
  e.api(e.admin, "salir");
  assert.deepEqual(sin, [], "renglones escritos sin candado: " + JSON.stringify(sin));
  assert.equal(e.candado.tomado, false);
});

test("bitácora: si el candado está ocupado más de 15 s, se usa appendRow y no se pierde nada", () => {
  const e = preparar({ conBase: false });
  const antes = bitacora(e).length;
  e.candado.ocupadoPorOtro = true;
  e.ctx.nuevaPeticion_();
  e.ctx.bitacora_("prueba", "nota", "", "uno");
  e.ctx.bitacora_("prueba", "nota", "", "dos");
  e.candado.ocupadoPorOtro = false;
  const b = bitacora(e);
  assert.equal(b.length, antes + 2);
  assert.deepEqual(b.slice(-2).map((x) => x.detalle), ["uno", "dos"]);
  assert.match(b[b.length - 1].fecha, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "la fecha sigue como texto");
});

test("entrar NO deshace un cambio del administrador hecho mientras se revisaba la contraseña", () => {
  const e = preparar({ conBase: false });
  alta(e, "ana.paz", "captura", "*");
  // Justo mientras se calcula el PBKDF2 de la entrada, un administrador desactiva la cuenta
  let hecho = false;
  e.simular.hmac = () => { if (!hecho) { hecho = true; ponerCelda(e, "Usuarios", "ana.paz", "activo", "NO"); ponerCelda(e, "Usuarios", "ana.paz", "sello", "sello-nuevo-del-admin"); } };
  const r = e.api(null, "entrar", { usuario: "ana.paz", clave: "Ahuehuete2026x" });
  e.simular.hmac = null;
  assert.equal(r.codigo, "INACTIVO", "se volvió a leer la fila dentro del candado");
  assert.equal(celda(e, "Usuarios", "ana.paz", "activo"), "NO", "no se revirtió la desactivación");
  assert.equal(celda(e, "Usuarios", "ana.paz", "sello"), "sello-nuevo-del-admin");
});

test("varios destinatarios: la pestaña Config se lee una vez por petición (antes, una por oficio)", () => {
  const e = preparar({ conBase: false });
  const dest = [];
  for (let i = 0; i < 60; i++) dest.push({ dirigido_id: "", dirigido_a: "Persona número " + i });
  const base = { tipo: "OFS", asunto: "Prueba", fecha: "2026-10-21", firma: "Lic. X", elaboro: "VJ", acuse: "NO", destinatarios: dest };
  const cfg = e.hoja("Config");
  cfg.lecturas = 0;
  const p = e.api(e.admin, "guardarVarios", { ...base, previa: true });
  assert.equal(p.ok, true);
  assert.ok(cfg.lecturas <= 2, "vista previa: " + cfg.lecturas + " lecturas de Config");
  cfg.lecturas = 0;
  const g = e.api(e.admin, "guardarVarios", { ...base, desde: p.datos.consecutivoDesde });
  assert.equal(g.ok, true);
  assert.ok(cfg.lecturas <= 3, "guardar: " + cfg.lecturas + " lecturas de Config");
});

test("subir archivo: Drive trabaja SIN el candado; si el registro se cancela mientras sube, el archivo nuevo va a la papelera", () => {
  const e = preparar({ conBase: false });
  const r = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  const carpeta = e.ctx.carpetaArchivos_();
  const real = e.ctx.DriveApp.getFolderById;
  let conCandado = null;
  e.ctx.DriveApp.getFolderById = (id) => { const c = real(id); const cf = c.createFile; c.createFile = (b) => { conCandado = e.candado.tomado; return cf(b); }; return c; };
  assert.equal(e.api(e.admin, "subirArchivo", { id: r.id, clase: "oficio", nombre: "a.pdf", mime: "application/pdf", base64: PDF }).ok, true);
  assert.equal(conCandado, false, "createFile sin el candado");
  // Ahora lo cancelan justo mientras se sube
  e.ctx.DriveApp.getFolderById = (id) => { const c = real(id); const cf = c.createFile; c.createFile = (b) => { const x = cf(b); const v = e.api(e.admin, "obtener", { id: r.id }).datos.registro.version; e.ctx.cancelar_({ usuario: "admin", rol: "admin", tipos: ["OFS"] }, { id: r.id, version: v, motivo: "cancelado en medio" }); return x; }; return c; };
  const s = e.api(e.admin, "subirArchivo", { id: r.id, clase: "acuse", nombre: "b.pdf", mime: "application/pdf", base64: PDF });
  e.ctx.DriveApp.getFolderById = real;
  assert.equal(s.codigo, "DATOS");
  const vivos = [...e.drive.archivos.values()].filter((a) => a.padres.has(carpeta.getId()) && !a.papelera);
  assert.equal(vivos.length, 1, "solo queda el primer archivo; el de la subida fallida está en la papelera");
});

/* ── 2 · Acceso ───────────────────────────────────────────────────── */

test("freno general: solo cuentan las FALLAS; quien entra bien no se queda fuera, y un equipo de confianza pasa aunque haya ataque", () => {
  const e = preparar({ conBase: false });
  // 70 entradas buenas en el mismo minuto: ninguna se frena
  for (let i = 0; i < 70; i++) assert.equal(e.api(null, "entrar", { usuario: "admin", clave: "Jacaranda2026x" }).ok, true, "entrada " + i);
  // un equipo de confianza (al entrar con «recordar»)
  const conf = e.api(null, "entrar", { usuario: "admin", clave: "Jacaranda2026x", recordar: true }).datos.equipo;
  assert.match(conf, /^[A-Za-z0-9_-]+=*\.[A-Za-z0-9_-]+$/);
  // alguien manda 30 intentos fallidos con usuarios inventados
  for (let i = 0; i < 30; i++) e.api(null, "entrar", { usuario: "x" + i, clave: "mala" });
  assert.equal(e.api(null, "entrar", { usuario: "admin", clave: "Jacaranda2026x" }).codigo, "ESPERA", "sin equipo de confianza, espera un minuto");
  assert.equal(e.api(null, "entrar", { usuario: "admin", clave: "Jacaranda2026x", equipo: conf }).ok, true, "con equipo de confianza entra");
  e.reloj.offset += 61 * 1000;
  assert.equal(e.api(null, "entrar", { usuario: "admin", clave: "Jacaranda2026x" }).ok, true, "al minuto siguiente, todos");
});

test("bloqueo de la cuenta: 15 min, luego 1 h; el equipo de confianza de esa persona no se queda fuera", () => {
  const e = preparar({ conBase: false });
  alta(e, "eva.luna", "captura", "*");
  const conf = e.api(null, "entrar", { usuario: "eva.luna", clave: "Ahuehuete2026x", recordar: true }).datos.equipo;
  const fallar = () => { for (let i = 0; i < 5; i++) e.api(null, "entrar", { usuario: "eva.luna", clave: "mala" }); };
  fallar();
  let r = e.api(null, "entrar", { usuario: "eva.luna", clave: "Ahuehuete2026x" });
  assert.equal(r.codigo, "BLOQUEADO");
  assert.match(r.error, /1[45] min/);
  assert.equal(e.api(null, "entrar", { usuario: "eva.luna", clave: "Ahuehuete2026x", equipo: conf }).ok, true, "desde su equipo sí entra");
  e.reloj.offset += 16 * 60 * 1000;
  fallar();
  r = e.api(null, "entrar", { usuario: "eva.luna", clave: "Ahuehuete2026x" });
  assert.equal(r.codigo, "BLOQUEADO");
  assert.match(r.error, /(59|60) min/, "el segundo bloqueo dura más: " + r.error);
  assert.ok(bitacora(e).some((b) => b.accion === "bloqueo" && /60 min/.test(b.detalle)));
});

test("equipo de confianza: no sirve con otra firma, para otra persona, vencido o tras muchas fallas", () => {
  const e = preparar({ conBase: false });
  alta(e, "eva.luna", "captura", "*");
  const conf = e.api(null, "entrar", { usuario: "eva.luna", clave: "Ahuehuete2026x", recordar: true }).datos.equipo;
  const ctx = e.ctx;
  ctx.nuevaPeticion_();
  assert.equal(ctx.equipoValido_(conf, "eva.luna"), true);
  assert.equal(ctx.equipoValido_(conf, "admin"), false, "es de otra persona");
  assert.equal(ctx.equipoValido_(conf.slice(0, -2) + "xx", "eva.luna"), false, "firma alterada");
  const [cuerpo] = conf.split(".");
  const falso = Buffer.from("eva.luna|" + (Date.now() + 9e9).toString(36)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_") + "." + conf.split(".")[1];
  assert.equal(ctx.equipoValido_(falso, "eva.luna"), false, "cambiar el vencimiento rompe la firma");
  assert.ok(cuerpo);
  for (let i = 0; i < 10; i++) e.api(null, "entrar", { usuario: "eva.luna", clave: "mala", equipo: conf });
  ctx.nuevaPeticion_();
  assert.equal(ctx.equipoValido_(conf, "eva.luna"), false, "con 10 fallas desde ese equipo deja de contar");
  e.reloj.offset += 181 * 86400 * 1000;
  e.cacheMap.clear();
  ctx.nuevaPeticion_();
  assert.equal(ctx.equipoValido_(conf, "eva.luna"), false, "vencido a los 180 días");
});

test("reglas de contraseña: 10+, sin usuario ni nombre, sin palabras obvias; igual en la página y en el servidor", () => {
  const e = crearEntorno();
  const p = (c, u = "ana.perez", n = "Ana Pérez Luna") => e.ctx.problemaClave_(c, u, n);
  assert.match(p("Corta123"), /10 caracteres/);
  assert.match(p("SoloLetrasAqui"), /letras y números/);
  assert.match(p("ana.perez2026x"), /usuario/);
  assert.match(p("PEREZ-2026-xyz"), /usuario/, "ni parte del usuario");
  assert.match(p("Luna2026Llena!"), /nombre/);
  for (const mala of ["Gestion2026!", "Minutario2026x", "CDMX-2026-abc", "Qwerty12345", "Octubre20261", "aaaaaaaa11", "Abcdefg123", "Contraseña2026", "Oficios2026x"]) {
    assert.match(String(p(mala)), /fácil de adivinar/, mala);
  }
  for (const buena of ["Jacaranda2026x", "Colibri-Azul-77", "mi perro Bruno 2019", "Tejocote2026x"]) assert.equal(p(buena), null, buena);
  // la página usa las mismas listas
  const fs = require("node:fs"), path = require("node:path");
  const pagina = fs.readFileSync(path.join(__dirname, "..", "apps-script", "AppEntrada.html"), "utf8");
  const lista = (src, nombre) => JSON.parse(src.match(new RegExp("var " + nombre + " = (\\[[\\s\\S]*?\\]);"))[1].replace(/'/g, '"'));
  const srv = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Seguridad.gs"), "utf8");
  assert.deepEqual(lista(pagina, "CLAVE_CONTIENE"), lista(srv, "CLAVE_CONTIENE"));
  assert.deepEqual(lista(pagina, "CLAVE_EXACTAS"), lista(srv, "CLAVE_EXACTAS"));
  assert.match(pagina, /var MIN_CLAVE = 10;/);
});

test("contraseña vieja: se vuelve a cifrar sola al entrar; si no cumple las reglas nuevas, pide cambiarla", () => {
  const e = preparar({ conBase: false });
  alta(e, "luis.ramos", "captura", "*");
  // Como quedó en la 1.6.0: formato sin pimienta, 1000 repeticiones y una contraseña de 8
  const sal = Buffer.from("abcdefghijklmnop");
  ponerCelda(e, "Usuarios", "luis.ramos", "clave", "pbkdf2$1000$" + sal.toString("base64") + "$" + crypto.pbkdf2Sync("Ofic2026", sal, 1000, 32, "sha256").toString("base64"));
  e.props.set("ITERACIONES_CLAVE", "1500");
  const r = e.api(null, "entrar", { usuario: "luis.ramos", clave: "Ofic2026" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.datos.debe_cambiar, true);
  assert.equal(r.datos.motivo, "reglas");
  assert.match(celda(e, "Usuarios", "luis.ramos", "clave"), /^pbkdf2p\$1500\$/, "quedó con pimienta y las repeticiones nuevas");
  assert.equal(e.api(r.datos.token, "inicio").codigo, "CAMBIAR_CLAVE");
  assert.equal(e.api(r.datos.token, "cambiarClave", { actual: "Ofic2026", nueva: "Gestion2026!" }).codigo, "DATOS");
  assert.equal(e.api(r.datos.token, "cambiarClave", { actual: "Ofic2026", nueva: "Tamarindo-48-sur" }).ok, true);
});

test("calibración: las repeticiones salen de medir este servidor y quedan entre 1,000 y 60,000", () => {
  const e = crearEntorno({ iteraciones: 0 });
  e.reloj.fijo = Date.now();                             // sin el ruido del tiempo real de esta máquina
  e.simular.hmac = () => { e.reloj.offset += 0.05; };   // cada HMAC «tarda» 0.05 ms
  e.ctx.nuevaPeticion_();
  const c = e.ctx.calibrarClaves_();
  e.simular.hmac = null; e.reloj.fijo = null;
  assert.equal(c.nuevo, true);
  assert.equal(c.repeticiones, 7000);   // 350 ms / 0.05 ms por repetición
  assert.equal(e.props.get("ITERACIONES_CLAVE"), String(c.repeticiones));
  assert.equal(e.ctx.calibrarClaves_().nuevo, false, "no recalibra si ya hay valor");
});

test("contraseña temporal: 12 caracteres, cumple las reglas", () => {
  const e = crearEntorno();
  for (let i = 0; i < 30; i++) {
    const t = e.ctx.claveTemporal_();
    assert.equal(t.length, 12);
    assert.equal(e.ctx.problemaClave_(t, "x.y", "Equis"), null, t);
  }
});

/* ── 2b · Verificación en dos pasos ───────────────────────────────── */

test("dos pasos: código RFC 6238 correcto (vector de prueba)", () => {
  const e = crearEntorno();
  const secreto = [...Buffer.from("12345678901234567890")];
  // RFC 6238, T = 59 s → 94287082 (8 dígitos) → 287082
  assert.equal(e.ctx.totpCodigo_(secreto, Math.floor(59 / 30)), "287082");
  assert.equal(e.ctx.totpCodigo_(secreto, Math.floor(1111111109 / 30)), "081804");
  assert.equal(e.ctx.base32_([...Buffer.from("foobar")]), "MZXW6YTBOI");
});

test("dos pasos: activar, entrar con código, no reusar el código, fallas cuentan, quitar", () => {
  const e = preparar({ conBase: false });
  const t = alta(e, "rosa.rios", "captura", "*");
  const ini = e.api(t, "totpIniciar").datos;
  assert.match(ini.uri, /^otpauth:\/\/totp\/Control%20de%20Gesti%C3%B3n%3Arosa\.rios\?secret=[A-Z2-7]+&issuer=/);
  assert.equal(e.api(t, "totpConfirmar", { clave: "mala", codigo: totp(ini.secreto, ahora(e)) }).codigo, "CREDENCIALES");
  assert.equal(e.api(t, "totpConfirmar", { clave: "Ahuehuete2026x", codigo: "000000" }).codigo, "CODIGO");
  const ok = e.api(t, "totpConfirmar", { clave: "Ahuehuete2026x", codigo: totp(ini.secreto, ahora(e)) });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(e.api(t, "inicio").codigo, "SESION", "las demás sesiones se cierran");
  assert.equal(e.api(ok.datos.token, "inicio").ok, true, "la de quien la activó sigue");
  const guardado = celda(e, "Usuarios", "rosa.rios", "totp");
  assert.match(guardado, /^v1\$/);
  assert.ok(!guardado.includes(ini.secreto.replace(/\s/g, "")), "el secreto no queda en claro en la hoja");
  assert.ok(!JSON.stringify(e.api(e.admin, "respaldo").datos.hojas.Usuarios).includes("v1$"), "ni en el respaldo en Excel");
  // Entrar: primero la contraseña, luego el código
  e.reloj.offset += 31 * 1000;
  const p1 = e.api(null, "entrar", { usuario: "rosa.rios", clave: "Ahuehuete2026x" }).datos;
  assert.equal(p1.requiereCodigo, true);
  assert.equal(p1.token, undefined, "sin código no hay sesión");
  assert.equal(e.api(null, "entrarCodigo", { ticket: p1.ticket, codigo: "123456" }).codigo, "CODIGO");
  const p2 = e.api(null, "entrarCodigo", { ticket: p1.ticket, codigo: totp(ini.secreto, ahora(e)) });
  assert.equal(p2.ok, true, JSON.stringify(p2));
  assert.ok(p2.datos.token && p2.datos.inicio);
  assert.equal(e.api(null, "entrarCodigo", { ticket: p1.ticket, codigo: totp(ini.secreto, ahora(e)) }).codigo, "CODIGO_VENCIDO", "el boleto es de un solo uso");
  const p3 = e.api(null, "entrar", { usuario: "rosa.rios", clave: "Ahuehuete2026x" }).datos;
  assert.equal(e.api(null, "entrarCodigo", { ticket: p3.ticket, codigo: totp(ini.secreto, ahora(e)) }).codigo, "CODIGO", "el mismo código no se usa dos veces");
  // 5 códigos malos bloquean la cuenta
  for (let i = 0; i < 4; i++) e.api(null, "entrarCodigo", { ticket: p3.ticket, codigo: "111111" });
  const p4 = e.api(null, "entrar", { usuario: "rosa.rios", clave: "Ahuehuete2026x" });
  assert.equal(p4.codigo, "BLOQUEADO", "la contraseña bien + 5 códigos mal = bloqueo");
  // el administrador se la quita (perdió el teléfono)
  e.api(e.admin, "guardarUsuario", { usuario: "rosa.rios", nombre: "Persona rosa.rios", rol: "captura", tipos: "*", desbloquear: true, quitar2fa: true });
  const p5 = e.api(null, "entrar", { usuario: "rosa.rios", clave: "Ahuehuete2026x" });
  assert.equal(p5.ok, true);
  assert.ok(p5.datos.token, "ya entra solo con contraseña");
  assert.ok(bitacora(e).some((b) => /quitó la verificación en dos pasos/.test(b.detalle)));
});

test("dos pasos obligatoria para administradores (Configuración): quien no la tiene solo puede activarla", () => {
  const e = preparar({ conBase: false });
  assert.equal(e.api(e.admin, "guardarConfig", { dos_pasos_admin: "SI" }).codigo, "DATOS", "primero la propia");
  const ini = e.api(e.admin, "totpIniciar").datos;
  const ok = e.api(e.admin, "totpConfirmar", { clave: "Jacaranda2026x", codigo: totp(ini.secreto, ahora(e)) }).datos;
  e.admin = ok.token;
  assert.equal(e.api(e.admin, "guardarConfig", { dos_pasos_admin: "SI" }).ok, true);
  const r = e.api(e.admin, "guardarUsuario", { nuevo: true, usuario: "otro.admin", nombre: "Otro Admin", rol: "admin" });
  const t1 = e.api(null, "entrar", { usuario: "otro.admin", clave: r.datos.temporal }).datos.token;
  const t2 = e.api(t1, "cambiarClave", { actual: r.datos.temporal, nueva: "Guanabana-2026" }).datos.token;
  assert.equal(e.api(t2, "inicio").codigo, "ACTIVAR_2FA");
  assert.equal(e.api(t2, "usuarios").codigo, "ACTIVAR_2FA");
  const ent = e.api(null, "entrar", { usuario: "otro.admin", clave: "Guanabana-2026" }).datos;
  assert.equal(ent.activar2fa, true);
  assert.equal(ent.inicio, undefined);
  const s = e.api(ent.token, "totpIniciar").datos;
  const c = e.api(ent.token, "totpConfirmar", { clave: "Guanabana-2026", codigo: totp(s.secreto, ahora(e)) }).datos;
  assert.equal(e.api(c.token, "inicio").ok, true);
});

test("restablecerAdministrador (dueño) también quita la verificación en dos pasos", () => {
  const e = preparar({ conBase: false });
  const ini = e.api(e.admin, "totpIniciar").datos;
  e.api(e.admin, "totpConfirmar", { clave: "Jacaranda2026x", codigo: totp(ini.secreto, ahora(e)) });
  assert.match(celda(e, "Usuarios", "admin", "totp"), /^v1\$/);
  const msg = e.comoDueno("restablecerAdministrador");
  e.comoAnonimo();
  assert.equal(celda(e, "Usuarios", "admin", "totp"), "");
  const temporal = msg.match(/Contraseña temporal: (\S+)/)[1];
  assert.ok(e.api(null, "entrar", { usuario: "admin", clave: temporal }).datos.token);
});

test("mi cuenta: correo para avisos", () => {
  const e = preparar({ conBase: false });
  const t = alta(e, "beto", "captura", "*");
  assert.equal(e.api(t, "miCuenta", { correo: "no es correo" }).codigo, "DATOS");
  assert.equal(e.api(t, "miCuenta", { correo: "Beto@Ejemplo.MX " }).datos.correo, "beto@ejemplo.mx");
  assert.equal(e.api(t, "miCuenta", {}).datos.correo, "beto@ejemplo.mx");
  assert.equal(celda(e, "Usuarios", "beto", "correo"), "beto@ejemplo.mx");
  assert.equal(e.api(e.admin, "usuarios").datos.find((u) => u.usuario === "beto").correo, "beto@ejemplo.mx");
});

/* ── 3 · Caché de Registros ───────────────────────────────────────── */

test("caché: la segunda lectura no lee la hoja; después de guardar se ve lo nuevo al instante", () => {
  const e = preparar({ conBase: false });
  for (let i = 0; i < 30; i++) e.api(e.admin, "guardar", nuevoOficio({ asunto: "Asunto " + i }));
  e.api(e.admin, "listar", { tipo: "OFS" });   // llena la caché
  const reg = e.hoja("Registros");
  const antes = reg.lecturas;
  e.medir();
  const l1 = e.api(e.admin, "listar", { tipo: "OFS" }).datos;
  const m = e.medir();
  assert.equal(l1.length, 30);
  assert.equal(reg.lecturas - antes, 1, "de Registros solo se leyó el renglón de títulos");
  assert.ok(m.celdas < 300, m.celdas + " celdas");
  const n = e.api(e.admin, "guardar", nuevoOficio({ asunto: "El nuevo" })).datos.registro;
  const l2 = e.api(e.admin, "listar", { tipo: "OFS" }).datos;
  assert.equal(l2.length, 31);
  assert.equal(l2[0].id, n.id);
  // editar también se ve al instante
  e.api(e.admin, "guardar", { ...nuevoOficio({ asunto: "Editado" }), id: n.id, version: n.version });
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS" }).datos[0].asunto, "Editado");
  assert.ok(reg);
});

test("caché: si se pierde un pedazo o la versión, se lee la hoja y todo sigue igual; se puede apagar", () => {
  const e = preparar({ conBase: false });
  for (let i = 0; i < 10; i++) e.api(e.admin, "guardar", nuevoOficio({ asunto: "A" + i }));
  e.api(e.admin, "listar", { tipo: "OFS" });
  for (const k of [...e.cacheMap.keys()]) if (/^reg:[^v].*:0$/.test(k)) e.cacheMap.delete(k);
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS" }).datos.length, 10);
  e.cacheMap.delete("reg:v");
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS" }).datos.length, 10);
  e.props.set("CACHE_REGISTROS", "NO");
  e.medir();
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS" }).datos.length, 10);
  assert.ok(e.medir().celdas > 300, "apagada: lee la hoja");
});

test("caché: columnas movidas a mano se detectan aunque haya copia en caché", () => {
  const e = preparar({ conBase: false });
  e.api(e.admin, "guardar", nuevoOficio());
  e.api(e.admin, "listar", { tipo: "OFS" });
  const h = e.hoja("Registros");
  [h.datos[0][6], h.datos[0][7]] = [h.datos[0][7], h.datos[0][6]];
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS" }).codigo, "INSTALACION");
});

test("caché: una copia guardada con una versión vieja nunca se usa después de escribir", () => {
  const e = preparar({ conBase: false });
  e.api(e.admin, "guardar", nuevoOficio({ asunto: "uno" }));
  e.api(e.admin, "listar", { tipo: "OFS" });
  const v1 = e.cacheMap.get("reg:v").v;
  e.api(e.admin, "guardar", nuevoOficio({ asunto: "dos" }));
  const v2 = e.cacheMap.get("reg:v").v;
  assert.notEqual(v1, v2, "escribir cambia la versión");
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS" }).datos.length, 2);
});

/* ── 4 · Bitácora grande y fecha de atención ──────────────────────── */

test("bitácora del administrador: lee desde el final; con «desde» va más atrás", () => {
  const e = preparar({ conBase: false });
  const bit = e.hoja("Bitacora");
  bit.maxRows = 32000;
  for (let i = 0; i < 30000; i++) {
    const f = bit.getLastRow() + 1;
    bit.datos[f - 1] = [i < 15000 ? "2025-01-10 10:00:00" : "2026-03-01 10:00:00", "u" + (i % 3), "entrar", "", "n" + i];
    bit.formatos[f - 1] = ["@", "@", "@", "@", "@"];
  }
  e.medir();
  const r = e.api(e.admin, "bitacora", {}).datos;
  assert.ok(e.medir().celdas < 120000, "no leyó las 30,000");
  assert.equal(r.filas.length, 500);
  assert.equal(r.parcial, true);
  assert.ok(r.revisados >= 20000 && r.revisados < 23000);
  assert.equal(r.filas[0].detalle, "n29999", "lo más reciente (el último renglón) primero");
  const viejo = e.api(e.admin, "bitacora", { desde: "2025-01-01", hasta: "2025-12-31" }).datos;
  assert.equal(viejo.total, 15000);
  assert.equal(viejo.parcial, false);
});

test("instalar() toma de la Bitácora la fecha de atención de lo atendido antes de la 1.5.0", () => {
  const e = preparar({ conBase: false });
  const r = e.api(e.admin, "guardar", { tipo: "OFE", asunto: "Viejo", fecha: "2026-01-05", estatus: "Pendiente" }).datos.registro;
  const g = e.api(e.admin, "guardar", { tipo: "OFE", asunto: "Viejo", fecha: "2026-01-05", estatus: "Atendido", id: r.id, version: r.version }).datos.registro;
  assert.ok(g.fecha_atencion);
  // como si fuera de antes de la 1.5.0: sin fecha_atencion; en la Bitácora quedó el cambio de estatus
  const h = e.hoja("Registros"), cab = h.datos[0];
  h.datos.find((f) => f && f[0] === r.id)[cab.indexOf("fecha_atencion")] = "";
  const b = e.hoja("Bitacora");
  b.datos.filter((f) => f && f[3] === r.id && /Atendido/.test(f[4])).forEach((f) => { f[0] = "2026-02-03 11:00:00"; });
  const salida = e.comoDueno("instalar");
  e.comoAnonimo();
  assert.match(salida, /Fecha de atención tomada de la Bitácora: 1/);
  assert.equal(e.api(e.admin, "obtener", { id: r.id }).datos.registro.fecha_atencion, "2026-02-03");
});

/* ── 5 · Lote ─────────────────────────────────────────────────────── */

test("lote: estatus, acuse, turno y fecha límite de muchos a la vez; omite lo que no puede", () => {
  const e = preparar({ conBase: false });
  const cap = alta(e, "beto", "captura", ["OFS", "OFE"]);
  alta(e, "dora", "captura", ["OFE"]);
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(e.api(cap, "guardar", { tipo: "OFE", asunto: "E" + i, fecha: "2026-01-0" + (1 + (i % 9)) }).datos.registro.id);
  const ofs = e.api(cap, "guardar", nuevoOficio()).datos.registro;
  const cir = e.api(e.admin, "guardar", { tipo: "CIR", asunto: "Circular", fecha: "2026-01-01" }).datos.registro;
  const canc = e.api(e.admin, "guardar", { tipo: "OFE", asunto: "Cancelado", fecha: "2026-01-01" }).datos.registro;
  e.api(e.admin, "cancelar", { id: canc.id, version: canc.version, motivo: "por prueba" });
  const r = e.api(cap, "guardarLote", { ids: [...ids, cir.id, canc.id, "no-existe"], cambios: { estatus: "Concluido" } }).datos;
  assert.equal(r.cambiados, 12);
  assert.deepEqual(r.omitidos.map((x) => x.motivo).sort(), ["cancelado", "no existe", "sin acceso a Circulares"]);
  assert.equal(e.api(cap, "obtener", { id: ids[0] }).datos.registro.estatus, "Concluido");
  assert.ok(e.api(cap, "obtener", { id: ids[0] }).datos.registro.fecha_atencion, "se pone la fecha de atención");
  const bit = bitacora(e);
  assert.equal(bit.filter((b) => b.accion === "edición" && /\(en lote\)/.test(b.detalle)).length, 12);
  assert.ok(bit.some((b) => b.accion === "edición en lote" && /^12 registro/.test(b.detalle)));
  // turno: solo a quien tiene acceso; sin estatus pasa a Pendiente
  const t = e.api(cap, "guardarLote", { ids: [ids[0], ofs.id], cambios: { turnado_usuario: "dora" } }).datos;
  assert.equal(t.cambiados, 1);
  assert.match(t.omitidos[0].motivo, /no tiene acceso a Oficios salientes/);
  // acuse: solo en libretas que lo llevan; fecha límite
  assert.equal(e.api(cap, "guardarLote", { ids: [ofs.id], cambios: { acuse: "SI", fecha_limite: "2026-12-01" } }).datos.cambiados, 1);
  const o = e.api(cap, "obtener", { id: ofs.id }).datos.registro;
  assert.equal(o.acuse, "SI");
  assert.equal(o.fecha_limite, "2026-12-01");
  // repetir no cambia nada
  assert.equal(e.api(cap, "guardarLote", { ids: [ofs.id], cambios: { acuse: "SI" } }).datos.sinCambio, 1);
  // validaciones
  assert.equal(e.api(cap, "guardarLote", { ids, cambios: { estatus: "Cancelado" } }).codigo, "DATOS");
  assert.equal(e.api(cap, "guardarLote", { ids, cambios: {} }).codigo, "DATOS");
  assert.equal(e.api(cap, "guardarLote", { ids: Array.from({ length: 501 }, (_, i) => "x" + i), cambios: { acuse: "SI" } }).codigo, "DATOS");
  const con = alta(e, "carla", "consulta", "*");
  assert.equal(e.api(con, "guardarLote", { ids, cambios: { acuse: "SI" } }).codigo, "PERMISO");
  assert.equal(e.candado.tomado, false);
});

/* ── 6 · Días inhábiles y corte de «sin acuse» ────────────────────── */

test("días inhábiles: no cuentan como hábiles; Configuración los valida y ordena", () => {
  const e = preparar({ conBase: false });
  assert.equal(e.ctx.diasHabiles_("2026-03-13", "2026-03-17", []), 2, "viernes → martes = 2 hábiles");
  assert.equal(e.ctx.diasHabiles_("2026-03-13", "2026-03-17", ["2026-03-16"]), 1, "el lunes festivo no cuenta");
  assert.equal(e.api(e.admin, "guardarConfig", { dias_inhabiles: "2026-02-30" }).codigo, "DATOS");
  const c = e.api(e.admin, "guardarConfig", { dias_inhabiles: "2026-12-25\n2026-03-16, 2026-03-16 2026-01-01" }).datos;
  assert.deepEqual(c.dias_inhabiles, ["2026-01-01", "2026-03-16", "2026-12-25"]);
  assert.deepEqual(e.api(e.admin, "inicio").datos.config.dias_inhabiles, ["2026-01-01", "2026-03-16", "2026-12-25"]);
  // Informes usa los días inhábiles en el tiempo de respuesta
  const ent = e.api(e.admin, "guardar", { tipo: "OFE", asunto: "Entra", fecha: "2026-03-13", fecha_recepcion: "2026-03-13", estatus: "Pendiente" }).datos.registro;
  e.api(e.admin, "guardar", nuevoOficio({ fecha: "2026-03-17", relacionado_id: ent.id, marcarAtendido: true, dirigido_id: "", firma_id: "" }));
  const inf = e.api(e.admin, "informes", { desde: "2026-03-01", hasta: "2026-03-31", excel: true }).datos;
  assert.equal(inf.respuesta.pares[0].dias, 1);
});

test("corte de «sin acuse»: el portal y Pendientes solo cuentan desde esa fecha", () => {
  const e = preparar({ conBase: false });
  e.api(e.admin, "guardar", nuevoOficio({ fecha: "2026-01-10" }));
  e.api(e.admin, "guardar", nuevoOficio({ fecha: "2026-09-10" }));
  assert.equal(e.api(e.admin, "indicadores").datos.porTipo.OFS.sinAcuse, 2);
  assert.equal(e.api(e.admin, "guardarConfig", { acuse_desde: "2026-13-01" }).codigo, "DATOS");
  e.api(e.admin, "guardarConfig", { acuse_desde: "2026-06-01" });
  const ind = e.api(e.admin, "indicadores").datos;
  assert.equal(ind.porTipo.OFS.sinAcuse, 1);
  assert.equal(ind.acuseDesde, "2026-06-01");
  assert.equal(e.api(e.admin, "pendientes").datos.sinAcuse.length, ind.global.sinAcuse);
});

/* ── 7 · Avisos por correo ────────────────────────────────────────── */

test("avisos: al turnar llega un correo (sin el asunto, salvo que se pida); nunca a uno mismo; apagados no mandan nada", () => {
  const e = preparar({ conBase: false });
  const cap = alta(e, "beto", "captura", "*");
  alta(e, "dora", "captura", ["OFE"]);
  e.api(e.admin, "guardarUsuario", { usuario: "dora", nombre: "Dora Díaz", rol: "captura", tipos: ["OFE"], correo: "dora@ejemplo.mx" });
  e.api(cap, "guardar", { tipo: "OFE", asunto: "Secreto del asunto", fecha: "2026-10-01", turnado_usuario: "dora" });
  assert.equal(e.estado.correos.length, 0, "apagados por omisión");
  e.api(e.admin, "guardarConfig", { avisos_correo: "SI", url_web: "https://control.ejemplo.mx" });
  const r = e.api(cap, "guardar", { tipo: "OFE", asunto: "Secreto del asunto", fecha: "2026-10-01", fecha_limite: "2026-10-30", turnado_usuario: "dora" }).datos.registro;
  assert.equal(e.estado.correos.length, 1);
  const c = e.estado.correos[0];
  assert.equal(c.to, "dora@ejemplo.mx");
  assert.match(c.subject, /^Te turnaron: Oficio entrante/);
  assert.match(c.body, /límite 30\/10\/2026/);
  assert.doesNotMatch(c.body + c.htmlBody, /Secreto del asunto/, "sin el asunto por omisión");
  assert.match(c.htmlBody, /https:\/\/control\.ejemplo\.mx/);
  e.api(e.admin, "guardarConfig", { avisos_detalle: "SI" });
  e.api(cap, "guardarLote", { ids: [r.id], cambios: { turnado_usuario: "" } });
  e.api(cap, "guardarLote", { ids: [r.id], cambios: { turnado_usuario: "dora" } });
  assert.match(e.estado.correos[1].body, /Secreto del asunto/);
  e.api(e.admin, "guardarUsuario", { usuario: "beto", nombre: "Beto", rol: "captura", tipos: "*", correo: "beto@ejemplo.mx" });
  const tb = entrar(e, "beto");
  e.api(tb, "guardar", { tipo: "OFE", asunto: "Mío", fecha: "2026-10-01", turnado_usuario: "beto" });
  assert.equal(e.estado.correos.length, 2, "no se avisa a quien se turna a sí mismo");
  assert.equal(e.candado.tomado, false);
});

test("avisos: resumen diario solo con su disparador, una vez al día y en día hábil", () => {
  const e = preparar({ conBase: false });
  alta(e, "dora", "captura", ["OFE"]);
  e.api(e.admin, "guardarUsuario", { usuario: "dora", nombre: "Dora Díaz", rol: "captura", tipos: ["OFE"], correo: "dora@ejemplo.mx" });
  e.api(e.admin, "guardarConfig", { avisos_correo: "SI" });
  // que «hoy» (en la Ciudad de México) sea un miércoles
  const diaMx = (ms) => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", weekday: "short" }).format(new Date(ms))];
  e.reloj.offset += ((3 - diaMx(ahora(e)) + 7) % 7) * 86400000;
  const iso = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(ahora(e) + d * 86400000));
  e.admin = entrar(e, "admin", "Jacaranda2026x");   // con el reloj adelantado, la sesión anterior ya venció
  e.api(e.admin, "guardar", { tipo: "OFE", asunto: "Vencido", fecha: iso(-10), fecha_limite: iso(-2), estatus: "Pendiente", turnado_usuario: "dora" });
  e.api(e.admin, "guardar", { tipo: "OFE", asunto: "Pronto", fecha: iso(-1), fecha_limite: iso(1), estatus: "Pendiente", turnado_usuario: "dora" });
  e.api(e.admin, "guardar", { tipo: "OFE", asunto: "Lejos", fecha: iso(-1), fecha_limite: iso(20), estatus: "Pendiente", turnado_usuario: "dora" });
  e.estado.correos = [];
  assert.match(e.run("avisosDiarios"), /la corre su disparador/);
  assert.match(e.disparar("avisosDiarios"), /Avisos enviados: 1/);
  const c = e.estado.correos.find((x) => x.to === "dora@ejemplo.mx");
  assert.match(c.subject, /1 vencido, 1 por vencer/);
  assert.match(e.disparar("avisosDiarios"), /Ya se mandaron/);
  // sábado: nada
  e.props.delete("ULTIMO_AVISO");
  e.reloj.offset += 3 * 86400000;
  assert.match(e.disparar("avisosDiarios"), /no es día hábil/);
});

test("consulta inusual: al abrir 300 registros en un día queda alerta en la Bitácora y se avisa a los administradores", () => {
  const e = preparar({ conBase: false });
  e.api(e.admin, "guardarUsuario", { usuario: "admin", nombre: "Administrador", rol: "admin", correo: "admin@ejemplo.mx" });
  e.api(e.admin, "guardarConfig", { avisos_correo: "SI" });
  const cap = alta(e, "beto", "consulta", "*");
  const r = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  e.estado.correos = [];
  for (let i = 0; i < 300; i++) e.api(cap, "obtener", { id: r.id });
  const al = bitacora(e).filter((b) => b.accion === "alerta");
  assert.equal(al.length, 1);
  assert.match(al[0].detalle, /beto abrió 300 registros hoy/);
  assert.equal(e.estado.correos.filter((c) => c.to === "admin@ejemplo.mx").length, 1);
  for (let i = 0; i < 20; i++) e.api(cap, "obtener", { id: r.id });
  assert.equal(bitacora(e).filter((b) => b.accion === "alerta").length, 1, "una sola alerta por día");
});

/* ── 8 · Respaldos ────────────────────────────────────────────────── */

test("respaldos: copia diaria, se quedan 14 diarias + 12 semanales, espejo de escaneos y carpeta externa", () => {
  const e = preparar({ conBase: false });
  const r = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  e.api(e.admin, "subirArchivo", { id: r.id, clase: "oficio", nombre: "a.pdf", mime: "application/pdf", base64: PDF });
  const externa = e.ctx.DriveApp.createFolder("Respaldo de otra cuenta").getId();
  const h = e.hoja("Config"), cab = h.datos[0];
  h.datos.find((f) => f && f[0] === "respaldo_externo")[cab.indexOf("valor")] = externa;
  const carpeta = e.ctx.DriveApp.getFolderById(e.props.get("ID_RESPALDOS"));
  const contar = (c) => { let n = 0; const it = c.getFiles(); while (it.hasNext()) { it.next(); n++; } return n; };
  for (let dia = 0; dia < 120; dia++) {
    const out = e.disparar("respaldoDiario");
    if (dia === 0) assert.match(out, /escaneos copiados al espejo: 1/);
    e.reloj.offset += 86400000;
  }
  const n = contar(carpeta);
  assert.ok(n >= 14 + 10 && n <= 14 + 12, "quedan " + n);
  assert.equal(contar(e.ctx.DriveApp.getFolderById(externa)), n, "la externa igual");
  const espejo = carpeta.getFoldersByName("Archivos (espejo)").next();
  assert.equal(contar(espejo), 1, "el escaneo se copió una sola vez");
  assert.ok(e.ctx.DriveApp.getFolderById(externa).getFoldersByName("Archivos (espejo)").hasNext());
  // el escaneo se quita: la copia del espejo sigue
  e.api(e.admin, "quitarArchivo", { id: r.id, clase: "oficio" });
  assert.equal(contar(espejo), 1);
  // prueba de restauración
  const rev = e.comoDueno("revisarRespaldos");
  e.comoAnonimo();
  assert.match(rev, /✔ Respaldos \(misma cuenta\)/);
  assert.match(rev, /✔ Registros: 1 renglón/);
  assert.match(rev, /Los respaldos se pueden abrir y están completos/);
});

test("instalar() cambia el disparador semanal de la 1.6.0 por el diario", () => {
  const e = crearEntorno();
  e.ctx.ScriptApp.newTrigger("respaldoSemanal").timeBased().onWeekDay("MONDAY").atHour(7).create();
  const s = e.comoDueno("instalar");
  assert.match(s, /reemplaza al semanal/);
  assert.deepEqual(e.disparadores.map((d) => d.fn).sort(), ["avisosDiarios", "respaldoDiario"]);
});

/* ── 9 · Plantilla del oficio ─────────────────────────────────────── */

test("borrador del oficio: llena la plantilla, regresa .docx, borra la copia; la plantilla debe estar en su carpeta", () => {
  const e = preparar({ conBase: false });
  const plantillas = e.props.get("ID_PLANTILLAS");
  const fuera = e.crearDoc("Otro documento", "secreto {{NUMERO}}", null);
  assert.equal(e.api(e.admin, "guardarConfig", { plantilla_doc_OFS: fuera }).codigo, "DATOS", "fuera de la carpeta de plantillas: no");
  const doc = e.crearDoc("Plantilla", "Oficio {{NUMERO}} · Ciudad de México, a {{FECHA_LARGA}} · {{DESTINATARIO}} / {{CARGO_DESTINATARIO}} · {{ASUNTO}} · {{FIRMA}} ({{CARGO_FIRMA}})", plantillas);
  assert.equal(e.api(e.admin, "guardarConfig", { plantilla_doc_OFS: "https://docs.google.com/document/d/" + doc + "/edit" }).ok, true);
  assert.equal(e.api(e.admin, "inicio").datos.config.plantillaDoc, true);
  const r = e.api(e.admin, "guardar", nuevoOficio({ asunto: "Pago de $1,500 \\ apoyo", fecha: "2026-10-21" })).datos.registro;
  const g = e.api(e.admin, "generarOficio", { id: r.id });
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(g.datos.nombre, "Oficio SAPCI-STPI-001-2026.docx");
  const texto = Buffer.from(g.datos.base64, "base64").toString("utf8");
  assert.equal(texto, "DOCX:Oficio SAPCI/STPI/001/2026 · Ciudad de México, a 21 de octubre de 2026 · Mtro. Daniel Esteban Ramírez Garcén / Director General · Pago de $1,500 \\ apoyo · Lic. José Antonio Jiménez Islas (Subsecretario)");
  const temporales = [...e.drive.archivos.values()].filter((a) => a.nombre.startsWith("Oficio SAPCI"));
  assert.ok(temporales.length && temporales.every((a) => a.papelera), "la copia temporal va a la papelera");
  assert.equal(e.api(e.admin, "generarOficio", { id: e.api(e.admin, "guardar", { tipo: "OFE", asunto: "x", fecha: "2026-01-01" }).datos.registro.id }).codigo, "DATOS");
  const con = alta(e, "carla", "consulta", "*");
  assert.equal(e.api(con, "generarOficio", { id: r.id }).codigo, "PERMISO");
  assert.ok(bitacora(e).some((b) => b.accion === "oficio"));
});

/* ── 10 · Estructura ──────────────────────────────────────────────── */

test("los .gs funcionan sin importar el orden en que Google los cargue", () => {
  const e = crearEntorno({ ordenGs: "inverso" });
  const s = e.comoDueno("instalar");
  const m = s.match(/Usuario: (\S+)\s+Contraseña temporal: (\S+)/);
  e.comoAnonimo();
  assert.equal(e.api(null, "entrar", { usuario: m[1], clave: m[2] }).ok, true);
});

testBase("con la base real: la caché da exactamente lo mismo que leer la hoja", () => {
  const e = preparar();
  const directo = e.ctx.tabla_("Registros").filas;
  e.api(e.admin, "listar", { tipo: "OFS" });
  e.ctx.nuevaPeticion_();
  const t = e.ctx.tablaLectura_("Registros");
  assert.equal(t.deCache, true);
  assert.equal(JSON.stringify(t.filas), JSON.stringify(directo));
});

test("migrar_minutario.py usa las mismas columnas que Servidor.gs", () => {
  const e = crearEntorno();
  const py = fs.readFileSync(path.join(__dirname, "..", "herramientas", "migrar_minutario.py"), "utf8");
  const bloque = py.slice(py.indexOf("COLS = {"), py.indexOf("NUMERICAS"));
  for (const hoja of ["Registros", "Directorio", "Usuarios", "Bitacora", "Config"]) {
    const m = bloque.match(new RegExp('"' + hoja + '": \\[([\\s\\S]*?)\\]'));
    assert.ok(m, "falta " + hoja + " en migrar_minutario.py");
    const cols = [...m[1].replace(/#.*$/gm, "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    assert.equal(JSON.stringify(cols), JSON.stringify(Array.from(e.ctx.COLS[hoja])), hoja);
  }
});
