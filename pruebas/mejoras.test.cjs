// Pruebas de las mejoras 1.3.0 en adelante (servidor contra el simulador).
// Funcionan con y sin base/base.json: los números esperados se calculan.
const { test, assert, preparar, alta, entrar, nuevoOficio, filasDe, testBase } = require("./comun.cjs");

const ANIO = new Date().getFullYear();
const ofsDelAnio = (e) => e.api(e.admin, "listar", { tipo: "OFS", anio: ANIO }).datos;
const maxOfs = (e) => ofsDelAnio(e).reduce((m, r) => Math.max(m, Number(r.consecutivo) || 0), 0);
const num = (n) => `SAPCI/STPI/${String(n).padStart(3, "0")}/${ANIO}`;

/** Personas nuevas en el directorio (para no depender de la base real). */
function personas(e, n, prefijo = "Persona Destino") {
  return Array.from({ length: n }, (_, i) => {
    const r = e.api(e.admin, "guardarPersona", { nombre: `Lic. ${prefijo} ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)} Prueba`, cargo: "Cargo " + i, confirmar: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    const p = r.datos.persona;
    return { dirigido_id: p.id, dirigido_a: p.nombre + "\n" + p.cargo };
  });
}

/** Como la página: vista previa y luego guardar con los números confirmados («desde»). */
function confirmado(e, token, datos, api = e.api.bind(e)) {
  const prev = e.api(token, "guardarVarios", { ...datos, previa: true });
  if (!prev.ok) return prev;
  return api(token, "guardarVarios", { ...datos, desde: prev.datos.consecutivoDesde });
}

const varios = (destinatarios, extra = {}) => ({ tipo: "OFS", asunto: "Invitación a la reunión de seguimiento", fecha: `${ANIO}-10-21`,
  firma_id: "", firma: "Lic. José Antonio Jiménez Islas\nSubsecretario", elaboro: "Valentina J", destinatarios, ...extra });

/* ═══════════════════════ 1 · Varios destinatarios ═══════════════════════ */

test("varios destinatarios: números seguidos, mismos datos, un solo candado y una sola escritura", () => {
  const e = preparar();
  const ds = personas(e, 28);
  const max = maxOfs(e);
  const filas = filasDe(e, "Registros");
  const bitAntes = filasDe(e, "Bitacora");
  const prev = e.api(e.admin, "guardarVarios", { ...varios(ds), previa: true });
  assert.equal(prev.ok, true, JSON.stringify(prev));
  assert.equal(prev.datos.cuantos, 28);
  assert.equal(prev.datos.desde, num(max + 1));
  assert.equal(prev.datos.hasta, num(max + 28));
  assert.equal(filasDe(e, "Registros"), filas, "la vista previa no guarda nada");

  const vecesAntes = e.candado.veces;
  const escriturasAntes = e.hoja("Registros").lecturas;
  const r = e.api(e.admin, "guardarVarios", { ...varios(ds), desde: prev.datos.consecutivoDesde });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(e.candado.veces - vecesAntes, 1, "un solo LockService para los 28");
  assert.ok(e.hoja("Registros").lecturas - escriturasAntes <= 4, "se escriben en bloque, no fila por fila");
  assert.equal(e.candado.tomado, false);
  assert.equal(r.datos.cuantos, 28);
  assert.equal(r.datos.desde, num(max + 1));
  assert.equal(r.datos.hasta, num(max + 28));
  assert.equal(filasDe(e, "Registros"), filas + 28);
  r.datos.registros.forEach((x, i) => {
    assert.equal(x.consecutivo, max + 1 + i);
    assert.equal(x.numero, num(max + 1 + i));
    assert.equal(x.dirigido_id, ds[i].dirigido_id);
    assert.equal(x.dirigido_a, ds[i].dirigido_a);
    assert.equal(x.asunto, "Invitación a la reunión de seguimiento");
    assert.equal(x.elaboro, "Valentina J");
    assert.equal(x.fecha, `${ANIO}-10-21`);
  });
  const det = e.api(e.admin, "obtener", { id: r.datos.registros[5].id }).datos;
  assert.equal(det.registro.firma, "Lic. José Antonio Jiménez Islas\nSubsecretario");
  assert.match(det.historial[0].detalle, /varios destinatarios, 28/);
  // bitácora: una por oficio + un resumen, escritas de una vez
  const bit = e.api(e.admin, "bitacora", {}).datos;
  assert.equal(filasDe(e, "Bitacora") - bitAntes, 29);
  assert.equal(bit.filas.filter((x) => x.accion === "alta" && /varios destinatarios/.test(x.detalle)).length, 28);
  const resumen = bit.filas.find((x) => x.accion === "alta múltiple");
  assert.match(resumen.detalle, new RegExp(`28 oficios salientes .*del ${num(max + 1).replace(/\//g, "\\/")} al ${num(max + 28).replace(/\//g, "\\/")}`));
  // y el siguiente oficio normal sigue después
  assert.equal(e.api(e.admin, "guardar", nuevoOficio()).datos.registro.consecutivo, max + 29);
});

test("varios destinatarios: si alguien guarda mientras confirmas, avisa y no se enciman los números", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", ["OFS"]);
  const ds = personas(e, 5);
  const max = maxOfs(e);
  const prev = e.api(cap, "guardarVarios", { ...varios(ds), previa: true }).datos;
  // Otra persona registra un oficio en medio
  const otro = e.api(e.admin, "guardar", nuevoOficio({ asunto: "Se coló en medio" })).datos.registro;
  assert.equal(otro.consecutivo, max + 1);
  const filas = filasDe(e, "Registros");
  const r = e.api(cap, "guardarVarios", { ...varios(ds), desde: prev.consecutivoDesde });
  assert.equal(r.codigo, "CAMBIO_NUMERO", JSON.stringify(r));
  assert.match(r.error, new RegExp(`del ${num(max + 2).replace(/\//g, "\\/")} al ${num(max + 6).replace(/\//g, "\\/")}`));
  assert.equal(r.extra.consecutivoDesde, max + 2);
  assert.equal(filasDe(e, "Registros"), filas, "no guardó nada");
  // Confirmando los números nuevos, sí
  const ok = e.api(cap, "guardarVarios", { ...varios(ds), desde: r.extra.consecutivoDesde });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.datos.registros.map((x) => x.consecutivo), [2, 3, 4, 5, 6].map((k) => max + k));
  // Sin repetidos ni huecos en todo el año
  const lista = ofsDelAnio(e).filter((x) => !x.sufijo).map((x) => x.consecutivo).sort((a, b) => a - b);
  assert.equal(new Set(lista).size, lista.length, "ningún consecutivo repetido");
  assert.deepEqual(lista.slice(-6), [1, 2, 3, 4, 5, 6].map((k) => max + k), "seguidos, sin huecos");
});

test("varios destinatarios: con el candado ocupado no escribe nada; mientras guarda, nadie más toma números", () => {
  const e = preparar();
  const ds = personas(e, 4);
  const filas = filasDe(e, "Registros");
  const prev = e.api(e.admin, "guardarVarios", { ...varios(ds), previa: true }).datos;
  e.candado.tomado = true;   // otra ejecución está guardando
  const r = e.ctx.api(e.admin, "guardarVarios", { ...varios(ds), desde: prev.consecutivoDesde });
  assert.equal(r.codigo, "OCUPADO");
  assert.match(r.error, /intenta de nuevo/);
  assert.equal(filasDe(e, "Registros"), filas);
  e.candado.tomado = false;
  // A la mitad de la escritura en bloque, otra persona intenta guardar un oficio:
  // no puede tomar el candado (en Google esperaría su turno y tomaría el número siguiente).
  const original = e.ctx.escribirBloque_;
  let intento = null;
  e.ctx.escribirBloque_ = function () {
    intento = e.ctx.api(e.admin, "guardar", nuevoOficio({ asunto: "Intento simultáneo" }));
    return original.apply(this, arguments);
  };
  const ok = confirmado(e, e.admin, varios(ds));
  e.ctx.escribirBloque_ = original;
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(intento.ok, false, "el guardado simultáneo no entró mientras se escribían los 4");
  assert.equal(filasDe(e, "Registros"), filas + 4);
  const despues = e.api(e.admin, "guardar", nuevoOficio({ asunto: "Ya en su turno" })).datos.registro;
  assert.equal(despues.consecutivo, ok.datos.registros[3].consecutivo + 1);
});

test("varios destinatarios: permisos y validación en el servidor (nada se guarda si algo falla)", () => {
  const e = preparar();
  const ds = personas(e, 3);
  const con = alta(e, "carla", "consulta", ["OFS"]);
  const capOfe = alta(e, "dora", "captura", ["OFE"]);
  const filas = filasDe(e, "Registros");
  assert.equal(e.api(con, "guardarVarios", varios(ds)).codigo, "PERMISO", "consulta no captura");
  assert.equal(e.api(capOfe, "guardarVarios", varios(ds)).codigo, "PERMISO", "sin la libreta de oficios salientes");
  assert.equal(e.api(capOfe, "guardarVarios", { ...varios(ds), previa: true }).codigo, "PERMISO", "ni la vista previa");
  assert.equal(e.api(e.admin, "guardarVarios", { ...varios(ds), tipo: "OFE" }).codigo, "DATOS", "solo libretas con número automático");
  assert.equal(e.api(e.admin, "guardarVarios", varios([])).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardarVarios", { ...varios(ds), destinatarios: "x" }).codigo, "DATOS");
  const muchos = Array.from({ length: 101 }, (_, i) => ({ dirigido_id: "", dirigido_a: "Persona " + i }));
  const r101 = e.api(e.admin, "guardarVarios", varios(muchos));
  assert.equal(r101.codigo, "DATOS");
  assert.match(r101.error, /máximo por vez es 100/);
  assert.equal(e.api(e.admin, "guardarVarios", varios([ds[0], ds[1], ds[0]])).codigo, "DATOS", "la misma persona dos veces");
  assert.equal(e.api(e.admin, "guardarVarios", varios([ds[0], { dirigido_id: "", dirigido_a: "  " }])).codigo, "DATOS", "destinatario sin nombre");
  assert.equal(e.api(e.admin, "guardarVarios", varios(ds, { asunto: "" })).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardarVarios", varios(ds, { fecha: "2026-02-30" })).codigo, "DATOS");
  assert.equal(e.api(e.admin, "guardarVarios", varios(ds, { estatus: "Cancelado" })).codigo, "DATOS");
  assert.equal(filasDe(e, "Registros"), filas, "ninguno de los intentos fallidos escribió algo");
  // 100 sí se puede, aunque la hoja tenga que crecer
  e.hoja("Registros").maxRows = e.hoja("Registros").getLastRow();
  const cien = Array.from({ length: 100 }, (_, i) => ({ dirigido_id: "", dirigido_a: "Persona número " + i + "\nCargo" }));
  const ok = confirmado(e, e.admin, varios(cien, { carpeta: "007" }));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(filasDe(e, "Registros"), filas + 100);
  assert.equal(e.api(e.admin, "obtener", { id: ok.datos.registros[99].id }).datos.registro.carpeta, "007", "texto, sin perder el cero");
  // intentar colar número, consecutivo, año o relación no sirve
  const colado = confirmado(e, e.admin, varios(ds.slice(0, 1), { numero: "INVENTADO", consecutivo: 1, anio: 1999, relacionado_id: ok.datos.registros[0].id, marcarAtendido: true })).datos.registros[0];
  // sin confirmar los números (sin «desde») el servidor no guarda: la confirmación no es solo de la página
  const filas2 = filasDe(e, "Registros");
  const sinDesde = e.api(e.admin, "guardarVarios", varios(ds));
  assert.equal(sinDesde.codigo, "DATOS");
  assert.match(sinDesde.error, /confirmar los números/);
  assert.equal(e.api(e.admin, "guardarVarios", { ...varios(ds), desde: "abc" }).codigo, "DATOS");
  assert.equal(filasDe(e, "Registros"), filas2);
  assert.match(colado.numero, /^SAPCI\/STPI\/\d{3}\//);
  assert.equal(colado.anio, ANIO);
  assert.equal(colado.relacionado_id, "");
});

test("varios destinatarios: texto que parece fórmula queda como texto", () => {
  const e = preparar();
  const r = confirmado(e, e.admin, varios([{ dirigido_id: "", dirigido_a: '=HYPERLINK("http://evil.example","x")' }, { dirigido_id: "", dirigido_a: "+Normal" }],
    { asunto: "@SUM(A1)", elaboro: "-1+2" })).datos;
  const h = e.hoja("Registros");
  const ultimas = h.datos.slice(h.getLastRow() - 2, h.getLastRow());
  assert.ok(ultimas.every((f) => !f.some((v) => v && v.formula)), "ninguna celda quedó como fórmula");
  const leido = e.api(e.admin, "obtener", { id: r.registros[0].id }).datos.registro;
  assert.equal(leido.dirigido_a, '=HYPERLINK("http://evil.example","x")');
  assert.equal(leido.asunto, "@SUM(A1)");
});

/* ═══════════════════════ 2 · Mis asuntos (turnos) ═══════════════════════ */

test("columna nueva turnado_usuario: instalar() la agrega al final sin tocar los datos", () => {
  const e = preparar();
  const h = e.hoja("Registros");
  assert.equal(h.datos[0][33], "turnado_usuario");
  assert.equal(h.datos[0][32], "origen", "las columnas de antes siguen en su lugar");
});

test("si se publica el código sin correr instalar(), la app agrega sola la columna que falta", () => {
  const e = preparar();
  const h = e.hoja("Registros");
  // Como la hoja de producción antes de 1.3.0: 33 columnas exactas
  h.datos.forEach((f) => { if (f) f.length = Math.min(f.length, 33); });
  h.maxCols = 33;
  const r = e.api(e.admin, "listar", { tipo: "OFS", anio: ANIO });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(h.datos[0][33], "turnado_usuario");
  const bit = e.api(e.admin, "bitacora", { accion: "instalación" }).datos.filas;
  assert.match(bit[0].detalle, /turnado_usuario/);
  // Si alguien escribió algo a mano en columnas sin encabezado, NO se adopta como dato
  const e2 = preparar();
  const h2 = e2.hoja("Registros");
  h2.datos.forEach((f) => { if (f) f.length = Math.min(f.length, 33); });
  (h2.datos[5] || (h2.datos[1] = h2.datos[1] || []))[34] = "nota a mano";   // sin base/ (GitHub) la hoja solo trae encabezados
  const r2 = e2.api(e2.admin, "listar", { tipo: "OFS", anio: ANIO });
  assert.equal(r2.codigo, "INSTALACION");
  assert.equal(h2.datos[0][33], undefined, "no escribió encabezados");
  // Columnas movidas a mano siguen detectándose
  [h.datos[0][6], h.datos[0][7]] = [h.datos[0][7], h.datos[0][6]];
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS", anio: ANIO }).codigo, "INSTALACION");
});

test("turnar: solo a usuarios activos con acceso a la libreta; queda en la bitácora", () => {
  const e = preparar();
  const ana = alta(e, "ana", "captura", ["OFE"]);
  alta(e, "beto", "consulta", ["OFS"]);
  alta(e, "eva", "captura", ["OFE"]);
  e.api(e.admin, "guardarUsuario", { usuario: "eva", nombre: "Persona eva", rol: "captura", tipos: ["OFE"], activo: "NO" });
  const ent = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "X/1", estatus: "Pendiente", fecha_limite: "2026-01-02" }).datos.registro;
  const base = { ...ent, tipo: "OFE" };
  assert.match(e.api(e.admin, "guardar", { ...base, turnado_usuario: "beto" }).error, /no tiene acceso a Oficios entrantes/);
  assert.match(e.api(e.admin, "guardar", { ...base, turnado_usuario: "eva" }).error, /desactivada/);
  assert.match(e.api(e.admin, "guardar", { ...base, turnado_usuario: "nadie" }).error, /No existe/);
  assert.equal(e.api(e.admin, "guardar", { ...base, turnado_usuario: "Ana Pérez<script>" }).codigo, "DATOS");
  const ok = e.api(e.admin, "guardar", { ...base, turnado_usuario: "ANA" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.datos.registro.turnado_usuario, "ana", "se guarda en minúsculas");
  const det = e.api(ana, "obtener", { id: ent.id }).datos;
  assert.equal(det.registro.turnado_nombre, "Persona ana");
  assert.equal(det.historial[0].accion, "turno");
  assert.match(det.historial[0].detalle, /Turnó a ana \(Persona ana\)/);
  // el texto libre «Turnado a» sigue existiendo para áreas externas
  const ext = e.api(e.admin, "guardar", { ...base, version: ok.datos.registro.version, turnado_usuario: "ana", turnado_a: "Dirección Jurídica" }).datos.registro;
  assert.equal(ext.turnado_a, "Dirección Jurídica");
  assert.equal(ext.turnado_usuario, "ana");
  // al dar de alta ya turnado
  const nuevo = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "X/2", estatus: "Pendiente", turnado_usuario: "ana" }).datos.registro;
  assert.equal(e.api(e.admin, "obtener", { id: nuevo.id }).datos.historial.some((x) => x.accion === "turno"), true);
});

test("una página de versión anterior (sin el campo) no borra el turno; quitarlo sí queda registrado", () => {
  const e = preparar();
  alta(e, "ana", "captura", ["OFE"]);
  const ent = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "X/3", estatus: "Pendiente", turnado_usuario: "ana" }).datos.registro;
  const viejo = { ...ent };
  delete viejo.turnado_usuario;   // así guarda la página 1.2.0
  const ed = e.api(e.admin, "guardar", { ...viejo, asunto: "Cambio desde la página vieja" });
  assert.equal(ed.ok, true, JSON.stringify(ed));
  assert.equal(ed.datos.registro.turnado_usuario, "ana");
  const sin = e.api(e.admin, "guardar", { ...ed.datos.registro, turnado_usuario: "" }).datos.registro;
  assert.equal(sin.turnado_usuario, "");
  assert.match(e.api(e.admin, "obtener", { id: ent.id }).datos.historial[0].detalle, /Quitó el turno a ana/);
  const igual = e.api(e.admin, "guardar", { ...sin, turnado_usuario: "" });
  assert.equal(igual.datos.sinCambios, true);
});

test("Mis asuntos: lo turnado a mí, con vencidos y lo que vence hoy, en el portal y en su pantalla", () => {
  const e = preparar();
  const ana = alta(e, "ana", "captura", ["OFE", "VOL"]);
  const hoy = e.api(ana, "misAsuntos").datos.hoy;
  const g = (x) => e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "M/" + Math.random(), turnado_usuario: "ana", ...x }).datos.registro;
  g({ estatus: "Pendiente", fecha_limite: "2026-01-05", asunto: "Vencido" });
  g({ estatus: "En trámite", fecha_limite: hoy, asunto: "Vence hoy" });
  g({ estatus: "Pendiente", fecha_limite: "2099-01-01", asunto: "Después" });
  g({ estatus: "Atendido", asunto: "Ya atendido" });
  const canc = g({ estatus: "Pendiente", asunto: "Cancelado después" });
  e.api(e.admin, "cancelar", { id: canc.id, version: canc.version, motivo: "Se capturó por error" });
  g({ estatus: "Pendiente", turnado_usuario: "", asunto: "De nadie" });
  const m = e.api(ana, "misAsuntos").datos;
  assert.deepEqual(m.asuntos.map((x) => x.asunto), ["Vencido", "Vence hoy", "Después", "Ya atendido"]);
  const ind = e.api(ana, "indicadores").datos;
  assert.deepEqual(ind.mios, { total: 4, porAtender: 3, vencidos: 1, venceHoy: 1 });
  assert.equal(ind.porTipo.OFE.mios, 4);
  assert.equal(e.api(e.admin, "indicadores").datos.mios.total, 0, "al admin no le turnaron nada");
  // y la lista de la libreta trae el turno para el filtro «Turnados a mí»
  const l = e.api(ana, "listar", { tipo: "OFE", anio: ANIO }).datos;
  assert.equal(l.filter((x) => x.turnado_usuario === "ana").length, 5);
});

test("nadie ve asuntos de libretas que no tiene, aunque se los hayan turnado", () => {
  const e = preparar();
  const ana = alta(e, "ana", "captura", ["OFE"]);
  const ent = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "S/1", estatus: "Pendiente", fecha_limite: "2026-01-05", turnado_usuario: "ana" }).datos.registro;
  assert.equal(e.api(ana, "misAsuntos").datos.asuntos.length, 1);
  // 1) Le quitan la libreta: el turno sigue en la hoja, pero ella ya no lo ve
  e.api(e.admin, "guardarUsuario", { usuario: "ana", nombre: "Persona ana", rol: "captura", tipos: ["CIR"] });
  const ana2 = entrar(e, "ana");
  assert.equal(e.api(ana2, "misAsuntos").datos.asuntos.length, 0);
  assert.deepEqual(e.api(ana2, "indicadores").datos.mios, { total: 0, porAtender: 0, vencidos: 0, venceHoy: 0 });
  assert.equal(e.api(ana2, "obtener", { id: ent.id }).codigo, "PERMISO");
  assert.equal(e.api(ana2, "listar", { tipo: "OFE", anio: ANIO }).codigo, "PERMISO");
  // 2) Alguien escribe a mano en la hoja un turno de otra libreta
  const h = e.hoja("Registros");
  const col = h.datos[0].indexOf("turnado_usuario");
  const filaOfs = h.datos.findIndex((f, i) => i > 0 && f && f[1] === "OFS");
  if (filaOfs > 0) {
    h.datos[filaOfs][col] = "ana";
  } else {
    e.api(e.admin, "guardar", nuevoOficio());
    h.datos[h.getLastRow() - 1][col] = "ana";
  }
  assert.equal(e.api(ana2, "misAsuntos").datos.asuntos.length, 0);
  assert.equal(e.api(ana2, "indicadores").datos.mios.total, 0);
  // 3) No se le puede turnar algo de una libreta que no tiene
  assert.equal(e.api(e.admin, "guardar", nuevoOficio({ turnado_usuario: "ana" })).codigo, "DATOS");
});

test("usuarios para turnar: solo activos con acceso; consulta no puede pedir la lista", () => {
  const e = preparar();
  const cap = alta(e, "ana", "captura", ["OFE"]);
  alta(e, "beto", "consulta", ["OFE"]);
  alta(e, "carla", "captura", ["OFS"]);
  const con = alta(e, "dora", "consulta", ["OFE"]);
  e.api(e.admin, "guardarUsuario", { usuario: "dora", nombre: "Persona dora", rol: "consulta", tipos: ["OFE"], activo: "NO" });
  const lista = e.api(cap, "usuariosTurno", { tipo: "OFE" }).datos.map((u) => u.usuario).sort();
  assert.deepEqual(lista, ["admin", "ana", "beto"]);
  assert.ok(e.api(cap, "usuariosTurno", { tipo: "OFE" }).datos.every((u) => Object.keys(u).sort().join() === "nombre,usuario"), "solo usuario y nombre");
  assert.equal(e.api(cap, "usuariosTurno", { tipo: "OFS" }).codigo, "PERMISO");
  assert.equal(e.api(con, "usuariosTurno", { tipo: "OFE" }).codigo, "SESION", "desactivada");
  const con2 = alta(e, "eli", "consulta", ["OFE"]);
  assert.equal(e.api(con2, "usuariosTurno", { tipo: "OFE" }).codigo, "PERMISO");
});

test("inicio dice qué acciones existen (para que la página no use lo que el servidor no tiene)", () => {
  const e = preparar();
  const con = alta(e, "carla", "consulta", ["OFS"]);
  const a = e.api(e.admin, "inicio").datos;
  assert.ok(a.acciones.includes("guardarVarios") && a.acciones.includes("misAsuntos") && a.acciones.includes("usuarios"));
  assert.equal(a.maxVarios, 100);
  const c = e.api(con, "inicio").datos;
  assert.ok(c.acciones.includes("misAsuntos"));
  assert.ok(!c.acciones.includes("guardarVarios") && !c.acciones.includes("usuarios"));
});

testBase("con la base real: varios destinatarios sigue después del 415 y del 370 BIS", () => {
  const e = preparar();
  const r = confirmado(e, e.admin, varios([{ dirigido_id: "P0030", dirigido_a: "Mtro. Daniel Esteban Ramírez Garcén\nDirector General" },
    { dirigido_id: "P0063", dirigido_a: "Lic. José Antonio Jiménez Islas\nSubsecretario" }])).datos;
  assert.equal(r.desde, "SAPCI/STPI/416/2026");
  assert.equal(r.hasta, "SAPCI/STPI/417/2026");
  assert.equal(r.registros[0].dirigido_id, "P0030");
});

/* ═══════════════════════ 1.4.0 · Buscador general ═══════════════════════ */

test("buscador general: sin acentos ni mayúsculas, en número, asunto, personas y observaciones", () => {
  const e = preparar();
  const a = e.api(e.admin, "guardar", nuevoOficio({ asunto: "Reunión del Gabinete en Iztapalapa", observaciones: "Llevar la carpeta AZUL" })).datos.registro;
  const b = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "SEDESA/DG/0099/2026", asunto: "Respuesta sobre la reunión", firma: "Dra. Ánima Ñúñez Peña\nDirectora" }).datos.registro;
  const q = (texto, t = e.admin) => e.api(t, "buscar", { q: texto });
  let r = q("REUNION gabinete").datos;
  assert.equal(r.total, 1);
  assert.equal(r.grupos[0].tipo, "OFS");
  assert.equal(r.grupos[0].registros[0].id, a.id);
  r = q("reunion").datos;
  assert.ok(r.grupos.some((g) => g.tipo === "OFS") && r.grupos.some((g) => g.tipo === "OFE"), "agrupa por libreta");
  assert.equal(q("anima nunez").datos.grupos[0].registros[0].id, b.id, "persona sin acentos");
  assert.equal(q("sedesa/dg/0099").datos.grupos[0].registros[0].id, b.id, "número del oficio");
  assert.equal(q(a.numero.toLowerCase()).datos.grupos[0].registros[0].id, a.id, "número oficial");
  assert.ok(q(String(a.consecutivo).padStart(3, "0") + "/" + a.anio).datos.grupos.some((g) => g.registros.some((x) => x.id === a.id)), "consecutivo");
  assert.equal(q("carpeta azul").datos.grupos[0].registros[0].id, a.id, "observaciones");
  assert.equal(q("x").codigo, "DATOS", "al menos 2 letras");
  assert.equal(q("   ").codigo, "DATOS");
});

test("buscador general: solo MIS libretas y máximo 50 resultados, agrupados", () => {
  const e = preparar();
  const ofe = alta(e, "ana", "consulta", ["OFE"]);
  for (let i = 0; i < 30; i++) e.api(e.admin, "guardar", nuevoOficio({ asunto: "Zafiro saliente " + i }));
  for (let i = 0; i < 30; i++) e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "Z/" + i, asunto: "Zafiro entrante " + i });
  const todo = e.api(e.admin, "buscar", { q: "zafiro" }).datos;
  assert.equal(todo.total, 60);
  assert.equal(todo.mostrados, 50);
  assert.equal(todo.grupos.reduce((s, g) => s + g.registros.length, 0), 50);
  assert.deepEqual(todo.grupos.map((g) => [g.tipo, g.total]), [["OFS", 30], ["OFE", 30]]);
  const suyo = e.api(ofe, "buscar", { q: "zafiro" }).datos;
  assert.equal(suyo.total, 30, "consulta con solo entrantes no ve los salientes");
  assert.deepEqual(suyo.grupos.map((g) => g.tipo), ["OFE"]);
  assert.ok(suyo.grupos[0].registros.every((x) => x.tipo === "OFE" && x.archivo_id === undefined));
});

/* ═══════════════════════ 1.4.0 · Modo mantenimiento ═══════════════════════ */

test("mantenimiento: solo entran los admin; los demás reciben el mensaje; queda en la bitácora", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", ["OFS"]);
  assert.equal(e.api(cap, "mantenimiento", { activo: true, mensaje: "x" }).codigo, "PERMISO");
  assert.equal(e.api(e.admin, "mantenimiento", { activo: true, mensaje: "" }).codigo, "DATOS", "hace falta el mensaje");
  assert.equal(e.api(e.admin, "mantenimiento", { activo: true, mensaje: "x".repeat(301) }).codigo, "DATOS");
  const on = e.api(e.admin, "mantenimiento", { activo: true, mensaje: "=Actualizando el sistema; regresa a las 3 pm" });
  assert.equal(on.ok, true, JSON.stringify(on));
  assert.deepEqual(on.datos, { activo: true, mensaje: "=Actualizando el sistema; regresa a las 3 pm" });
  // la sesión abierta de un no-admin recibe el aviso en cualquier acción (y en el «ping»)
  for (const acc of ["inicio", "listar", "ping", "buscar"]) {
    const r = e.api(cap, acc, { tipo: "OFS", anio: ANIO, q: "oficio" });
    assert.equal(r.codigo, "MANTENIMIENTO", acc);
    assert.equal(r.error, "=Actualizando el sistema; regresa a las 3 pm");
  }
  assert.equal(e.api(cap, "salir").ok, true, "salir sí se puede");
  // entrar: el no-admin no recibe sesión; el admin sí
  const r = e.api(null, "entrar", { usuario: "beto", clave: "Ahuehuete2026x" });
  assert.equal(r.codigo, "MANTENIMIENTO");
  assert.equal(e.api(null, "entrar", { usuario: "beto", clave: "mala" }).codigo, "CREDENCIALES", "con contraseña mala, el mensaje de siempre");
  assert.equal(e.api(null, "entrar", { usuario: "admin", clave: "Jacaranda2026x" }).ok, true);
  assert.equal(e.api(e.admin, "listar", { tipo: "OFS", anio: ANIO }).ok, true, "el admin sigue trabajando");
  const est = e.api(null, "estado").datos;
  assert.deepEqual(est.mantenimiento, { activo: true, mensaje: "=Actualizando el sistema; regresa a las 3 pm" }, "la pantalla de entrada lo muestra");
  assert.equal(e.api(e.admin, "inicio").datos.mantenimiento.activo, true);
  const cfg = e.hoja("Config").datos.find((f) => f && f[0] === "mantenimiento_msg");
  assert.equal(cfg[1], "=Actualizando el sistema; regresa a las 3 pm", "en la hoja quedó como texto, no fórmula");
  // apagar
  e.api(e.admin, "mantenimiento", { activo: false, mensaje: "" });
  assert.equal(e.api(null, "estado").datos.mantenimiento.activo, false);
  const t2 = entrar(e, "beto");
  assert.equal(e.api(t2, "inicio").ok, true);
  const bit = e.api(e.admin, "bitacora", { accion: "mantenimiento" }).datos.filas.map((x) => x.detalle);
  assert.deepEqual(bit, ["Desactivó el modo mantenimiento", "Activó el modo mantenimiento: «=Actualizando el sistema; regresa a las 3 pm»"]);
});

test("ping: avisa si la sesión terminó, pero NO la mantiene viva", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", ["OFS"]);
  assert.equal(e.api(cap, "ping").ok, true);
  e.reloj.offset += 2 * 3600 * 1000;
  assert.equal(e.api(cap, "ping").ok, true, "a las 2 h sigue viva");
  e.reloj.offset += 61 * 60 * 1000;
  assert.equal(e.api(cap, "ping").codigo, "SESION", "3 h sin actividad real: se cerró aunque la página hizo ping");
  // en cambio, una acción real sí renueva
  const t = entrar(e, "beto");
  e.reloj.offset += 2 * 3600 * 1000;
  assert.equal(e.api(t, "inicio").ok, true);
  e.reloj.offset += 61 * 60 * 1000;
  assert.equal(e.api(t, "ping").ok, true);
});

/* ═══════════════════════ 1.4.0 · Respaldo descargable ═══════════════════════ */

test("respaldo completo: solo admin, sin contraseñas, sellos ni IDs de Drive; queda en la bitácora", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", ["OFS"]);
  const r0 = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  e.api(cap, "subirArchivo", { id: r0.id, clase: "oficio", nombre: "a.pdf", mime: "application/pdf", base64: require("./comun.cjs").PDF });
  assert.equal(e.api(cap, "respaldo").codigo, "PERMISO");
  const r = e.api(e.admin, "respaldo").datos;
  assert.deepEqual(Object.keys(r.hojas), ["Registros", "Directorio", "Usuarios", "Bitacora", "Config"]);
  assert.ok(!r.hojas.Usuarios.columnas.includes("clave") && !r.hojas.Usuarios.columnas.includes("sello"));
  assert.ok(!r.hojas.Registros.columnas.includes("archivo_id") && !r.hojas.Registros.columnas.includes("acuse_archivo_id"));
  assert.ok(r.hojas.Registros.columnas.includes("archivo_nombre"));
  const plano = JSON.stringify(r);
  assert.doesNotMatch(plano, /pbkdf2\$/, "ninguna contraseña cifrada");
  const ids = [...e.drive.archivos.keys()];
  assert.ok(ids.every((id) => !plano.includes(id)), "ningún ID de Drive");
  assert.equal(r.hojas.Registros.filas.length, filasDe(e, "Registros") - 1);
  assert.equal(r.hojas.Usuarios.filas.length, 2);
  const b = e.api(e.admin, "bitacora", { accion: "respaldo" }).datos.filas;
  assert.equal(b[0].usuario, "admin");
  assert.match(b[0].detalle, /respaldo completo/);
});

test("duplicar: el alta anota de qué registro salió la copia", () => {
  const e = preparar();
  const orig = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  const copia = e.api(e.admin, "guardar", nuevoOficio({ copia_de: orig.id })).datos.registro;
  const h = e.api(e.admin, "obtener", { id: copia.id }).datos.historial[0];
  assert.match(h.detalle, new RegExp("\\(copia de " + String(orig.consecutivo).padStart(3, "0") + "/" + orig.anio + "\\)"));
  const otra = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "D/1", copia_de: orig.id }).datos.registro;
  assert.doesNotMatch(e.api(e.admin, "obtener", { id: otra.id }).datos.historial[0].detalle, /copia de/, "de otra libreta no se anota");
  assert.equal(copia.numero !== orig.numero && copia.consecutivo === orig.consecutivo + 1, true, "número nuevo");
});

/* ═══════════════════════ 1.5.0 · Fecha de atención e Informes ═══════════════════════ */

/** Mueve el reloj del simulador a un día y hora de la Ciudad de México (y vuelve a entrar). */
function irA(e, iso, hora = 12) {
  e.reloj.offset = 0;
  e.reloj.offset = Date.parse(iso + "T" + String(hora + 6).padStart(2, "0") + ":00:00Z") - Date.now();
  e.admin = entrar(e, "admin", "Jacaranda2026x");
}

test("fecha de atención: se pone al pasar a Atendido o Concluido y se borra si se reabre", () => {
  const e = preparar({ conBase: false });
  irA(e, "2026-03-02");
  const ent = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "A/1", estatus: "Pendiente" }).datos.registro;
  assert.equal(ent.fecha_atencion, "");
  irA(e, "2026-03-05");
  let r = e.api(e.admin, "guardar", { ...ent, estatus: "Atendido" }).datos.registro;
  assert.equal(r.fecha_atencion, "2026-03-05");
  irA(e, "2026-03-09");
  r = e.api(e.admin, "guardar", { ...r, estatus: "Concluido" }).datos.registro;
  assert.equal(r.fecha_atencion, "2026-03-05", "de Atendido a Concluido se conserva");
  r = e.api(e.admin, "guardar", { ...r, estatus: "En trámite" }).datos.registro;
  assert.equal(r.fecha_atencion, "", "reabierto: se borra");
  r = e.api(e.admin, "guardar", { ...r, estatus: "Atendido", fecha_atencion: "2020-01-01" }).datos.registro;
  assert.equal(r.fecha_atencion, "2026-03-09", "la pone el servidor; el navegador no la puede inventar");
  const nacido = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "A/2", estatus: "Concluido" }).datos.registro;
  assert.equal(nacido.fecha_atencion, "2026-03-09");
  // «Responder con oficio» también la pone en el original
  const ent2 = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "A/3", estatus: "Pendiente" }).datos.registro;
  irA(e, "2026-03-11");
  e.api(e.admin, "guardar", nuevoOficio({ relacionado_id: ent2.id, marcarAtendido: true, asunto: "Respuesta", fecha: "2026-03-11" }));
  assert.equal(e.api(e.admin, "obtener", { id: ent2.id }).datos.registro.fecha_atencion, "2026-03-11");
});

test("Informes: solo admin y quien tenga el permiso; nunca de libretas ajenas", () => {
  const e = preparar({ conBase: false });
  const cap = alta(e, "ana", "captura", ["OFE"]);
  const rango = { desde: "2026-01-01", hasta: "2026-12-31" };
  assert.equal(e.api(e.admin, "informes", rango).ok, true);
  assert.equal(e.api(cap, "informes", rango).codigo, "PERMISO");
  assert.ok(!e.api(cap, "inicio").datos.acciones.includes("informes"));
  assert.ok(e.api(e.admin, "inicio").datos.acciones.includes("informes"));
  // el admin le da permiso: la sesión se cierra (permisos nuevos = entrar de nuevo)
  e.api(e.admin, "guardarUsuario", { usuario: "ana", nombre: "Persona ana", rol: "captura", tipos: ["OFE"], informes: true });
  assert.equal(e.api(cap, "informes", rango).codigo, "SESION");
  const ana = entrar(e, "ana");
  assert.ok(e.api(ana, "inicio").datos.acciones.includes("informes"));
  const r = e.api(ana, "informes", rango).datos;
  assert.deepEqual(r.tipos, ["OFE"], "sin elegir libretas: solo las suyas");
  assert.equal(e.api(ana, "informes", { ...rango, tipos: ["OFE", "OFS"] }).codigo, "PERMISO", "no puede pedir libretas ajenas");
  assert.equal(e.api(e.admin, "usuarios").datos.find((u) => u.usuario === "ana").informes, "SI");
  // una página vieja que guarda el usuario sin el campo no le quita el permiso
  e.api(e.admin, "guardarUsuario", { usuario: "ana", nombre: "Ana P.", rol: "captura", tipos: ["OFE"] });
  assert.equal(e.api(e.admin, "usuarios").datos.find((u) => u.usuario === "ana").informes, "SI");
  // quitarlo
  e.api(e.admin, "guardarUsuario", { usuario: "ana", nombre: "Ana P.", rol: "captura", tipos: ["OFE"], informes: false });
  assert.equal(e.api(entrar(e, "ana"), "informes", rango).codigo, "PERMISO");
  const bit = e.api(e.admin, "bitacora", { accion: "usuarios" }).datos.filas.map((x) => x.detalle).join("\n");
  assert.match(bit, /captura\/OFE\/SI → captura\/OFE\/SI\/informes/);
  // validación del periodo
  assert.equal(e.api(e.admin, "informes", { desde: "2026-12-31", hasta: "2026-01-01" }).codigo, "DATOS");
  assert.equal(e.api(e.admin, "informes", { desde: "2026-02-30", hasta: "2026-03-01" }).codigo, "DATOS");
  assert.equal(e.api(e.admin, "informes", { desde: "2010-01-01", hasta: "2026-01-01" }).codigo, "DATOS");
});

test("Informes: por mes, remitentes y destinatarios, tiempo de respuesta y atendido a tiempo", () => {
  const e = preparar({ conBase: false });
  const ent = (numero, recepcion, limite, extra = {}) => e.api(e.admin, "guardar", { tipo: "OFE", numero, asunto: "Entrante " + numero, fecha: recepcion,
    fecha_recepcion: recepcion, fecha_limite: limite, estatus: "Pendiente", firma: "Remitente A\nCargo", dirigido_a: "Subsecretario", ...extra }).datos.registro;
  const responder = (orig, fecha) => e.api(e.admin, "guardar", nuevoOficio({ relacionado_id: orig.id, marcarAtendido: true, asunto: "Respuesta a " + orig.numero, fecha, dirigido_a: "Remitente A" }));
  irA(e, "2026-03-02"); const e1 = ent("E/1", "2026-03-02", "2026-03-06");          // lunes
  irA(e, "2026-03-05"); responder(e1, "2026-03-05");                                // 3 días hábiles, a tiempo
  irA(e, "2026-03-10"); const e2 = ent("E/2", "2026-03-10", "2026-03-13");          // martes
  irA(e, "2026-03-24"); responder(e2, "2026-03-24");                                // 10 días hábiles, tarde
  irA(e, "2026-04-01");
  ent("E/3", "2026-04-01", "2026-04-03", { firma: "Remitente B" });                 // sigue abierto: vencido
  ent("E/4", "2026-04-01", "2026-12-31", { firma: "Remitente B" });                 // abierto, aún en plazo
  const e5 = ent("E/5", "2026-04-01", "2026-04-10", { firma: "Remitente C" });
  const e6 = ent("E/6", "2026-04-01", "2026-04-02", { firma: "Remitente C", estatus: "Atendido" });
  irA(e, "2026-04-08"); e.api(e.admin, "guardar", { ...e5, estatus: "Atendido" });   // a tiempo
  // Simular registros de antes de 1.5.0: sin fecha_atencion
  const h = e.hoja("Registros"), col = (c) => h.datos[0].indexOf(c);
  for (const f of h.datos) {
    if (f && f[0] === e5.id) f[col("fecha_atencion")] = "";                               // la saca de la bitácora (08/04)
    if (f && f[0] === e6.id) { f[col("fecha_atencion")] = ""; f[col("origen")] = "Minutario 2026 · prueba"; }   // sin dato
  }
  e.reloj.offset = 0;
  e.admin = entrar(e, "admin", "Jacaranda2026x");
  const r = e.api(e.admin, "informes", { desde: "2026-01-01", hasta: "2026-12-31" }).datos;
  const mes = (m) => r.porMes.find((x) => x.mes === m);
  assert.equal(r.porMes.length, 12);
  assert.deepEqual([mes("2026-03").total, mes("2026-03").porTipo.OFE, mes("2026-03").porTipo.OFS], [4, 2, 2]);
  assert.deepEqual([mes("2026-04").total, mes("2026-04").porTipo.OFE], [4, 4]);
  assert.equal(r.total, 8);
  assert.deepEqual(r.remitentes.lista.map((x) => [x.nombre, x.n]), [["Remitente A", 2], ["Remitente B", 2], ["Remitente C", 2]]);
  assert.deepEqual(r.destinatarios.lista.map((x) => [x.nombre, x.n]), [["Remitente A", 2]]);
  assert.equal(r.respuesta.casos, 2);
  assert.equal(r.respuesta.recibidos, 6);
  assert.equal(r.respuesta.promedio, 6.5);
  assert.equal(r.respuesta.mediana, 6.5);
  assert.deepEqual(r.respuesta.distribucion.map((x) => x.n), [0, 1, 1, 0, 0]);
  assert.deepEqual([r.aTiempo.aTiempo, r.aTiempo.tarde, r.aTiempo.vencido, r.aTiempo.enPlazo, r.aTiempo.sinDato], [2, 1, 1, 1, 1]);
  assert.equal(r.aTiempo.porcentaje, 50);
  assert.equal(r.aTiempo.detalle.length, 0, "el detalle solo viaja para el Excel");
  // filtro por libreta y periodo
  const soloOfs = e.api(e.admin, "informes", { desde: "2026-03-01", hasta: "2026-03-31", tipos: ["OFS"] }).datos;
  assert.deepEqual([soloOfs.total, soloOfs.porMes.length, soloOfs.remitentes.total, soloOfs.respuesta.casos], [2, 1, 0, 0]);
  // Excel: trae el detalle y queda en la bitácora
  const x = e.api(e.admin, "informes", { desde: "2026-01-01", hasta: "2026-12-31", excel: true }).datos;
  assert.equal(x.respuesta.pares.length, 2);
  assert.deepEqual(x.respuesta.pares.map((p) => p.dias).sort(), [10, 3]);
  const d5 = x.aTiempo.detalle.find((d) => d.numero === "E/5");
  assert.deepEqual([d5.resultado, d5.fecha_atencion, d5.fuente], ["aTiempo", "2026-04-08", "bitácora"]);
  assert.equal(x.aTiempo.detalle.find((d) => d.numero === "E/6").resultado, "sinDato");
  assert.match(e.api(e.admin, "bitacora", { accion: "exportación" }).datos.filas[0].detalle, /Excel de Informes del 2026-01-01 al 2026-12-31/);
  // Quien solo tiene entrantes no ve los oficios salientes (ni sus fechas) en el tiempo de respuesta
  alta(e, "ana", "consulta", ["OFE"], { informes: true });
  const ana = e.api(entrar(e, "ana"), "informes", { desde: "2026-01-01", hasta: "2026-12-31" }).datos;
  assert.equal(ana.respuesta.casos, 0);
  assert.equal(ana.destinatarios.total, 0);
});
