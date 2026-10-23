// Pruebas de la 1.6.0: Exportación solo para administradores y velocidad
// (la hoja se abre una vez por petición, historial sin leer toda la bitácora,
// entrar trae el portal, guardar trae el detalle, precarga de listas).
const { assert, preparar, alta, nuevoOficio, testBase, PDF } = require("./comun.cjs");

testBase("exportación: solo administradores, por libreta y de fecha a fecha", () => {
  const e = preparar();
  const cap = alta(e, "beto", "captura", "*");
  const con = alta(e, "carla", "consulta", ["OFS", "OFE"]);
  for (const t of [cap, con]) {
    assert.equal(e.api(t, "exportar", { tipo: "TODOS", desde: "2026-01-01", hasta: "2026-12-31" }).codigo, "PERMISO");
    assert.equal(e.api(t, "exportar", { tipo: "OFS", anio: 2026 }).codigo, "PERMISO", "tampoco con la forma anterior (por año)");
    assert.equal(e.api(t, "exportar", { tipo: "TODOS", soloConteo: true }).codigo, "PERMISO", "ni el conteo");
  }
  assert.ok(!e.api(cap, "inicio").datos.acciones.includes("exportar"), "la página no le muestra Exportación");
  const todo = e.api(e.admin, "exportar", { tipo: "TODOS", soloConteo: true }).datos;
  assert.equal(todo.total, 732);
  assert.equal(todo.porTipo.OFS, 416);
  const ene = e.api(e.admin, "exportar", { tipo: "OFS", desde: "2026-01-01", hasta: "2026-01-31", soloConteo: true }).datos;
  assert.ok(ene.total > 0 && ene.total < 416);
  assert.ok(ene.sinFecha > 0, "los apartados sin fecha no entran en un rango");
  const conDatos = e.api(e.admin, "exportar", { tipo: "OFS", desde: "2026-01-01", hasta: "2026-01-31" }).datos;
  assert.equal(conDatos.filas.length, ene.total);
  assert.ok(conDatos.filas.every((r) => r.fecha >= "2026-01-01" && r.fecha <= "2026-01-31"));
  assert.ok(conDatos.filas.every((r) => !("archivo_id" in r)), "no salen IDs de Drive");
  const entr = e.api(e.admin, "exportar", { tipo: "OFE", desde: "2026-06-01", hasta: "2026-06-30" }).datos.filas;
  assert.ok(entr.every((r) => (r.fecha_recepcion || r.fecha) >= "2026-06-01" && (r.fecha_recepcion || r.fecha) <= "2026-06-30"), "en entrantes cuenta la fecha de recibido");
  assert.equal(e.api(e.admin, "exportar", { tipo: "TODOS", desde: "2026-05-01", hasta: "2026-04-01" }).codigo, "DATOS");
  assert.equal(e.api(e.admin, "exportar", { tipo: "TODOS", desde: "2026-13-01" }).codigo, "DATOS");
  const bit = e.api(e.admin, "bitacora", { accion: "exportación" }).datos.filas;
  assert.match(bit[0].detalle, /del 2026-06-01 al 2026-06-30/);
});

testBase("velocidad: la hoja se abre una vez por petición y el historial no lee toda la bitácora", () => {
  const e = preparar();
  // Un año de uso: 20,000 movimientos en la bitácora
  const bit = e.hoja("Bitacora");
  bit.maxRows = 21000;
  for (let i = 0; i < 20000; i++) {
    const fila = bit.getLastRow() + 1;
    bit.datos[fila - 1] = ["2026-03-01 10:00:00", "u" + (i % 5), i % 4 ? "entrar" : "edición", i % 4 ? "" : "m-ofs-2026-00" + (1 + (i % 9)), "x"];
    bit.formatos[fila - 1] = ["@", "@", "@", "@", "@"];
  }
  e.medir();
  const det = e.api(e.admin, "obtener", { id: "m-ofs-2026-003" }).datos;
  const m = e.medir();
  assert.equal(m.aperturas, 1, "una sola apertura de la hoja");
  assert.ok(m.celdas < 40000, "no se leyó la bitácora completa (" + m.celdas + " celdas)");
  assert.equal(det.historial.length, 100, "los 100 más recientes");
  assert.ok(det.historial.every((x) => x.registro_id === "m-ofs-2026-003"));
  for (const [acc, d] of [["inicio"], ["listar", { tipo: "OFS", anio: 2026 }], ["pendientes"], ["guardar", nuevoOficio()], ["bitacora"], ["misAsuntos"], ["buscar", { q: "logística" }]]) {
    e.medir();
    const r = e.api(e.admin, acc, d);
    assert.equal(r.ok, true, acc + ": " + JSON.stringify(r).slice(0, 200));
    assert.equal(e.medir().aperturas, 1, acc + ": una sola apertura");
  }
});

testBase("velocidad: el historial nuevo es igual al de antes (mismo orden, mismos datos)", () => {
  const e = preparar();
  const r = e.api(e.admin, "guardar", nuevoOficio()).datos.registro;
  let v = r.version;
  for (let i = 0; i < 4; i++) {
    const g = e.api(e.admin, "guardar", { ...r, version: v, asunto: "Cambio " + i }).datos;
    v = g.registro.version;
  }
  e.api(e.admin, "subirArchivo", { id: r.id, clase: "oficio", nombre: "a.pdf", mime: "application/pdf", base64: PDF });
  const hist = e.api(e.admin, "obtener", { id: r.id }).datos.historial;
  // Como lo hacía la 1.5.0: toda la bitácora, filtrada y al revés
  const todas = e.hoja("Bitacora").datos.slice(1).filter((f) => f && f[3] === r.id)
    .map((f) => ({ fecha: f[0], usuario: f[1], accion: f[2], registro_id: f[3], detalle: f[4] })).reverse();
  assert.deepEqual(hist, todas);
  assert.deepEqual(hist.map((x) => x.accion), ["archivo", "edición", "edición", "edición", "edición", "alta"]);
});

testBase("velocidad: entrar trae el portal y guardar trae el detalle (una vuelta menos)", () => {
  const e = preparar();
  const ent = e.api(null, "entrar", { usuario: "admin", clave: "Gestion2026" }).datos;
  assert.ok(ent.inicio && ent.inicio.yo.usuario === "admin" && ent.inicio.indicadores.porTipo.OFS, "entrar trae los datos del portal");
  const ini = e.api(ent.token, "inicio").datos;
  assert.deepEqual(Object.keys(ent.inicio).sort(), Object.keys(ini).sort());
  assert.deepEqual(ent.inicio.acciones, ini.acciones, "las mismas acciones (Informes, Exportación…)");
  // con contraseña temporal no trae nada más
  const u = e.api(e.admin, "guardarUsuario", { nuevo: true, usuario: "nuevo.u", nombre: "Nuevo", rol: "consulta", tipos: ["OFE"] }).datos;
  const temp = e.api(null, "entrar", { usuario: "nuevo.u", clave: u.temporal }).datos;
  assert.equal(temp.debe_cambiar, true);
  assert.equal(temp.inicio, undefined);
  // un usuario limitado recibe solo lo suyo
  const cap = alta(e, "beto", "captura", ["OFE"]);
  assert.ok(cap);
  const entB = e.api(null, "entrar", { usuario: "beto", clave: "Minutario2026x" }).datos;
  assert.deepEqual(entB.inicio.orden, ["OFE"]);
  assert.ok(!entB.inicio.acciones.includes("exportar") && !entB.inicio.acciones.includes("informes"));
  // guardar (alta y respuesta) regresa ligados e historial, igual que obtener
  const orig = e.api(e.admin, "guardar", { ...nuevoOficio(), tipo: "OFE", numero: "SAPCI/X/0001/2026", estatus: "Pendiente", turnado_usuario: "beto" }).datos;
  assert.equal(orig.detalle.historial.map((x) => x.accion).sort().join(), "alta,turno");
  assert.equal(orig.registro.turnado_nombre, "Persona beto", "con el nombre de a quién se turnó, como obtener");
  const resp = e.api(e.admin, "guardar", nuevoOficio({ relacionado_id: orig.registro.id, marcarAtendido: true, asunto: "Respuesta" })).datos;
  const obt = e.api(e.admin, "obtener", { id: resp.registro.id }).datos;
  assert.deepEqual(resp.detalle.ligados, obt.ligados);
  assert.deepEqual(resp.detalle.historial, obt.historial);
  assert.equal(resp.detalle.ligados[0].estatus, "Atendido");
  const ed = e.api(e.admin, "guardar", { ...resp.registro, asunto: "Respuesta corregida" }).datos;
  assert.deepEqual(ed.detalle.historial, e.api(e.admin, "obtener", { id: resp.registro.id }).datos.historial);
  assert.deepEqual(ed.registro, e.api(e.admin, "obtener", { id: resp.registro.id }).datos.registro, "el registro que regresa guardar es el mismo que el de obtener");
  const can = e.api(e.admin, "cancelar", { id: resp.registro.id, version: ed.registro.version, motivo: "Prueba de cancelación" }).datos;
  assert.equal(can.detalle.historial[0].accion, "cancelación");
  const sub = e.api(e.admin, "subirArchivo", { id: orig.registro.id, clase: "oficio", nombre: "a.pdf", mime: "application/pdf", base64: PDF }).datos;
  assert.equal(sub.detalle.historial[0].accion, "archivo");
  assert.equal(JSON.stringify(sub).indexOf("archivo_id"), -1, "no se mandan IDs de Drive");
  const qui = e.api(e.admin, "quitarArchivo", { id: orig.registro.id, clase: "oficio" }).datos;
  assert.equal(qui.registro.tiene_archivo, false);
  assert.equal(qui.detalle.historial[0].accion, "archivo");
});

testBase("velocidad: la precarga de listas respeta las libretas de cada quien", () => {
  const e = preparar();
  const con = alta(e, "carla", "consulta", ["OFE", "CIR"]);
  const p = e.api(con, "listarTodo").datos;
  assert.deepEqual(Object.keys(p.listas).sort(), ["CIR", "OFE"]);
  assert.deepEqual(p.listas.OFE, e.api(con, "listar", { tipo: "OFE", anio: p.anio }).datos);
  assert.equal(e.api(null, "listarTodo").codigo, "SESION");
  const adm = e.api(e.admin, "listarTodo").datos;
  assert.equal(Object.keys(adm.listas).length, 6);
  assert.equal(adm.listas.OFS.length, 416);
  for (const t of Object.keys(adm.listas)) assert.deepEqual(adm.listas[t], e.api(e.admin, "listar", { tipo: t, anio: adm.anio }).datos, t);
});

testBase("velocidad: en mantenimiento, entrar sigue sin dejar pasar a quien no es administrador", () => {
  const e = preparar();
  alta(e, "beto", "captura", ["OFE"]);
  assert.equal(e.api(e.admin, "mantenimiento", { activo: true, mensaje: "Actualizando el sistema" }).ok, true);
  const r = e.api(null, "entrar", { usuario: "beto", clave: "Minutario2026x" });
  assert.equal(r.codigo, "MANTENIMIENTO");
  const a = e.api(null, "entrar", { usuario: "admin", clave: "Gestion2026" }).datos;
  assert.equal(a.inicio.mantenimiento.activo, true, "el administrador entra y ve el aviso");
});
