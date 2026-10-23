/**
 * ════════════════════════════════════════════════════════════════════════
 *  CONTROL DE GESTIÓN · Servidor (Google Apps Script)
 *
 *  La base es la hoja de cálculo donde vive este script. La hoja NO se
 *  comparte con nadie: la gente entra solo por la app web, con usuario y
 *  contraseña propios, y todo pasa por api(), que revisa sesión y permisos
 *  en CADA llamada.
 *
 *  Reglas de seguridad que no hay que romper al modificar este archivo:
 *   1. Toda función que NO deba poder llamarse desde el navegador termina
 *      en guion bajo (_). Apps Script no deja que google.script.run llame
 *      funciones privadas. Las únicas públicas son: doGet, doPost, api,
 *      instalar, restablecerAdministrador, revisarSeguridad, revisarRespaldos,
 *      respaldoDiario, respaldoSemanal y avisosDiarios (todas se protegen
 *      solas; ver Instalacion.gs, Respaldos.gs y Avisos.gs).
 *   2. Nunca se devuelven contraseñas, "sellos" ni IDs de Drive al cliente
 *      más allá de lo necesario.
 *   3. Lo que escribe el usuario se guarda como texto: si empieza con
 *      = + - @ se le antepone un apóstrofo para que la hoja no lo tome como
 *      fórmula.
 *   4. Todo lo que ESCRIBE en la hoja va dentro del candado (candado_ /
 *      soltar_), incluida la Bitácora. Si no, dos personas al mismo tiempo
 *      pueden escribir en el mismo renglón y una de las dos se pierde.
 *   5. Este proyecto tiene varios archivos .gs. Lo que se evalúa al cargar
 *      (como ACCIONES_) NO debe llamar funciones de otros archivos: Google
 *      carga los archivos en orden y la de otro archivo puede no existir aún.
 *      Por eso las acciones de otros archivos van envueltas en function () {…}.
 * ════════════════════════════════════════════════════════════════════════
 */

var VERSION = '1.7.0';   // súbela junto con VERSION_APP (App.html) en cada cambio
var ZONA = 'America/Mexico_City';
var SESION_SEG = 3 * 60 * 60;      // 3 h sin actividad cierran la sesión
var MAX_ARCHIVO_MB = 10;
var MAX_VARIOS = 100;              // destinatarios por vez en «Varios destinatarios»
var MIMES_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png'];

var FUENTES_URL = 'https://fonts.googleapis.com/css2?family=Cabin:wght@500;600;700&family=Roboto:wght@400;500;700&display=swap';
var HOJAS = { REG: 'Registros', DIR: 'Directorio', USR: 'Usuarios', BIT: 'Bitacora', CFG: 'Config' };

var COLS = {
  Registros: ['id', 'tipo', 'anio', 'consecutivo', 'sufijo', 'numero', 'asunto',
    'dirigido_id', 'dirigido_a', 'firma_id', 'firma', 'area',
    'fecha', 'fecha_recepcion', 'elaboro', 'acuse', 'carpeta',
    'observaciones', 'estatus', 'fecha_limite', 'turnado_a',
    'relacionado_id', 'archivo_id', 'archivo_nombre',
    'acuse_archivo_id', 'acuse_archivo_nombre', 'motivo_cancelacion',
    'creado_por', 'creado_en', 'modificado_por', 'modificado_en',
    'version', 'origen',
    // ── 1.3.0 · columnas nuevas: SIEMPRE al final (y también en migrar_minutario.py)
    'turnado_usuario',
    // ── 1.5.0 · fecha en que pasó a Atendido o Concluido (la pone el servidor)
    'fecha_atencion'],
  Directorio: ['id', 'nombre', 'cargo', 'dependencia', 'activo', 'unido_a',
    'creado_por', 'creado_en', 'modificado_en'],
  Usuarios: ['usuario', 'nombre', 'rol', 'tipos', 'activo', 'clave', 'debe_cambiar',
    'intentos', 'bloqueado_hasta', 'sello', 'creado_en', 'ultimo_acceso',
    // ── 1.5.0 · SI = puede ver Informes (los administradores siempre pueden)
    'informes',
    // ── 1.7.0 · correo para avisos y verificación en dos pasos (secreto cifrado con la pimienta)
    'correo', 'totp'],
  Bitacora: ['fecha', 'usuario', 'accion', 'registro_id', 'detalle'],
  Config: ['clave', 'valor', 'descripcion']
};
var NUMERICAS = { Registros: { anio: true, consecutivo: true, version: true } };

/** Libretas del minutario. Las columnas y etiquetas son las del Excel original. */
var TIPOS = {
  OFS: { nombre: 'Oficios salientes', singular: 'Oficio saliente', recibido: false, numeroAuto: true,
    campos: [['dirigido', 'Dirigido a'], ['asunto', 'Asunto'], ['fecha', 'Fecha'], ['firma', 'Firma'],
      ['elaboro', 'Revisó / Elaboró'], ['acuse', 'Acuse'], ['carpeta', 'No. de carpeta'], ['observaciones', 'Observaciones']] },
  OFE: { nombre: 'Oficios entrantes', singular: 'Oficio entrante', recibido: true,
    campos: [['dirigido', 'Dirigido a'], ['numero', 'No. de oficio'], ['asunto', 'Asunto'], ['fecha', 'Fecha de elaboración'],
      ['fecha_recepcion', 'Fecha de recibido'], ['firma', 'Remitente'], ['elaboro', 'Recibió'], ['acuse', 'Oficio original'],
      ['carpeta', 'No. de carpeta'], ['observaciones', 'Observaciones']] },
  OFC: { nombre: 'Oficios de conocimiento', singular: 'Oficio de conocimiento', recibido: true,
    campos: [['dirigido', 'Dirigido a'], ['numero', 'Oficio'], ['asunto', 'Asunto'], ['fecha', 'Fecha de elaboración'],
      ['fecha_recepcion', 'Fecha de recibido'], ['firma', 'Firma'], ['elaboro', 'Elaboró / Revisó'], ['acuse', 'Acuse'],
      ['carpeta', 'No. de carpeta'], ['observaciones', 'Observaciones']] },
  CIR: { nombre: 'Circulares', singular: 'Circular', recibido: true,
    campos: [['dirigido', 'Dirigido a'], ['numero', 'Circular No.'], ['asunto', 'Asunto'], ['fecha', 'Fecha'],
      ['firma', 'Firma'], ['area', 'Área o dependencia'], ['observaciones', 'Observaciones']] },
  TAR: { nombre: 'Tarjetas informativas', singular: 'Tarjeta informativa', recibido: true,
    campos: [['dirigido', 'Dirigido a'], ['numero', 'Folio'], ['asunto', 'Asunto'], ['fecha', 'Fecha de elaboración'],
      ['fecha_recepcion', 'Fecha de recepción'], ['firma', 'Firma'], ['elaboro', 'Elaboró / Revisó'], ['acuse', 'Acuse'],
      ['carpeta', 'No. de carpeta'], ['observaciones', 'Observaciones']] },
  VOL: { nombre: 'Volantes de turno', singular: 'Volante de turno', recibido: true,
    campos: [['dirigido', 'Dirigido a'], ['asunto', 'Asunto'], ['numero', 'Folio'], ['fecha', 'Fecha de elaboración'],
      ['fecha_recepcion', 'Fecha de recepción'], ['firma', 'Firma'], ['elaboro', 'Elaboró / Revisó'], ['acuse', 'Acuse'],
      ['carpeta', 'No. de carpeta'], ['observaciones', 'Observaciones']] }
};
var ORDEN_TIPOS = ['OFS', 'OFE', 'OFC', 'CIR', 'TAR', 'VOL'];
var ESTATUS = ['Pendiente', 'En trámite', 'Atendido', 'Concluido', 'Cancelado'];
var CERRADOS = ['Atendido', 'Concluido'];   // estatus que cuentan como «atendido» en Informes
var ROLES = { admin: 'Administrador', captura: 'Captura', consulta: 'Consulta' };

// Memoria de UNA petición: la hoja se abre una sola vez por llamada. Se vacía
// al entrar a api(), doGet() y las funciones del editor (nuevaPeticion_), así
// nunca se reutiliza nada entre una petición y otra.
var MEMO_ = {};
function nuevaPeticion_() { MEMO_ = {}; }

/* ═══════════════════════════ Entrada de la app web ═════════════════════ */

function doGet() {
  nuevaPeticion_();
  // Si la app ya vive en otra dirección (Vercel), aquí solo se deja un enlace.
  var web = '';
  try { web = config_().url_web || ''; } catch (e) { /* aún sin instalar */ }
  if (web) {
    var enlace = HtmlService.createHtmlOutput('<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_top"></head>' +
      '<body style="font-family:system-ui,sans-serif;display:grid;place-content:center;min-height:90vh;text-align:center;color:#55585a">' +
      '<h2 style="color:#8f4889">Control de Gestión</h2><p>El sistema está en esta dirección:</p>' +
      '<p><a style="font-size:18px;color:#8f4889" href="' + escHtml_(web) + '">' + escHtml_(web) + '</a></p></body></html>')
      .setTitle('Control de Gestión');
    try { enlace.setFaviconUrl(web.replace(/\/+$/, '') + '/icono-32.png'); } catch (e) { /* sin ícono */ }
    return enlace;
  }
  // La página se arma pegando los archivos HTML del proyecto. Ojo: Google
  // quita los comentarios <!-- --> de los archivos, así que no se usan como
  // marcadores: Index.html es solo el cuerpo y aquí se arma el resto.
  var html = '<!DOCTYPE html><html lang="es"><head><base target="_top"><meta charset="utf-8">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="' + FUENTES_URL + '" rel="stylesheet">' +
    incluir_('Estilos') + '</head><body>' + incluir_('Index') + incluir_('Excel') + scriptApp_() + '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Control de Gestión')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function incluir_(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/**
 * La aplicación está repartida en varios archivos App*.html (cada uno con su
 * <script> para que Google lo trate como código y no como texto). Aquí se les
 * quita esa envoltura y se juntan en UNA sola función, igual que hace
 * herramientas/armar-web.mjs para Vercel. El orden importa: el último arranca.
 */
var FRAGMENTOS_APP = ['App', 'AppEntrada', 'AppQR', 'AppPortal', 'AppLibreta', 'AppDetalle', 'AppFormulario', 'AppInformes', 'AppAdmin', 'AppArranque'];

function scriptApp_() {
  var partes = FRAGMENTOS_APP.map(function (n) {
    return incluir_(n).replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
  });
  return '<script>(function () {\n\'use strict\';\n' + partes.join('\n') + '\n})();</script>';
}

/**
 * La misma api(), pero para la página publicada fuera de Google (Vercel).
 * El navegador manda POST con texto JSON { token, accion, datos } y recibe
 * la misma respuesta { ok, datos | codigo, error }. Las reglas de sesión y
 * permisos son exactamente las mismas: todo pasa por api().
 */
function doPost(e) {
  var r;
  try {
    var cuerpo = e && e.postData ? String(e.postData.contents || '') : '';
    if (!cuerpo || cuerpo.length > 16 * 1024 * 1024) throw new Error('tamaño');
    var p = JSON.parse(cuerpo);
    r = api(p.token, p.accion, p.datos);
  } catch (err) {
    r = { ok: false, codigo: 'PETICION', error: 'Petición inválida.' };
  }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

function escHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * ÚNICA puerta de datos para el navegador.
 * Responde { ok: true, datos } o { ok: false, codigo, error, extra }.
 */
function api(token, accion, datos) {
  nuevaPeticion_();
  try {
    datos = datos || {};
    if (typeof accion !== 'string') throw falla_('PETICION', 'Petición inválida.');
    if (accion === 'estado') return { ok: true, datos: estadoPublico_() };
    if (accion === 'entrar') return { ok: true, datos: entrar_(datos) };
    if (accion === 'entrarCodigo') return { ok: true, datos: entrarCodigo_(datos) };
    // «ping» solo pregunta si la sesión sigue viva: NO cuenta como actividad
    // (si no, una pestaña abierta mantendría la sesión para siempre).
    var yo = sesion_(token, accion === 'ping');
    var a = ACCIONES_[accion];
    if (!a || !Object.prototype.hasOwnProperty.call(ACCIONES_, accion)) throw falla_('PETICION', 'Acción desconocida.');
    var mant = mantenimiento_();
    if (mant.activo && yo.rol !== 'admin' && accion !== 'salir') throw falla_('MANTENIMIENTO', mant.mensaje);
    if (yo.debe_cambiar && accion !== 'cambiarClave' && accion !== 'salir') {
      throw falla_('CAMBIAR_CLAVE', 'Antes de seguir tienes que cambiar tu contraseña temporal.');
    }
    // Si Configuración exige la verificación en dos pasos a los administradores,
    // quien no la tiene solo puede activarla (o salir).
    if (debeActivar2fa_(yo) && ['totpIniciar', 'totpConfirmar', 'cambiarClave', 'salir', 'ping'].indexOf(accion) < 0) {
      throw falla_('ACTIVAR_2FA', 'Antes de seguir activa la verificación en dos pasos (es obligatoria para administradores).');
    }
    if (a.rol && !tieneRol_(yo, a.rol)) throw falla_('PERMISO', 'No tienes permiso para esto.');
    if (a.permiso && !a.permiso(yo)) throw falla_('PERMISO', 'No tienes permiso para esto.');
    var r = { ok: true, datos: a.fn(yo, datos, token) };
    try { vigilarConsulta_(yo, accion, datos); } catch (e1) { console.warn('vigilar: ' + (e1 && e1.message)); }
    return r;
  } catch (e) {
    if (e && e.codigo) return { ok: false, codigo: e.codigo, error: e.message, extra: e.extra || null };
    var ref = Utilities.getUuid().slice(0, 8);
    console.error('api(' + accion + ') ref ' + ref + ': ' + (e && e.stack ? e.stack : e));
    return { ok: false, codigo: 'INTERNO', error: 'Ocurrió un error interno (referencia ' + ref + '). Intenta de nuevo.' };
  } finally {
    cerrarPeticion_();
  }
}

/**
 * Al terminar cada petición (ya sin el candado): la caché de Registros se da
 * por vieja si algo se escribió, y se mandan los correos pendientes. Nada de
 * esto puede tumbar la respuesta.
 */
function cerrarPeticion_() {
  try { publicarCambiosRegistros_(); } catch (e) { console.error('caché: ' + (e && e.message)); }
  var avisos = MEMO_.avisos || [];
  MEMO_.avisos = [];
  if (avisos.length) {
    try { enviarAvisos_(avisos); } catch (e2) { console.error('avisos: ' + (e2 && e2.message)); }
  }
}

var ACCIONES_ = {
  salir: { fn: salir_ },
  cambiarClave: { fn: function (yo, d) { return cambiarClave_(yo, d); } },   // en Seguridad.gs
  inicio: { fn: inicio_ },
  indicadores: { fn: function (yo) { return indicadores_(yo); } },
  listar: { fn: listar_ },
  obtener: { fn: obtener_ },
  guardar: { fn: conDetalle_(guardar_), rol: 'captura' },
  cancelar: { fn: conDetalle_(cancelar_), rol: 'admin' },
  pendientes: { fn: pendientes_ },
  exportar: { fn: exportar_, rol: 'admin' },   // descargar datos en Excel: solo administradores (1.6.0)
  subirArchivo: { fn: conDetalle_(subirArchivo_), rol: 'captura' },
  descargarArchivo: { fn: descargarArchivo_ },
  quitarArchivo: { fn: conDetalle_(quitarArchivo_), rol: 'captura' },
  directorio: { fn: listarDirectorio_ },
  guardarPersona: { fn: guardarPersona_, rol: 'captura' },
  unirPersonas: { fn: unirPersonas_, rol: 'admin' },
  usuarios: { fn: listarUsuarios_, rol: 'admin' },
  guardarUsuario: { fn: guardarUsuario_, rol: 'admin' },
  restablecerClave: { fn: restablecerClave_, rol: 'admin' },
  bitacora: { fn: listarBitacora_, rol: 'admin' },
  guardarConfig: { fn: guardarConfig_, rol: 'admin' },
  // 1.3.0
  guardarVarios: { fn: guardarVarios_, rol: 'captura' },
  usuariosTurno: { fn: usuariosTurno_, rol: 'captura' },
  misAsuntos: { fn: misAsuntos_ },
  // 1.4.0
  ping: { fn: ping_ },
  buscar: { fn: buscar_ },
  mantenimiento: { fn: guardarMantenimiento_, rol: 'admin' },
  respaldo: { fn: respaldo_, rol: 'admin' },
  // 1.5.0 · Informes: administradores y quien tenga «informes = SI» en Usuarios
  informes: { fn: informes_, permiso: function (yo) { return yo.rol === 'admin' || yo.informes === true; } },
  // 1.6.0 · Velocidad: las listas del año de todas las libretas en una vuelta
  listarTodo: { fn: listarTodo_ },
  // 1.7.0 · Las de otros archivos van envueltas (ver regla 5 arriba)
  guardarLote: { fn: function (yo, d) { return guardarLote_(yo, d); }, rol: 'captura' },
  miCuenta: { fn: function (yo, d) { return miCuenta_(yo, d); } },
  totpIniciar: { fn: function (yo, d) { return totpIniciar_(yo, d); } },
  totpConfirmar: { fn: function (yo, d) { return totpConfirmar_(yo, d); } },
  totpQuitar: { fn: function (yo, d) { return totpQuitar_(yo, d); } },
  generarOficio: { fn: function (yo, d) { return generarOficio_(yo, d); }, rol: 'captura' }
};

/** Acciones que este usuario puede usar. La página las consulta para mostrar
 *  solo lo que el servidor publicado ya sabe hacer (si es una versión vieja,
 *  lo nuevo no aparece en vez de tronar). No decide permisos: eso es api(). */
function accionesDe_(yo) {
  return Object.keys(ACCIONES_).filter(function (k) {
    var a = ACCIONES_[k];
    return (!a.rol || tieneRol_(yo, a.rol)) && (!a.permiso || a.permiso(yo));
  });
}

/**
 * Toma el candado del script y lo anota en MEMO_, para que lo que se llama
 * adentro (como bitacora_) sepa que ya está protegido y no lo pida otra vez.
 *  intentar = true → no espera más de «ms»: devuelve null si no se pudo.
 */
function candado_(ms, intentar) {
  var lock = LockService.getScriptLock();
  if (intentar) {
    if (!lock.tryLock(ms)) return null;
  } else {
    try { lock.waitLock(ms); } catch (e) {
      throw falla_('OCUPADO', 'El sistema está ocupado guardando otros cambios. Espera unos segundos e intenta de nuevo.');
    }
  }
  MEMO_.candado = (MEMO_.candado || 0) + 1;
  // Lo leído antes del candado puede estar viejo: Config y Usuarios se vuelven a leer.
  MEMO_.cfg = null;
  MEMO_.usr = null;
  return lock;
}

function enCandado_() { return (MEMO_.candado || 0) > 0; }

/**
 * Suelta el candado DESPUÉS de mandar a la hoja todo lo escrito (flush), para
 * que quien tome el candado enseguida lea las filas nuevas (patrón que recomienda
 * Google). Así nunca se repite un consecutivo aunque guarden al mismo tiempo.
 * También aquí (después del flush, nunca antes) se da por vieja la caché de Registros.
 */
function soltar_(lock) {
  try { SpreadsheetApp.flush(); } catch (e) { console.error('flush: ' + (e && e.message)); }
  try { publicarCambiosRegistros_(); } catch (e2) { console.error('caché: ' + (e2 && e2.message)); }
  MEMO_.candado = Math.max(0, (MEMO_.candado || 0) - 1);
  lock.releaseLock();
}

function falla_(codigo, mensaje, extra) {
  var e = new Error(mensaje);
  e.codigo = codigo;
  e.extra = extra;
  return e;
}

/* ═══════════════════════════ Sesión y contraseñas ═════════════════════ */

function estadoPublico_() {
  var cfg = config_();
  var m = mantenimiento_(cfg);
  return { encabezados: [cfg.encabezado_1, cfg.encabezado_2, cfg.encabezado_3].filter(Boolean), version: VERSION,
    mantenimiento: m.activo ? { activo: true, mensaje: m.mensaje } : { activo: false } };
}

function abrirSesion_(o) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('ses:' + token, JSON.stringify({ u: o.usuario, s: o.sello, t: Date.now() }), SESION_SEG);
  return token;
}

/** Devuelve el usuario de la sesión o lanza SESION. Revisa en la hoja que siga activo. */
function sesion_(token, sinRenovar) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw falla_('SESION', 'Tu sesión terminó. Vuelve a entrar.');
  var cache = CacheService.getScriptCache();
  var raw = cache.get('ses:' + token);
  if (!raw) throw falla_('SESION', 'Tu sesión terminó. Vuelve a entrar.');
  var s = JSON.parse(raw);
  var u = buscarUsuario_(s.u);
  if (!u || u.activo !== 'SI' || u.sello !== s.s) {
    cache.remove('ses:' + token);
    throw falla_('SESION', 'Tu sesión terminó. Vuelve a entrar.');
  }
  if (!sinRenovar && Date.now() - s.t > 5 * 60 * 1000) {  // renueva la ventana de inactividad
    s.t = Date.now();
    cache.put('ses:' + token, JSON.stringify(s), SESION_SEG);
  }
  return yoDe_(u);
}

/** El usuario tal como lo usan las acciones (rol, libretas y permisos). */
function yoDe_(u) {
  return {
    usuario: u.usuario, nombre: u.nombre, rol: u.rol, debe_cambiar: u.debe_cambiar === 'SI',
    tipos: tiposDeUsuario_(u), informes: u.rol === 'admin' || u.informes === 'SI',
    dosPasos: !!u.totp, correo: u.correo || ''
  };
}

/** Libretas que puede ver un usuario según su fila de la pestaña Usuarios. */
function tiposDeUsuario_(u) {
  return u.rol === 'admin' || u.tipos === '*' ? ORDEN_TIPOS.slice() :
    String(u.tipos || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return TIPOS[x]; });
}

function salir_(yo, d, token) {
  CacheService.getScriptCache().remove('ses:' + token);
  bitacora_(yo.usuario, 'salir', '', '');
  return true;
}

/** El usuario (fila de la pestaña Usuarios). Se lee una vez por petición; al escribir en Usuarios o tomar el candado se vuelve a leer. */
function buscarUsuario_(usuario) {
  if (!MEMO_.usr) MEMO_.usr = tabla_(HOJAS.USR).filas;
  for (var i = 0; i < MEMO_.usr.length; i++) if (MEMO_.usr[i].o.usuario === usuario) return MEMO_.usr[i].o;
  return null;
}

function tieneRol_(yo, minimo) {
  var nivel = { consulta: 1, captura: 2, admin: 3 };
  return (nivel[yo.rol] || 0) >= nivel[minimo];
}

function puedeTipo_(yo, tipo) {
  if (!TIPOS[tipo]) throw falla_('DATOS', 'Tipo de documento desconocido.');
  if (yo.tipos.indexOf(tipo) < 0) throw falla_('PERMISO', 'No tienes acceso a ' + TIPOS[tipo].nombre + '.');
}

/* ═══════════════════════════ Inicio y catálogos ═══════════════════════ */

function inicio_(yo) {
  var cfg = config_();
  var regs = tablaLectura_(HOJAS.REG).filas;
  var anioActual = Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
  var anios = {}, conteos = {}, elaboro = {};
  anios[anioActual] = true;
  regs.forEach(function (f) {
    var r = f.o;
    if (yo.tipos.indexOf(r.tipo) < 0) return;
    anios[r.anio] = true;
    if (Number(r.anio) === anioActual) conteos[r.tipo] = (conteos[r.tipo] || 0) + 1;
    if (r.elaboro) elaboro[r.elaboro] = (elaboro[r.elaboro] || 0) + 1;
  });
  var tipos = {};
  yo.tipos.forEach(function (k) { tipos[k] = TIPOS[k]; });
  return {
    yo: { usuario: yo.usuario, nombre: yo.nombre, rol: yo.rol, rolNombre: ROLES[yo.rol], tipos: yo.tipos, dosPasos: yo.dosPasos, correo: yo.correo },
    tipos: tipos, orden: yo.tipos, estatus: ESTATUS, roles: ROLES, todosTipos: TIPOS,
    config: configPublica_(cfg, yo),
    anioActual: anioActual,
    anios: Object.keys(anios).map(Number).sort(function (a, b) { return b - a; }),
    conteos: conteos,
    sugerenciasElaboro: Object.keys(elaboro).sort(function (a, b) { return elaboro[b] - elaboro[a]; }).slice(0, 60),
    indicadores: indicadores_(yo, regs),
    directorio: directorioActivo_(),
    acciones: accionesDe_(yo),
    maxVarios: MAX_VARIOS,
    mantenimiento: mantenimiento_(cfg),
    version: VERSION
  };
}

/** Lo de Config que necesita la página (sin nada que solo deba ver el dueño). */
function configPublica_(cfg, yo) {
  var c = {
    encabezados: [cfg.encabezado_1, cfg.encabezado_2, cfg.encabezado_3].filter(Boolean),
    plantilla_OFS: cfg.plantilla_OFS, plazo_dias: cfg.plazo_dias, url_web: cfg.url_web || '',
    dias_inhabiles: diasInhabiles_(cfg), acuse_desde: fechaValida_(String(cfg.acuse_desde || '')) ? cfg.acuse_desde : '',
    plantillaDoc: !!idPlantillaDoc_(cfg)
  };
  if (yo && yo.rol === 'admin') {
    c.avisos_correo = cfg.avisos_correo === 'SI' ? 'SI' : 'NO';
    c.avisos_detalle = cfg.avisos_detalle === 'SI' ? 'SI' : 'NO';
    c.dos_pasos_admin = cfg.dos_pasos_admin === 'SI' ? 'SI' : 'NO';
    c.plantilla_doc_OFS = cfg.plantilla_doc_OFS || '';
  }
  return c;
}

/** Días inhábiles de Configuración: ['AAAA-MM-DD', …] ordenados y sin repetir. */
function diasInhabiles_(cfg) {
  var vistos = {};
  (String((cfg || config_()).dias_inhabiles || '').match(/\d{4}-\d{2}-\d{2}/g) || []).forEach(function (d) { if (fechaValida_(d)) vistos[d] = true; });
  return Object.keys(vistos).sort();
}

/** ¿Este registro cuenta para «sin acuse»? (OFS sin acuse, no cancelado, y desde la fecha de corte si la hay) */
function cuentaSinAcuse_(r, corte) {
  return r.tipo === 'OFS' && r.acuse !== 'SI' && r.estatus !== 'Cancelado' && (!corte || String(r.fecha || '') >= corte);
}

/** Números de las tarjetas del portal: por libreta y en total (solo libretas propias). */
function indicadores_(yo, regs) {
  regs = regs || tablaLectura_(HOJAS.REG).filas;
  var cfg = config_();
  var corte = fechaValida_(String(cfg.acuse_desde || '')) ? cfg.acuse_desde : '';
  var hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  var anio = Number(hoy.slice(0, 4)), mes = hoy.slice(0, 7);
  var porTipo = {}, global = { porAtender: 0, vencidos: 0, venceHoy: 0, sinAcuse: 0 };
  var mios = { total: 0, porAtender: 0, vencidos: 0, venceHoy: 0 };   // «Mis asuntos»
  yo.tipos.forEach(function (t) { porTipo[t] = { total: 0, porAtender: 0, vencidos: 0, venceHoy: 0, sinAcuse: 0, esteMes: 0, mios: 0 }; });
  regs.forEach(function (f) {
    var r = f.o, p = porTipo[r.tipo];
    if (!p) return;   // libretas que no tiene: no cuentan aunque se las hayan turnado
    var activo = r.estatus === 'Pendiente' || r.estatus === 'En trámite';
    if (activo) {
      p.porAtender++; global.porAtender++;
      if (r.fecha_limite && r.fecha_limite < hoy) { p.vencidos++; global.vencidos++; }
      else if (r.fecha_limite === hoy) { p.venceHoy++; global.venceHoy++; }
    }
    if (r.turnado_usuario && r.turnado_usuario === yo.usuario && r.estatus !== 'Cancelado') {
      mios.total++;
      p.mios++;
      if (activo) {
        mios.porAtender++;
        if (r.fecha_limite && r.fecha_limite < hoy) mios.vencidos++;
        else if (r.fecha_limite === hoy) mios.venceHoy++;
      }
    }
    // global.sinAcuse = la sección "sin acuse" de Pendientes (sin repetir lo que ya está por atender)
    if (cuentaSinAcuse_(r, corte) && !activo && Number(r.anio) >= anio - 1) global.sinAcuse++;
    if (Number(r.anio) === anio) {
      p.total++;
      if (cuentaSinAcuse_(r, corte)) p.sinAcuse++;   // igual que el indicador de la libreta
      if (String(r.fecha_recepcion || r.fecha).slice(0, 7) === mes) p.esteMes++;
    }
  });
  return { porTipo: porTipo, global: global, mios: mios, hoy: hoy, acuseDesde: corte };
}

function directorioActivo_() {
  return tabla_(HOJAS.DIR).filas.filter(function (f) { return f.o.activo === 'SI'; })
    .map(function (f) { return { id: f.o.id, nombre: f.o.nombre, cargo: f.o.cargo, dependencia: f.o.dependencia }; })
    .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
}

/* ═══════════════════════════ Registros ════════════════════════════════ */

var CAMPOS_LISTA = ['id', 'tipo', 'anio', 'consecutivo', 'sufijo', 'numero', 'asunto', 'dirigido_id', 'dirigido_a', 'firma_id', 'firma',
  'fecha', 'fecha_recepcion', 'elaboro', 'acuse', 'carpeta', 'estatus', 'fecha_limite', 'turnado_a', 'relacionado_id',
  'turnado_usuario'];

function resumen_(r) {
  var o = {};
  CAMPOS_LISTA.forEach(function (c) { o[c] = r[c]; });
  o.asunto = corta_(r.asunto, 300);
  o.obs = corta_(r.observaciones, 200);
  o.tiene_archivo = !!r.archivo_id;
  o.tiene_acuse_archivo = !!r.acuse_archivo_id;
  return o;
}

function ordenLista_(a, b) { return b.consecutivo - a.consecutivo || (b.sufijo > a.sufijo ? 1 : -1); }

function listar_(yo, d) {
  var tipo = String(d.tipo || '');
  puedeTipo_(yo, tipo);
  var anio = Number(d.anio) || Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
  return tablaLectura_(HOJAS.REG).filas
    .filter(function (f) { return f.o.tipo === tipo && Number(f.o.anio) === anio; })
    .map(function (f) { return resumen_(f.o); })
    .sort(ordenLista_);
}

/** Las listas del año de TODAS las libretas del usuario en una sola vuelta (la página las precarga). */
function listarTodo_(yo) {
  var anio = Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
  var listas = {};
  yo.tipos.forEach(function (t) { listas[t] = []; });
  tablaLectura_(HOJAS.REG).filas.forEach(function (f) {
    if (listas[f.o.tipo] && Number(f.o.anio) === anio) listas[f.o.tipo].push(resumen_(f.o));
  });
  Object.keys(listas).forEach(function (t) { listas[t].sort(ordenLista_); });
  return { anio: anio, listas: listas };
}

function obtener_(yo, d) {
  var t = tablaLectura_(HOJAS.REG);
  var f = buscarRegistro_(t, d.id);
  puedeTipo_(yo, f.o.tipo);
  var r = nombreTurno_(publico_(f.o));
  return { registro: r, ligados: ligados_(yo, t.filas, r), historial: historial_(f.o.id, 100) };
}

/** Nombre de la persona a quien se turnó (para mostrarlo en el panel). */
function nombreTurno_(r) {
  if (r.turnado_usuario) {
    var tu = buscarUsuario_(r.turnado_usuario);
    r.turnado_nombre = tu ? tu.nombre : r.turnado_usuario;
  }
  return r;
}

/** Registros ligados (responde a / respondido con) que el usuario puede ver. */
function ligados_(yo, filas, r) {
  return filas.filter(function (x) {
    return x.o.id !== r.id && (x.o.relacionado_id === r.id || x.o.id === r.relacionado_id) && yo.tipos.indexOf(x.o.tipo) >= 0;
  }).map(function (x) { return resumen_(x.o); });
}

/**
 * Movimientos de un registro en la bitácora, del más reciente al más viejo.
 * No lee toda la bitácora (crece todos los días): busca el ID solo en la
 * columna registro_id y lee únicamente esos renglones.
 */
function historial_(id, max) {
  id = String(id || '');
  var sh = hoja_(HOJAS.BIT), cols = COLS[HOJAS.BIT];
  revisarEncabezados_(sh, HOJAS.BIT);
  var n = sh.getLastRow();
  if (!id || n < 2) return [];
  var col = cols.indexOf('registro_id') + 1;
  var filas = sh.getRange(2, col, n - 1, 1).createTextFinder(id).matchCase(true).matchEntireCell(true).findAll()
    .map(function (r) { return r.getRow(); })
    .sort(function (a, b) { return a - b; })
    .slice(-max);
  var out = [];
  // Renglones seguidos se leen juntos
  for (var i = 0; i < filas.length; ) {
    var j = i;
    while (j + 1 < filas.length && filas[j + 1] === filas[j] + 1) j++;
    sh.getRange(filas[i], 1, j - i + 1, cols.length).getValues().forEach(function (v) {
      var o = {};
      for (var c = 0; c < cols.length; c++) o[cols[c]] = leerValor_(v[c], false);
      if (o.registro_id === id) out.push(o);
    });
    i = j + 1;
  }
  return out.reverse();
}

/**
 * Guardar, cancelar y mover archivos regresan además lo que muestra el panel
 * del registro (ligados e historial), para que la página no tenga que pedirlo
 * en otra vuelta. Se arma ya sin el candado. Si algo falla aquí, el cambio
 * ya quedó guardado y la página pide el detalle por separado.
 */
function conDetalle_(fn) {
  return function (yo, d, token) {
    var res = fn(yo, d, token);
    if (res && res.registro && res.registro.id) {
      try {
        SpreadsheetApp.flush();
        nombreTurno_(res.registro);
        res.detalle = { ligados: ligados_(yo, MEMO_.filasReg || tabla_(HOJAS.REG).filas, res.registro), historial: historial_(res.registro.id, 100) };
      } catch (e) {
        console.warn('detalle tras guardar: ' + e.message);
      }
    }
    return res;
  };
}

/** Lo que sí puede ver el navegador de un registro (sin IDs de Drive). */
function publico_(r) {
  var o = {};
  COLS.Registros.forEach(function (c) { o[c] = r[c]; });
  o.tiene_archivo = !!r.archivo_id;
  o.tiene_acuse_archivo = !!r.acuse_archivo_id;
  delete o.archivo_id;
  delete o.acuse_archivo_id;
  return o;
}

function buscarRegistro_(t, id) {
  id = String(id || '');
  for (var i = 0; i < t.filas.length; i++) if (t.filas[i].o.id === id) return t.filas[i];
  throw falla_('NO_EXISTE', 'Ese registro no existe.');
}

var EDITABLES = ['numero', 'asunto', 'dirigido_id', 'dirigido_a', 'firma_id', 'firma', 'area', 'fecha', 'fecha_recepcion',
  'elaboro', 'acuse', 'carpeta', 'observaciones', 'estatus', 'fecha_limite', 'turnado_a', 'relacionado_id'];

/** Registro vacío con todas las columnas. */
function registroNuevo_(yo, tipo, anio, consecutivo, limpio, ahora) {
  var r = {};
  COLS.Registros.forEach(function (c) { r[c] = ''; });
  r.id = 'r' + Utilities.getUuid().replace(/-/g, '').slice(0, 15);
  r.tipo = tipo;
  r.anio = anio;
  r.consecutivo = consecutivo;
  EDITABLES.forEach(function (c) { r[c] = limpio[c]; });
  r.turnado_usuario = limpio.turnado_usuario || '';
  ajustarAtencion_(r, '');
  if (TIPOS[tipo].numeroAuto) r.numero = numeroOficial_(tipo, consecutivo, '', anio);
  r.creado_por = yo.usuario;
  r.creado_en = ahora;
  r.modificado_por = yo.usuario;
  r.modificado_en = ahora;
  r.version = 1;
  r.origen = 'App';
  return r;
}

function maxConsecutivo_(t, tipo, anio) {
  var max = 0;
  t.filas.forEach(function (f) {
    if (f.o.tipo === tipo && Number(f.o.anio) === anio) max = Math.max(max, Number(f.o.consecutivo) || 0);
  });
  return max;
}

function guardar_(yo, d) {
  var tipo = String(d.tipo || '');
  var nuevo = !d.id;
  var limpio = validarRegistro_(d, tipo);
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.REG);
    var ahora = sello_(new Date());
    var r;
    var revisarRelacion = function () {
      if (limpio.relacionado_id && !t.filas.some(function (x) { return x.o.id === limpio.relacionado_id && x.o.id !== d.id; })) {
        limpio.relacionado_id = '';   // solo se liga a registros que existen (y no consigo mismo)
      }
    };
    if (nuevo) {
      puedeTipo_(yo, tipo);
      if (limpio.estatus === 'Cancelado' && yo.rol !== 'admin') throw falla_('PERMISO', 'Solo un administrador puede cancelar un registro.');
      revisarRelacion();
      if (limpio.turnado_usuario) validarTurno_(limpio.turnado_usuario, tipo);
      var anio = Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
      revisarDuplicado_(t, tipo, anio, limpio.numero, null, d.confirmarDuplicado);
      r = registroNuevo_(yo, tipo, anio, maxConsecutivo_(t, tipo, anio) + 1, limpio, ahora);
      escribirFila_(t.sh, HOJAS.REG, t.sh.getLastRow() + 1, r);
      // «Duplicar»: se anota de cuál registro salió la copia (solo si existe y es de la misma libreta)
      var copia = d.copia_de ? t.filas.filter(function (x) { return x.o.id === String(d.copia_de) && x.o.tipo === tipo; })[0] : null;
      bitacora_(yo.usuario, 'alta', r.id, TIPOS[tipo].singular + ' ' + etiquetaNum_(r) + (copia ? ' (copia de ' + etiquetaNum_(copia.o) + ')' : '') + ': ' + corta_(r.asunto, 120));
      if (r.turnado_usuario) {
        bitacora_(yo.usuario, 'turno', r.id, textoTurno_('', r.turnado_usuario));
        avisarTurno_(yo, r.turnado_usuario, [r]);
      }
    } else {
      var f = buscarRegistro_(t, d.id);
      r = f.o;
      puedeTipo_(yo, r.tipo);
      if (r.estatus === 'Cancelado' && yo.rol !== 'admin') {
        throw falla_('PERMISO', 'Este registro está cancelado. Solo un administrador puede modificarlo.');
      }
      limpio = validarRegistro_(d, r.tipo);   // se valida con la libreta del registro, no con la que mande el navegador
      revisarRelacion();
      if (Number(d.version) !== Number(r.version)) {
        throw falla_('CAMBIO', 'Alguien más modificó este registro mientras lo editabas. Ciérralo y vuelve a abrirlo para ver los cambios.');
      }
      if (limpio.estatus === 'Cancelado' && r.estatus !== 'Cancelado' && yo.rol !== 'admin') {
        throw falla_('PERMISO', 'Solo un administrador puede cancelar un registro.');
      }
      revisarDuplicado_(t, r.tipo, Number(r.anio), limpio.numero, r.id, d.confirmarDuplicado);
      // Turno a una persona del sistema. Si la página no lo manda (una página
      // de versión anterior), se conserva el que ya tenía.
      var turnoAntes = r.turnado_usuario || '';
      var turnoNuevo = limpio.turnado_usuario === undefined ? turnoAntes : limpio.turnado_usuario;
      if (turnoNuevo && turnoNuevo !== turnoAntes) validarTurno_(turnoNuevo, r.tipo);
      var cambios = [], estatusAntes = r.estatus;
      EDITABLES.forEach(function (c) {
        if (TIPOS[r.tipo].numeroAuto && c === 'numero') return;
        if (String(r[c]) !== String(limpio[c])) {
          if (c.slice(-3) !== '_id') cambios.push(c + ': «' + corta_(r[c], 60) + '» → «' + corta_(limpio[c], 60) + '»');
          r[c] = limpio[c];
        }
      });
      var cambioTurno = turnoNuevo !== turnoAntes;
      if (!cambios.length && !cambioTurno) return { registro: publico_(r), sinCambios: true };
      r.turnado_usuario = turnoNuevo;
      ajustarAtencion_(r, estatusAntes);
      r.modificado_por = yo.usuario;
      r.modificado_en = ahora;
      r.version = Number(r.version) + 1;
      escribirFila_(t.sh, HOJAS.REG, f.fila, r);
      if (cambios.length) bitacora_(yo.usuario, 'edición', r.id, cambios.join(' · '));
      if (cambioTurno) {
        bitacora_(yo.usuario, 'turno', r.id, textoTurno_(turnoAntes, turnoNuevo));
        if (turnoNuevo) avisarTurno_(yo, turnoNuevo, [r]);
      }
    }
    // "Responder": deja el original como Atendido
    if (nuevo && d.marcarAtendido && r.relacionado_id) {
      var orig = t.filas.filter(function (x) { return x.o.id === r.relacionado_id; })[0];
      if (orig && yo.tipos.indexOf(orig.o.tipo) >= 0 && ['', 'Pendiente', 'En trámite'].indexOf(orig.o.estatus) >= 0) {
        var antesOrig = orig.o.estatus;
        orig.o.estatus = 'Atendido';
        ajustarAtencion_(orig.o, antesOrig);
        orig.o.modificado_por = yo.usuario;
        orig.o.modificado_en = ahora;
        orig.o.version = Number(orig.o.version) + 1;
        escribirFila_(t.sh, HOJAS.REG, orig.fila, orig.o);
        bitacora_(yo.usuario, 'edición', orig.o.id, 'estatus → «Atendido» (respondido con ' + TIPOS[r.tipo].singular + ' ' + etiquetaNum_(r) + ')');
      }
    }
    return { registro: publico_(r) };
  } finally {
    soltar_(lock);
  }
}

/**
 * Limpia y valida lo que manda el navegador para un registro.
 * idsDirectorio (opcional): mapa de IDs del directorio ya leído, para no leer
 * la pestaña una vez por registro cuando se guardan varios.
 */
/**
 * Fecha de atención: se pone (hoy) cuando el registro PASA a Atendido o
 * Concluido, y se borra si regresa a Pendiente o En trámite. Entre Atendido
 * y Concluido se conserva la primera. La usa Informes («atendido a tiempo»).
 */
function ajustarAtencion_(r, estatusAntes) {
  var ahora = CERRADOS.indexOf(r.estatus) >= 0, antes = CERRADOS.indexOf(estatusAntes) >= 0;
  if (ahora && !antes) r.fecha_atencion = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  else if (!ahora && r.estatus !== 'Cancelado') r.fecha_atencion = '';
}

function validarRegistro_(d, tipo, idsDirectorio) {
  if (!TIPOS[tipo]) throw falla_('DATOS', 'Tipo de documento desconocido.');
  var o = {};
  var texto = function (c, max) {
    var v = d[c] === undefined || d[c] === null ? '' : String(d[c]);
    v = v.replace(/\r/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (v.length > max) throw falla_('DATOS', 'El campo «' + c + '» es demasiado largo (máximo ' + max + ' caracteres).');
    return v;
  };
  o.numero = texto('numero', 150);
  o.asunto = texto('asunto', 3000);
  o.dirigido_a = texto('dirigido_a', 600);
  o.firma = texto('firma', 600);
  o.area = texto('area', 400);
  o.elaboro = texto('elaboro', 120);
  o.carpeta = texto('carpeta', 40);
  o.observaciones = texto('observaciones', 6000);
  o.turnado_a = texto('turnado_a', 300);
  o.dirigido_id = texto('dirigido_id', 20);
  o.firma_id = texto('firma_id', 20);
  o.relacionado_id = texto('relacionado_id', 40);
  ['fecha', 'fecha_recepcion', 'fecha_limite'].forEach(function (c) {
    var v = texto(c, 10);
    if (v && !fechaValida_(v)) throw falla_('DATOS', 'La fecha «' + v + '» no es válida.');
    o[c] = v;
  });
  o.acuse = d.acuse === true || d.acuse === 'SI' ? 'SI' : 'NO';
  o.estatus = texto('estatus', 20);
  if (o.estatus && ESTATUS.indexOf(o.estatus) < 0) throw falla_('DATOS', 'Estatus desconocido.');
  if (!o.asunto) throw falla_('DATOS', 'Falta el asunto.');
  if (!o.fecha) throw falla_('DATOS', 'Falta la fecha.');
  // Turno a una persona del sistema (usuario). undefined = la página no lo
  // mandó (versión anterior): al editar se conserva el que ya tenía.
  if (d.turnado_usuario !== undefined && d.turnado_usuario !== null) {
    o.turnado_usuario = texto('turnado_usuario', 30).toLowerCase();
    if (o.turnado_usuario && !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(o.turnado_usuario)) throw falla_('DATOS', 'Usuario para turnar inválido.');
  }
  // Los IDs del directorio deben existir; si no, se borran (queda el texto)
  if (o.dirigido_id || o.firma_id) {
    var ids = idsDirectorio;
    if (!ids) {
      ids = {};
      tabla_(HOJAS.DIR).filas.forEach(function (f) { ids[f.o.id] = true; });
    }
    if (o.dirigido_id && !ids[o.dirigido_id]) o.dirigido_id = '';
    if (o.firma_id && !ids[o.firma_id]) o.firma_id = '';
  }
  // Solo se guardan los campos que tiene esta libreta
  var propios = {};
  TIPOS[tipo].campos.forEach(function (c) { propios[c[0]] = true; });
  if (!propios.dirigido) { o.dirigido_a = ''; o.dirigido_id = ''; }
  if (!propios.firma) { o.firma = ''; o.firma_id = ''; }
  ['numero', 'area', 'fecha_recepcion', 'elaboro', 'acuse', 'carpeta'].forEach(function (c) {
    if (!propios[c]) o[c] = c === 'acuse' ? 'NO' : '';
  });
  return o;
}

function fechaValida_(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  var p = v.split('-').map(Number);
  var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return p[0] >= 2000 && p[0] <= 2100 && dt.getUTCMonth() === p[1] - 1 && dt.getUTCDate() === p[2];
}

function normalNumero_(s) { return String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-'); }

function revisarDuplicado_(t, tipo, anio, numero, idPropio, confirmado) {
  if (!numero || TIPOS[tipo].numeroAuto || confirmado) return;
  var n = normalNumero_(numero);
  var otro = t.filas.filter(function (f) {
    return f.o.id !== idPropio && f.o.tipo === tipo && Number(f.o.anio) === anio && normalNumero_(f.o.numero) === n;
  })[0];
  if (otro) {
    throw falla_('DUPLICADO', 'Ya hay un registro con el número ' + numero + ' en ' + TIPOS[tipo].nombre +
      ' (consecutivo ' + etiquetaNum_(otro.o) + '). ¿Seguro que no es el mismo documento?', { id: otro.o.id });
  }
}

function numeroOficial_(tipo, consec, sufijo, anio) {
  var plantilla = config_()['plantilla_' + tipo] || '';
  if (!plantilla) return '';
  var n = ('00' + consec).slice(-Math.max(3, String(consec).length)) + (sufijo ? ' ' + sufijo : '');
  return plantilla.replace('{NNN}', n).replace('{AAAA}', String(anio));
}

function etiquetaNum_(r) {
  return ('00' + r.consecutivo).slice(-Math.max(3, String(r.consecutivo).length)) + (r.sufijo ? ' ' + r.sufijo : '') + '/' + r.anio;
}

function cancelar_(yo, d) {
  var motivo = String(d.motivo || '').trim();
  if (motivo.length < 5) throw falla_('DATOS', 'Escribe el motivo de la cancelación.');
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.REG);
    var f = buscarRegistro_(t, d.id);
    if (Number(d.version) !== Number(f.o.version)) throw falla_('CAMBIO', 'El registro cambió mientras lo veías. Vuelve a abrirlo.');
    f.o.estatus = 'Cancelado';
    f.o.motivo_cancelacion = corta_(motivo, 500);
    f.o.modificado_por = yo.usuario;
    f.o.modificado_en = sello_(new Date());
    f.o.version = Number(f.o.version) + 1;
    escribirFila_(t.sh, HOJAS.REG, f.fila, f.o);
    bitacora_(yo.usuario, 'cancelación', f.o.id, 'Motivo: ' + f.o.motivo_cancelacion);
    return { registro: publico_(f.o) };
  } finally {
    soltar_(lock);
  }
}

function pendientes_(yo) {
  var anio = Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
  var cfg = config_(), corte = fechaValida_(String(cfg.acuse_desde || '')) ? cfg.acuse_desde : '';
  var porAtender = [], sinAcuse = [];
  tablaLectura_(HOJAS.REG).filas.forEach(function (f) {
    var r = f.o;
    if (yo.tipos.indexOf(r.tipo) < 0) return;
    if (r.estatus === 'Pendiente' || r.estatus === 'En trámite') porAtender.push(resumen_(r));
    else if (cuentaSinAcuse_(r, corte) && Number(r.anio) >= anio - 1) sinAcuse.push(resumen_(r));
  });
  porAtender.sort(function (a, b) {
    return (a.fecha_limite || '9999') < (b.fecha_limite || '9999') ? -1 : (a.fecha_limite || '9999') > (b.fecha_limite || '9999') ? 1 : 0;
  });
  sinAcuse.sort(function (a, b) { return (a.fecha || '') < (b.fecha || '') ? -1 : 1; });
  return { porAtender: porAtender, sinAcuse: sinAcuse, acuseDesde: corte };
}

/* ─────────── Varios destinatarios: el mismo oficio a varias personas ─────────── */

/**
 * Crea un oficio por destinatario, con el mismo asunto, firma, fecha y
 * elaboró. Todo dentro de UN solo candado: los consecutivos y números
 * oficiales salen seguidos (417, 418, 419…) aunque otra persona esté
 * guardando al mismo tiempo, y se escriben en una sola operación.
 *
 *  d.destinatarios = [{ dirigido_id, dirigido_a }, …]   (1 a MAX_VARIOS)
 *  d.previa = true  → no guarda nada: devuelve qué números tocarían
 *  d.desde  = consecutivo que vio la persona al confirmar; si ya cambió
 *             (alguien guardó en medio), no guarda y avisa (CAMBIO_NUMERO).
 */
function guardarVarios_(yo, d) {
  var tipo = String(d.tipo || '');
  if (!TIPOS[tipo]) throw falla_('DATOS', 'Tipo de documento desconocido.');
  if (!TIPOS[tipo].numeroAuto) throw falla_('DATOS', '«Varios destinatarios» solo es para ' + TIPOS.OFS.nombre.toLowerCase() + '.');
  puedeTipo_(yo, tipo);
  var lista = Array.isArray(d.destinatarios) ? d.destinatarios : [];
  if (!lista.length) throw falla_('DATOS', 'Elige al menos un destinatario.');
  if (lista.length > MAX_VARIOS) throw falla_('DATOS', 'Son ' + lista.length + ' destinatarios; el máximo por vez es ' + MAX_VARIOS + '.');
  var comun = {};
  Object.keys(d).forEach(function (k) {
    if (['destinatarios', 'previa', 'desde', 'id', 'version', 'relacionado_id', 'marcarAtendido'].indexOf(k) < 0) comun[k] = d[k];
  });
  var ids = {};
  tabla_(HOJAS.DIR).filas.forEach(function (f) { ids[f.o.id] = true; });
  var vistos = {};
  var limpios = lista.map(function (p, i) {
    p = p && typeof p === 'object' ? p : {};
    var x = {};
    Object.keys(comun).forEach(function (k) { x[k] = comun[k]; });
    x.dirigido_id = p.dirigido_id;
    x.dirigido_a = p.dirigido_a;
    var l = validarRegistro_(x, tipo, ids);
    if (!l.dirigido_a) throw falla_('DATOS', 'Al destinatario ' + (i + 1) + ' le falta el nombre.');
    var clave = l.dirigido_id || ('t:' + String(l.dirigido_a).split('\n')[0].toLowerCase().replace(/\s+/g, ' '));
    if (vistos[clave]) throw falla_('DATOS', 'Elegiste dos veces a «' + String(l.dirigido_a).split('\n')[0] + '».');
    vistos[clave] = true;
    l.relacionado_id = '';
    return l;
  });
  var base = limpios[0];
  if (base.estatus === 'Cancelado') throw falla_('DATOS', 'No se pueden dar de alta oficios ya cancelados.');
  if (base.turnado_usuario) validarTurno_(base.turnado_usuario, tipo);
  var anio = Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
  var n = limpios.length;
  var rango = function (max) {
    return { cuantos: n, consecutivoDesde: max + 1, desde: numeroOficial_(tipo, max + 1, '', anio), hasta: numeroOficial_(tipo, max + n, '', anio),
      numeros: limpios.map(function (l, i) { return { numero: numeroOficial_(tipo, max + 1 + i, '', anio), consecutivo: max + 1 + i, dirigido_a: l.dirigido_a }; }) };
  };
  if (d.previa) return rango(maxConsecutivo_(tablaLectura_(HOJAS.REG), tipo, anio));

  var lock = candado_(30000, true);
  if (!lock) throw falla_('OCUPADO', 'El sistema está ocupado guardando otros registros. Espera unos segundos e intenta de nuevo.');
  try {
    var t = tabla_(HOJAS.REG);
    var max = maxConsecutivo_(t, tipo, anio);
    // Siempre se guarda contra los números que la persona vio y confirmó
    if (d.desde === undefined || d.desde === null || d.desde === '' || !(Number(d.desde) > 0)) {
      throw falla_('DATOS', 'Falta confirmar los números: primero se pide la vista previa (previa: true) y luego se guarda con «desde».');
    }
    if (Number(d.desde) !== max + 1) {
      var r2 = rango(max);
      throw falla_('CAMBIO_NUMERO', 'Mientras confirmabas, alguien más registró un oficio. Ahora los números serían del ' + r2.desde + ' al ' + r2.hasta + '.', r2);
    }
    var ahora = sello_(new Date());
    var nuevos = limpios.map(function (l, i) { return registroNuevo_(yo, tipo, anio, max + 1 + i, l, ahora); });
    escribirBloque_(t.sh, HOJAS.REG, t.sh.getLastRow() + 1, nuevos);
    var primero = nuevos[0], ultimo = nuevos[n - 1];
    var entradas = [], txtTurno = base.turnado_usuario ? textoTurno_('', base.turnado_usuario) : '';
    nuevos.forEach(function (r) {
      entradas.push([yo.usuario, 'alta', r.id, TIPOS[tipo].singular + ' ' + etiquetaNum_(r) + ' (varios destinatarios, ' + n + '): ' +
        corta_(String(r.dirigido_a).split('\n')[0], 80) + ' · ' + corta_(r.asunto, 100)]);
      if (txtTurno) entradas.push([yo.usuario, 'turno', r.id, txtTurno]);
    });
    entradas.push([yo.usuario, 'alta múltiple', '', n + ' ' + (n === 1 ? TIPOS[tipo].singular.toLowerCase() : TIPOS[tipo].nombre.toLowerCase()) +
      ' con el mismo asunto: del ' + (primero.numero || etiquetaNum_(primero)) + ' al ' + (ultimo.numero || etiquetaNum_(ultimo)) + ' · ' + corta_(primero.asunto, 120)]);
    bitacoraVarias_(entradas);
    if (base.turnado_usuario) avisarTurno_(yo, base.turnado_usuario, nuevos);
    return { cuantos: n, desde: primero.numero, hasta: ultimo.numero, consecutivoDesde: primero.consecutivo,
      registros: nuevos.map(function (r) { return resumen_(r); }) };
  } finally {
    soltar_(lock);
  }
}

/* ─────────── Acciones en lote (1.7.0) ───────────
   Cambiar a la vez estatus, acuse, turno o fecha límite de muchos registros
   (por ejemplo, poner «Concluido» a los entrantes viejos de la migración o
   marcar el acuse de los oficios que ya lo tienen en papel). Solo toca esos
   campos: se lee la hoja dentro del candado y lo demás de cada registro se
   queda igual. Los cancelados no se tocan. Cada registro queda en la
   Bitácora («en lote») y además un resumen. */

var MAX_LOTE = 500;

function guardarLote_(yo, d) {
  var ids = Array.isArray(d.ids) ? d.ids.map(String).filter(function (x, i, a) { return x && a.indexOf(x) === i; }) : [];
  if (!ids.length) throw falla_('DATOS', 'No elegiste registros.');
  if (ids.length > MAX_LOTE) throw falla_('DATOS', 'Son ' + ids.length + ' registros; el máximo por vez es ' + MAX_LOTE + '.');
  var c = d.cambios && typeof d.cambios === 'object' ? d.cambios : {};
  var cambios = {};
  if (c.estatus !== undefined) {
    var est = String(c.estatus);
    if (est === 'Cancelado') throw falla_('DATOS', 'Para cancelar hay que escribir el motivo de cada registro: hazlo uno por uno.');
    if (est && ESTATUS.indexOf(est) < 0) throw falla_('DATOS', 'Estatus desconocido.');
    cambios.estatus = est;
  }
  if (c.acuse !== undefined) cambios.acuse = c.acuse === true || c.acuse === 'SI' ? 'SI' : 'NO';
  if (c.fecha_limite !== undefined) {
    var fl = String(c.fecha_limite || '');
    if (fl && !fechaValida_(fl)) throw falla_('DATOS', 'La fecha límite no es válida.');
    cambios.fecha_limite = fl;
  }
  if (c.turnado_usuario !== undefined) {
    var tu = String(c.turnado_usuario || '').trim().toLowerCase();
    if (tu && !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(tu)) throw falla_('DATOS', 'Usuario para turnar inválido.');
    cambios.turnado_usuario = tu;
  }
  var campos = Object.keys(cambios);
  if (!campos.length) throw falla_('DATOS', 'No dijiste qué cambiar.');
  var res = { cambiados: 0, sinCambio: 0, omitidos: [], registros: [] };
  var turnadosA = {};
  var lock = candado_(30000);
  try {
    var t = tabla_(HOJAS.REG), ahora = sello_(new Date());
    var porId = {};
    t.filas.forEach(function (f) { porId[f.o.id] = f; });
    var turnoValido = {};   // tipo → ¿se puede turnar a esa persona en esa libreta?
    var tocadas = [], entradas = [];
    ids.forEach(function (id) {
      var f = porId[id];
      if (!f) { res.omitidos.push({ id: id, motivo: 'no existe' }); return; }
      var r = f.o;
      if (yo.tipos.indexOf(r.tipo) < 0) { res.omitidos.push({ id: id, motivo: 'sin acceso a ' + TIPOS[r.tipo].nombre }); return; }
      if (r.estatus === 'Cancelado') { res.omitidos.push({ id: id, motivo: 'cancelado', num: etiquetaNum_(r) }); return; }
      var propios = {};
      TIPOS[r.tipo].campos.forEach(function (x) { propios[x[0]] = true; });
      if ('acuse' in cambios && !propios.acuse && campos.length === 1) { res.omitidos.push({ id: id, motivo: TIPOS[r.tipo].nombre + ' no lleva acuse', num: etiquetaNum_(r) }); return; }
      if (cambios.turnado_usuario && !(r.tipo in turnoValido)) {
        try { validarTurno_(cambios.turnado_usuario, r.tipo); turnoValido[r.tipo] = true; } catch (e) { turnoValido[r.tipo] = e.message; }
      }
      if (cambios.turnado_usuario && turnoValido[r.tipo] !== true) { res.omitidos.push({ id: id, motivo: turnoValido[r.tipo], num: etiquetaNum_(r) }); return; }
      var txt = [], estatusAntes = r.estatus, turnoAntes = r.turnado_usuario || '';
      campos.forEach(function (k) {
        if (k === 'acuse' && !propios.acuse) return;
        var nuevo = cambios[k];
        if (String(r[k] || '') === String(nuevo)) return;
        if (k !== 'turnado_usuario') txt.push(k + ': «' + corta_(r[k], 60) + '» → «' + corta_(nuevo, 60) + '»');
        r[k] = nuevo;
      });
      var cambioTurno = (r.turnado_usuario || '') !== turnoAntes;
      // Al turnar algo sin estatus, queda «Pendiente» (igual que en el formulario)
      if (cambioTurno && r.turnado_usuario && !r.estatus) { r.estatus = 'Pendiente'; txt.push('estatus: «» → «Pendiente»'); }
      if (!txt.length && !cambioTurno) { res.sinCambio++; return; }
      ajustarAtencion_(r, estatusAntes);
      r.modificado_por = yo.usuario;
      r.modificado_en = ahora;
      r.version = Number(r.version) + 1;
      tocadas.push(f);
      if (txt.length) entradas.push([yo.usuario, 'edición', r.id, txt.join(' · ') + ' (en lote)']);
      if (cambioTurno) {
        entradas.push([yo.usuario, 'turno', r.id, textoTurno_(turnoAntes, r.turnado_usuario) + ' (en lote)']);
        if (r.turnado_usuario) (turnadosA[r.turnado_usuario] = turnadosA[r.turnado_usuario] || []).push(r);
      }
      res.registros.push(resumen_(r));
    });
    res.cambiados = tocadas.length;
    if (tocadas.length) {
      escribirVarias_(t, HOJAS.REG, tocadas);
      var que = campos.map(function (k) {
        return { estatus: 'estatus «' + cambios.estatus + '»', acuse: 'acuse ' + (cambios.acuse === 'SI' ? 'sí' : 'no'),
          fecha_limite: 'fecha límite ' + (cambios.fecha_limite || '(sin fecha)'), turnado_usuario: cambios.turnado_usuario ? 'turno a ' + cambios.turnado_usuario : 'sin turno' }[k];
      }).join(', ');
      entradas.push([yo.usuario, 'edición en lote', '', tocadas.length + ' registro(s): ' + que + (res.omitidos.length ? ' · ' + res.omitidos.length + ' omitido(s)' : '')]);
      bitacoraVarias_(entradas);
    }
  } finally {
    soltar_(lock);
  }
  Object.keys(turnadosA).forEach(function (u) { avisarTurno_(yo, u, turnadosA[u]); });
  return res;
}

/* ─────────── Turnos a personas del sistema («Mis asuntos») ─────────── */

/** Solo se turna a usuarios activos que tengan acceso a esa libreta. */
function validarTurno_(usuario, tipo) {
  var u = buscarUsuario_(usuario);
  if (!u) throw falla_('DATOS', 'No existe el usuario «' + usuario + '» para turnarle el asunto.');
  if (u.activo !== 'SI') throw falla_('DATOS', 'No se puede turnar a ' + u.nombre + ': su cuenta está desactivada.');
  if (tiposDeUsuario_(u).indexOf(tipo) < 0) throw falla_('DATOS', 'No se puede turnar a ' + u.nombre + ': no tiene acceso a ' + TIPOS[tipo].nombre + '.');
}

function textoTurno_(antes, despues) {
  var nombre = function (u) { var x = buscarUsuario_(u); return u + (x ? ' (' + x.nombre + ')' : ''); };
  if (!antes) return 'Turnó a ' + nombre(despues);
  if (!despues) return 'Quitó el turno a ' + nombre(antes);
  return 'Cambió el turno de ' + nombre(antes) + ' a ' + nombre(despues);
}

/** Usuarios activos a quienes se puede turnar un asunto de esa libreta. */
function usuariosTurno_(yo, d) {
  var tipo = String(d.tipo || '');
  puedeTipo_(yo, tipo);
  return tabla_(HOJAS.USR).filas.map(function (f) { return f.o; })
    .filter(function (u) { return u.activo === 'SI' && tiposDeUsuario_(u).indexOf(tipo) >= 0; })
    .map(function (u) { return { usuario: u.usuario, nombre: u.nombre }; })
    .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
}

/** Lo turnado a mí, SOLO de las libretas que tengo (aunque me hayan turnado otras). */
function misAsuntos_(yo) {
  var hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  var lista = tablaLectura_(HOJAS.REG).filas
    .filter(function (f) { return f.o.turnado_usuario === yo.usuario && yo.tipos.indexOf(f.o.tipo) >= 0 && f.o.estatus !== 'Cancelado'; })
    .map(function (f) { return resumen_(f.o); });
  var activo = function (r) { return r.estatus === 'Pendiente' || r.estatus === 'En trámite'; };
  lista.sort(function (a, b) {
    var x = activo(a) ? 0 : 1, y = activo(b) ? 0 : 1;
    if (x !== y) return x - y;
    var la = a.fecha_limite || '9999', lb = b.fecha_limite || '9999';
    if (x === 0 && la !== lb) return la < lb ? -1 : 1;
    var fa = String(a.fecha_recepcion || a.fecha || ''), fb = String(b.fecha_recepcion || b.fecha || '');
    return fa === fb ? 0 : fa > fb ? -1 : 1;   // lo más reciente primero
  });
  return { asuntos: lista.slice(0, 400), total: lista.length, hoy: hoy };
}

/**
 * Exportación a Excel: SOLO administradores (ACCIONES_.exportar).
 * d.tipo: 'TODOS' o una libreta · d.desde / d.hasta: 'aaaa-mm-dd' (opcionales)
 * La fecha que cuenta es la de recibido; si no tiene, la del documento.
 * d.soloConteo: devuelve cuántos saldrían, sin los datos (para la vista previa).
 * d.anio: forma anterior (por año), se conserva por compatibilidad.
 */
function exportar_(yo, d) {
  var tipos = d.tipo === 'TODOS' ? yo.tipos : [String(d.tipo || '')];
  tipos.forEach(function (t) { puedeTipo_(yo, t); });
  var desde = String(d.desde || ''), hasta = String(d.hasta || '');
  if ((desde && !fechaValida_(desde)) || (hasta && !fechaValida_(hasta))) throw falla_('DATOS', 'Alguna de las fechas no es válida.');
  if (desde && hasta && desde > hasta) throw falla_('DATOS', 'La fecha inicial es posterior a la final.');
  var anio = null;
  if (d.anio !== undefined && d.anio !== null && d.anio !== '') {
    anio = Number(d.anio);
    if (!(anio >= 2000 && anio <= 2100)) throw falla_('DATOS', 'Año inválido.');
  }
  var porTipo = {}, sinFecha = 0, filas = [];
  tablaLectura_(HOJAS.REG).filas.forEach(function (f) {
    var r = f.o;
    if (tipos.indexOf(r.tipo) < 0) return;
    if (anio && Number(r.anio) !== anio) return;
    if (desde || hasta) {
      var fd = r.fecha_recepcion || r.fecha;
      if (!fd) { sinFecha++; return; }
      if ((desde && fd < desde) || (hasta && fd > hasta)) return;
    }
    porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1;
    if (!d.soloConteo) filas.push(publico_(r));
  });
  var total = filas.length || Object.keys(porTipo).reduce(function (s, k) { return s + porTipo[k]; }, 0);
  if (d.soloConteo) return { total: total, porTipo: porTipo, sinFecha: sinFecha };
  var que = d.tipo === 'TODOS' ? 'todas las libretas' : TIPOS[tipos[0]].nombre;
  var periodo = desde || hasta ? ' del ' + (desde || 'inicio') + ' al ' + (hasta || 'hoy') : (anio ? ' ' + anio : ' (todo)');
  bitacora_(yo.usuario, 'exportación', '', 'Excel de ' + que + periodo + ' (' + filas.length + ' registros)');
  return { filas: filas, porTipo: porTipo, sinFecha: sinFecha };
}

/* ─────────── Buscador general: todas MIS libretas a la vez ─────────── */

var MAX_BUSQUEDA = 50;

/** Sin acentos, en minúsculas y con un solo espacio (igual que el buscador de cada libreta). */
function normalizar_(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function buscar_(yo, d) {
  var q = normalizar_(d.q).slice(0, 100);
  var palabras = q.split(' ').filter(Boolean).slice(0, 8);
  if (q.replace(/ /g, '').length < 2) throw falla_('DATOS', 'Escribe al menos 2 letras o números.');
  var hallados = [];
  tablaLectura_(HOJAS.REG).filas.forEach(function (f) {
    var r = f.o;
    if (yo.tipos.indexOf(r.tipo) < 0) return;   // solo libretas propias
    var texto = normalizar_([etiquetaNum_(r), r.numero, r.asunto, r.dirigido_a, r.firma, r.observaciones,
      r.turnado_a, r.area, r.elaboro, r.carpeta].join(' '));
    for (var i = 0; i < palabras.length; i++) if (texto.indexOf(palabras[i]) < 0) return;
    hallados.push(r);
  });
  hallados.sort(function (a, b) {   // lo más reciente primero
    if (Number(b.anio) !== Number(a.anio)) return Number(b.anio) - Number(a.anio);
    var fa = String(a.fecha_recepcion || a.fecha || ''), fb = String(b.fecha_recepcion || b.fecha || '');
    if (fa !== fb) return fa > fb ? -1 : 1;
    return (Number(b.consecutivo) || 0) - (Number(a.consecutivo) || 0);
  });
  var porTipo = {};
  hallados.forEach(function (r) { (porTipo[r.tipo] = porTipo[r.tipo] || { total: 0, registros: [] }).total++; });
  hallados.slice(0, MAX_BUSQUEDA).forEach(function (r) { porTipo[r.tipo].registros.push(resumen_(r)); });
  return {
    total: hallados.length, mostrados: Math.min(hallados.length, MAX_BUSQUEDA), limite: MAX_BUSQUEDA,
    grupos: ORDEN_TIPOS.filter(function (t) { return porTipo[t]; }).map(function (t) {
      return { tipo: t, nombre: TIPOS[t].nombre, total: porTipo[t].total, registros: porTipo[t].registros };
    })
  };
}

/* ─────────── Modo mantenimiento ─────────── */

var MENSAJE_MANTENIMIENTO = 'El sistema está en mantenimiento. Vuelve a intentar en un rato.';

/** { activo, mensaje }. Se guarda en la pestaña Config y se recuerda 1 min en caché (se borra al cambiarlo). */
function mantenimiento_(cfg) {
  var cache = CacheService.getScriptCache();
  if (!cfg) {
    var guardado = cache.get('cfg:mant');
    if (guardado) { try { return JSON.parse(guardado); } catch (e) { /* se vuelve a leer */ } }
    cfg = config_();
  }
  var m = { activo: cfg.mantenimiento === 'SI', mensaje: String(cfg.mantenimiento_msg || '') || MENSAJE_MANTENIMIENTO };
  cache.put('cfg:mant', JSON.stringify(m), 60);
  return m;
}

function guardarMantenimiento_(yo, d) {
  var activo = d.activo === true || d.activo === 'SI';
  var msg = String(d.mensaje || '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (msg.length > 300) throw falla_('DATOS', 'El mensaje es muy largo (máximo 300 letras).');
  if (activo && msg.length < 5) throw falla_('DATOS', 'Escribe el mensaje que verá la gente (por ejemplo: «Estamos actualizando el sistema; regresa a las 3 de la tarde»).');
  var lock = candado_(20000);
  try {
    var antes = mantenimiento_(config_());
    var t = tabla_(HOJAS.CFG);
    var poner = function (clave, valor, desc) {
      var f = t.filas.filter(function (x) { return x.o.clave === clave; })[0];
      if (f) { f.o.valor = valor; escribirFila_(t.sh, HOJAS.CFG, f.fila, f.o); }
      else { escribirFila_(t.sh, HOJAS.CFG, t.sh.getLastRow() + 1, { clave: clave, valor: valor, descripcion: desc }); t = tabla_(HOJAS.CFG); }
    };
    poner('mantenimiento', activo ? 'SI' : 'NO', 'SI = solo los administradores pueden usar el sistema (se cambia en Configuración)');
    poner('mantenimiento_msg', msg, 'Mensaje que ve la gente mientras hay mantenimiento');
    CacheService.getScriptCache().remove('cfg:mant');
    var detalle = activo && !antes.activo ? 'Activó el modo mantenimiento: «' + msg + '»' :
      !activo && antes.activo ? 'Desactivó el modo mantenimiento' :
      activo ? 'Cambió el mensaje de mantenimiento: «' + msg + '»' : '';
    if (detalle) bitacora_(yo.usuario, 'mantenimiento', '', detalle);
    return mantenimiento_(config_());
  } finally {
    soltar_(lock);
  }
}

/** La página pregunta de vez en cuando si la sesión sigue viva o si entró el mantenimiento. */
function ping_() {
  return { version: VERSION, mantenimiento: mantenimiento_() };
}

/* ─────────── Respaldo descargable (Excel en el navegador) ─────────── */

function respaldo_(yo) {
  // Sin contraseñas, sellos de sesión ni secretos de dos pasos, y sin IDs de Drive (los escaneos se respaldan en Drive).
  var quitar = { Registros: ['archivo_id', 'acuse_archivo_id'], Usuarios: ['clave', 'sello', 'totp'] };
  var hojas = {}, cuentas = [];
  [HOJAS.REG, HOJAS.DIR, HOJAS.USR, HOJAS.BIT, HOJAS.CFG].forEach(function (n) {
    var cols = COLS[n].filter(function (c) { return (quitar[n] || []).indexOf(c) < 0; });
    var filas = tabla_(n).filas.map(function (f) {
      return cols.map(function (c) { var v = f.o[c]; return v === undefined || v === null ? '' : v; });
    });
    hojas[n] = { columnas: cols, filas: filas };
    cuentas.push(n + ' ' + filas.length);
  });
  bitacora_(yo.usuario, 'respaldo', '', 'Descargó el respaldo completo en Excel (' + cuentas.join(', ') + ')');
  return { generado: sello_(new Date()), version: VERSION, hojas: hojas };
}

/* ─────────── Informes (con gráficas en la página) ─────────── */

/**
 * Días hábiles de «a» a «b» (el mismo día = 0): lunes a viernes, sin los días
 * inhábiles de Configuración (festivos, vacaciones oficiales).
 */
function diasHabiles_(a, b, inhabiles) {
  if (!fechaValida_(a) || !fechaValida_(b)) return null;
  var d = function (s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
  var ini = d(a), fin = d(b);
  if (fin < ini) return -1;
  var fuera = {};
  (inhabiles || diasInhabiles_()).forEach(function (x) { fuera[x] = true; });
  var n = 0;
  for (var t = ini + 86400000; t <= fin; t += 86400000) {
    var dt = new Date(t), w = dt.getUTCDay();
    if (w !== 0 && w !== 6 && !fuera[dt.toISOString().slice(0, 10)]) n++;
  }
  return n;
}

/**
 * Números del periodo, solo de las libretas del usuario (y de las que elija).
 *  d = { desde: 'AAAA-MM-DD', hasta: 'AAAA-MM-DD', tipos: ['OFE', …], excel: true|false }
 * No cuenta registros cancelados. La fecha de cada registro es la de recepción
 * (o la del documento, si no tiene).
 */
function informes_(yo, d) {
  var hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  var desde = String(d.desde || ''), hasta = String(d.hasta || '');
  if (!fechaValida_(desde) || !fechaValida_(hasta)) throw falla_('DATOS', 'Elige el periodo: fecha «desde» y fecha «hasta».');
  if (desde > hasta) throw falla_('DATOS', 'La fecha «desde» es posterior a «hasta».');
  if (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4)) > 5) throw falla_('DATOS', 'El periodo puede ser de hasta 6 años.');
  var pedidos = Array.isArray(d.tipos) && d.tipos.length ? d.tipos.map(String) : yo.tipos.slice();
  pedidos.forEach(function (t) { puedeTipo_(yo, t); });
  var tipos = ORDEN_TIPOS.filter(function (t) { return pedidos.indexOf(t) >= 0; });
  var enPeriodo = function (f) { return !!f && f >= desde && f <= hasta; };
  var fechaDe = function (r) { return String(r.fecha_recepcion || r.fecha || '').slice(0, 10); };
  var propios = tablaLectura_(HOJAS.REG).filas.map(function (f) { return f.o; })
    .filter(function (r) { return r.estatus !== 'Cancelado' && yo.tipos.indexOf(r.tipo) >= 0; });
  var sel = propios.filter(function (r) { return tipos.indexOf(r.tipo) >= 0; });
  var etiqueta = function (r) { return TIPOS[r.tipo].singular + ' ' + etiquetaNum_(r); };

  // 1 · Registros por mes y por libreta
  var meses = [], m = desde.slice(0, 7);
  while (m <= hasta.slice(0, 7) && meses.length < 80) {
    meses.push(m);
    var y = Number(m.slice(0, 4)), mm = Number(m.slice(5, 7)) + 1;
    if (mm > 12) { mm = 1; y++; }
    m = y + '-' + ('0' + mm).slice(-2);
  }
  var porMes = {}, totalesTipo = {}, total = 0;
  meses.forEach(function (x) { porMes[x] = { mes: x, total: 0, porTipo: {} }; tipos.forEach(function (t) { porMes[x].porTipo[t] = 0; }); });
  tipos.forEach(function (t) { totalesTipo[t] = 0; });
  sel.forEach(function (r) {
    var f = fechaDe(r);
    if (!enPeriodo(f) || !porMes[f.slice(0, 7)]) return;
    porMes[f.slice(0, 7)].porTipo[r.tipo]++; porMes[f.slice(0, 7)].total++;
    totalesTipo[r.tipo]++; total++;
  });

  // 2 · Principales remitentes (lo que llega) y destinatarios (oficios salientes)
  var nombresDir = {};
  tabla_(HOJAS.DIR).filas.forEach(function (f) { nombresDir[f.o.id] = f.o.nombre; });
  var ranking = function (lista, campoId, campoTexto) {
    var mapa = {}, n = 0;
    lista.forEach(function (r) {
      var txt = String(r[campoTexto] || '').split('\n')[0].trim();
      var id = r[campoId] && nombresDir[r[campoId]] ? r[campoId] : '';
      if (!txt && !id) return;
      var k = id || 't:' + normalizar_(txt);
      if (!mapa[k]) mapa[k] = { nombre: id ? nombresDir[id] : txt, n: 0 };
      mapa[k].n++; n++;
    });
    var todos = Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'); });
    return { lista: todos.slice(0, 10), distintos: todos.length, total: n };
  };
  var delPeriodo = sel.filter(function (r) { return enPeriodo(fechaDe(r)); });
  var remitentes = ranking(delPeriodo.filter(function (r) { return TIPOS[r.tipo].recibido; }), 'firma_id', 'firma');
  var destinatarios = ranking(delPeriodo.filter(function (r) { return !TIPOS[r.tipo].recibido; }), 'dirigido_id', 'dirigido_a');

  // 3 · Tiempo de respuesta: lo recibido (en el periodo) → el oficio saliente que lo contesta
  //     (el que se hizo con «Responder con oficio»: su «relacionado» es el recibido).
  var respuesta = {};
  propios.forEach(function (r) {
    if (!TIPOS[r.tipo].numeroAuto || !r.relacionado_id || !fechaValida_(String(r.fecha))) return;
    var prev = respuesta[r.relacionado_id];
    if (!prev || String(r.fecha) < String(prev.fecha)) respuesta[r.relacionado_id] = r;
  });
  var recibidos = delPeriodo.filter(function (r) { return TIPOS[r.tipo].recibido; });
  var inhabiles = diasInhabiles_();
  var pares = [];
  recibidos.forEach(function (e) {
    var o = respuesta[e.id];
    if (!o) return;
    var dias = diasHabiles_(fechaDe(e), String(o.fecha), inhabiles);
    if (dias === null || dias < 0) return;
    pares.push({ recibido: etiqueta(e), numero: e.numero, asunto: corta_(e.asunto, 160), recepcion: fechaDe(e),
      respuesta: etiqueta(o), numero_respuesta: o.numero, fecha_respuesta: String(o.fecha), dias: dias });
  });
  var dias = pares.map(function (p) { return p.dias; }).sort(function (a, b) { return a - b; });
  var mediana = !dias.length ? null : dias.length % 2 ? dias[(dias.length - 1) / 2] : (dias[dias.length / 2 - 1] + dias[dias.length / 2]) / 2;
  var rangos = [['0 a 2', 0, 2], ['3 a 5', 3, 5], ['6 a 10', 6, 10], ['11 a 20', 11, 20], ['Más de 20', 21, 1e9]];

  // 4 · Atendido a tiempo, contra la fecha límite (límites que caen en el periodo)
  //     Fecha de atención: la columna fecha_atencion (desde 1.5.0); para lo anterior,
  //     el último cambio a Atendido/Concluido en la Bitácora; si no, la fecha del
  //     oficio que lo respondió; si no, cuándo se capturó (si nació ya atendido en la app).
  var conLimite = sel.filter(function (r) { return enPeriodo(String(r.fecha_limite || '')); });
  var deBitacora = null;
  var atencionDe = function (r) {
    if (fechaValida_(String(r.fecha_atencion || ''))) return { fecha: r.fecha_atencion, fuente: 'registro' };
    if (!deBitacora) {
      deBitacora = {};
      var re = /estatus(?::\s*«[^»]*»)?\s*→\s*«(Atendido|Concluido)»/;
      tabla_(HOJAS.BIT).filas.forEach(function (f) {
        var b = f.o;
        if (!b.registro_id || !re.test(String(b.detalle))) return;
        var dia = String(b.fecha).slice(0, 10);
        if (!deBitacora[b.registro_id] || dia > deBitacora[b.registro_id]) deBitacora[b.registro_id] = dia;
      });
    }
    if (deBitacora[r.id]) return { fecha: deBitacora[r.id], fuente: 'bitácora' };
    if (respuesta[r.id]) return { fecha: String(respuesta[r.id].fecha), fuente: 'oficio de respuesta' };
    if (r.origen === 'App' && fechaValida_(String(r.creado_en).slice(0, 10))) return { fecha: String(r.creado_en).slice(0, 10), fuente: 'captura' };
    return null;
  };
  var at = { aTiempo: 0, tarde: 0, vencido: 0, enPlazo: 0, sinDato: 0, detalle: [] };
  conLimite.forEach(function (r) {
    var res, fa = null;
    if (CERRADOS.indexOf(r.estatus) >= 0) {
      var a = atencionDe(r);
      if (!a) res = 'sinDato';
      else { fa = a; res = a.fecha <= r.fecha_limite ? 'aTiempo' : 'tarde'; }
    } else {
      res = r.fecha_limite < hoy ? 'vencido' : 'enPlazo';
    }
    at[res]++;
    at.detalle.push({ registro: etiqueta(r), numero: r.numero, asunto: corta_(r.asunto, 160), estatus: r.estatus, fecha_limite: r.fecha_limite,
      fecha_atencion: fa ? fa.fecha : '', fuente: fa ? fa.fuente : '', resultado: res });
  });
  var base = at.aTiempo + at.tarde + at.vencido;
  if (d.excel) {
    bitacora_(yo.usuario, 'exportación', '', 'Excel de Informes del ' + desde + ' al ' + hasta + ' (' + tipos.map(function (t) { return TIPOS[t].nombre; }).join(', ') + ')');
  }
  return {
    desde: desde, hasta: hasta, hoy: hoy, tipos: tipos, total: total, totalesTipo: totalesTipo,
    porMes: meses.map(function (x) { return porMes[x]; }),
    remitentes: remitentes, destinatarios: destinatarios,
    respuesta: { casos: pares.length, recibidos: recibidos.length,
      promedio: dias.length ? Math.round(dias.reduce(function (s, x) { return s + x; }, 0) / dias.length * 10) / 10 : null,
      mediana: mediana, maximo: dias.length ? dias[dias.length - 1] : null,
      distribucion: rangos.map(function (g) { return { rango: g[0], n: dias.filter(function (x) { return x >= g[1] && x <= g[2]; }).length }; }),
      pares: d.excel ? pares : [] },
    aTiempo: { aTiempo: at.aTiempo, tarde: at.tarde, vencido: at.vencido, enPlazo: at.enPlazo, sinDato: at.sinDato, conLimite: conLimite.length,
      porcentaje: base ? Math.round(at.aTiempo / base * 1000) / 10 : null, detalle: d.excel ? at.detalle : [] }
  };
}

/* ═══════════════════════════ Archivos (Drive privado) ═════════════════ */

function carpetaArchivos_() {
  var id = PropertiesService.getScriptProperties().getProperty('ID_CARPETA');
  if (!id) throw falla_('INSTALACION', 'Falta la carpeta de archivos. Corre instalar() desde el editor.');
  return DriveApp.getFolderById(id);
}

function subirArchivo_(yo, d) {
  var clase = d.clase === 'acuse' ? 'acuse' : 'oficio';
  var mime = String(d.mime || '');
  if (MIMES_PERMITIDOS.indexOf(mime) < 0) throw falla_('DATOS', 'Solo se aceptan PDF, JPG o PNG.');
  var b64 = String(d.base64 || '');
  if (!b64 || b64.length * 0.75 > MAX_ARCHIVO_MB * 1024 * 1024 + 4) throw falla_('DATOS', 'El archivo pesa más de ' + MAX_ARCHIVO_MB + ' MB.');
  var bytes = Utilities.base64Decode(b64);
  var firma = bytes.slice(0, 4).map(function (x) { return x & 0xff; });
  var ok = (mime === 'application/pdf' && firma[0] === 0x25 && firma[1] === 0x50 && firma[2] === 0x44 && firma[3] === 0x46) ||
    (mime === 'image/jpeg' && firma[0] === 0xff && firma[1] === 0xd8) ||
    (mime === 'image/png' && firma[0] === 0x89 && firma[1] === 0x50 && firma[2] === 0x4e && firma[3] === 0x47);
  if (!ok) throw falla_('DATOS', 'El contenido del archivo no corresponde a un PDF, JPG o PNG.');
  // Primero se revisa y se crea el archivo en Drive (es lo lento) SIN el candado,
  // para no detener a quien está guardando otra cosa mientras sube la foto.
  var previo = registroPorId_(d.id);
  puedeTipo_(yo, previo.tipo);
  if (previo.estatus === 'Cancelado') throw falla_('DATOS', 'El registro está cancelado.');
  var ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mime];
  var nombre = previo.tipo + ' ' + etiquetaNum_(previo).replace('/', '-') + ' ' + clase + ext;
  var archivo = carpetaArchivos_().createFile(Utilities.newBlob(bytes, mime, nombre));
  var campo = clase === 'acuse' ? 'acuse_archivo' : 'archivo';
  var anterior = '', res, guardado = false;
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.REG);
    var f = buscarRegistro_(t, d.id);   // otra vez, ya con el candado: pudo cambiar mientras subía
    puedeTipo_(yo, f.o.tipo);
    if (f.o.estatus === 'Cancelado') throw falla_('DATOS', 'El registro está cancelado.');
    anterior = f.o[campo + '_id'];
    f.o[campo + '_id'] = archivo.getId();
    f.o[campo + '_nombre'] = corta_(String(d.nombre || nombre).replace(/[\\/:*?"<>|]/g, '_'), 120);
    if (clase === 'acuse') f.o.acuse = 'SI';
    f.o.modificado_por = yo.usuario;
    f.o.modificado_en = sello_(new Date());
    f.o.version = Number(f.o.version) + 1;
    escribirFila_(t.sh, HOJAS.REG, f.fila, f.o);
    bitacora_(yo.usuario, 'archivo', f.o.id, (anterior ? 'Reemplazó ' : 'Subió ') + (clase === 'acuse' ? 'el acuse' : 'el documento') + ': ' + f.o[campo + '_nombre']);
    res = { registro: publico_(f.o) };
    guardado = true;
  } finally {
    soltar_(lock);
    if (!guardado) { try { archivo.setTrashed(true); } catch (e0) { /* se queda en la carpeta */ } }
  }
  if (anterior) { try { DriveApp.getFileById(anterior).setTrashed(true); } catch (e) { /* ya no estaba */ } }
  return res;
}

/**
 * Un solo registro, leído directo de la hoja (sin la caché ni la tabla
 * completa): busca el ID en la primera columna y lee solo ese renglón.
 */
function registroPorId_(id) {
  id = String(id || '');
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw falla_('NO_EXISTE', 'Ese registro no existe.');
  var sh = hoja_(HOJAS.REG), cols = COLS[HOJAS.REG];
  revisarEncabezados_(sh, HOJAS.REG);
  var n = sh.getLastRow();
  if (n < 2) throw falla_('NO_EXISTE', 'Ese registro no existe.');
  var hall = sh.getRange(2, 1, n - 1, 1).createTextFinder(id).matchCase(true).matchEntireCell(true).findAll();
  if (!hall.length) throw falla_('NO_EXISTE', 'Ese registro no existe.');
  var v = sh.getRange(hall[0].getRow(), 1, 1, cols.length).getValues()[0];
  var num = NUMERICAS[HOJAS.REG] || {}, o = {};
  for (var c = 0; c < cols.length; c++) o[cols[c]] = leerValor_(v[c], num[cols[c]]);
  if (o.id !== id) throw falla_('NO_EXISTE', 'Ese registro no existe.');
  return o;
}

function descargarArchivo_(yo, d) {
  var clase = d.clase === 'acuse' ? 'acuse' : 'oficio';
  var r = registroPorId_(d.id);
  puedeTipo_(yo, r.tipo);
  var campo = clase === 'acuse' ? 'acuse_archivo' : 'archivo';
  var id = r[campo + '_id'];
  if (!id) throw falla_('NO_EXISTE', 'Este registro no tiene ese archivo.');
  var archivo = DriveApp.getFileById(id);
  // Defensa extra: solo se entregan archivos de la carpeta del sistema
  var carpeta = carpetaArchivos_().getId(), propio = false, padres = archivo.getParents();
  while (padres.hasNext()) if (padres.next().getId() === carpeta) propio = true;
  if (!propio || archivo.isTrashed()) throw falla_('NO_EXISTE', 'El archivo ya no está disponible.');
  var blob = archivo.getBlob();
  bitacora_(yo.usuario, 'descarga', r.id, (clase === 'acuse' ? 'Acuse' : 'Documento') + ': ' + r[campo + '_nombre']);
  return { nombre: r[campo + '_nombre'] || archivo.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function quitarArchivo_(yo, d) {
  var clase = d.clase === 'acuse' ? 'acuse' : 'oficio';
  var id = '', res;
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.REG);
    var f = buscarRegistro_(t, d.id);
    puedeTipo_(yo, f.o.tipo);
    if (f.o.estatus === 'Cancelado' && yo.rol !== 'admin') throw falla_('PERMISO', 'El registro está cancelado.');
    var campo = clase === 'acuse' ? 'acuse_archivo' : 'archivo';
    id = f.o[campo + '_id'];
    if (!id) return { registro: publico_(f.o) };
    var nombre = f.o[campo + '_nombre'];
    f.o[campo + '_id'] = '';
    f.o[campo + '_nombre'] = '';
    f.o.modificado_por = yo.usuario;
    f.o.modificado_en = sello_(new Date());
    f.o.version = Number(f.o.version) + 1;
    escribirFila_(t.sh, HOJAS.REG, f.fila, f.o);
    bitacora_(yo.usuario, 'archivo', f.o.id, 'Quitó ' + (clase === 'acuse' ? 'el acuse' : 'el documento') + ': ' + nombre + ' (queda en la papelera de Drive 30 días)');
    res = { registro: publico_(f.o) };
  } finally {
    soltar_(lock);
  }
  // A la papelera ya sin el candado (Drive tarda)
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* ya no estaba */ }
  return res;
}

/* ═══════════════════════════ Directorio ═══════════════════════════════ */

function listarDirectorio_(yo) {
  var usos = {};
  tablaLectura_(HOJAS.REG).filas.forEach(function (f) {
    if (f.o.dirigido_id) usos[f.o.dirigido_id] = (usos[f.o.dirigido_id] || 0) + 1;
    if (f.o.firma_id && f.o.firma_id !== f.o.dirigido_id) usos[f.o.firma_id] = (usos[f.o.firma_id] || 0) + 1;
  });
  return tabla_(HOJAS.DIR).filas
    .filter(function (f) { return f.o.activo === 'SI' || yo.rol === 'admin'; })
    .map(function (f) {
      return { id: f.o.id, nombre: f.o.nombre, cargo: f.o.cargo, dependencia: f.o.dependencia, activo: f.o.activo,
        unido_a: f.o.unido_a, usos: usos[f.o.id] || 0 };
    })
    .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
}

function clavePersona_(s) {
  var t = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-zñ ]/g, ' ');
  var p = t.split(/\s+/).filter(Boolean);
  while (p.length && /^(lic|licda|lcda|lcdo|lda|mtro|mtra|mtr|c|dr|dra|ing|arq|prof|profa|dip|tsu)$/.test(p[0])) p.shift();
  return p.join(' ');
}

function parecido_(a, b) {
  // Dice sobre bigramas: suficiente para avisar "¿no será esta persona?"
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  var bg = function (s) { var m = {}; for (var i = 0; i < s.length - 1; i++) { var k = s.substr(i, 2); m[k] = (m[k] || 0) + 1; } return m; };
  var x = bg(a), y = bg(b), inter = 0;
  for (var k in x) if (y[k]) inter += Math.min(x[k], y[k]);
  return (2 * inter) / (a.length + b.length - 2);
}

function guardarPersona_(yo, d) {
  var nombre = String(d.nombre || '').replace(/\s+/g, ' ').trim();
  var cargo = String(d.cargo || '').replace(/\s+/g, ' ').trim();
  var dependencia = String(d.dependencia || '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 3) throw falla_('DATOS', 'Escribe el nombre.');
  if (nombre.length > 200 || cargo.length > 300 || dependencia.length > 200) throw falla_('DATOS', 'Algún dato es demasiado largo.');
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.DIR);
    var ahora = sello_(new Date());
    if (d.id) {
      var f = t.filas.filter(function (x) { return x.o.id === d.id; })[0];
      if (!f) throw falla_('NO_EXISTE', 'Esa persona no existe.');
      if (yo.rol !== 'admin' && f.o.creado_por !== yo.usuario) throw falla_('PERMISO', 'Solo un administrador puede corregir datos de personas que dio de alta alguien más.');
      var antes = f.o.nombre + ' / ' + f.o.cargo;
      f.o.nombre = nombre; f.o.cargo = cargo; f.o.dependencia = dependencia;
      if (yo.rol === 'admin' && (d.activo === 'SI' || d.activo === 'NO')) f.o.activo = d.activo;
      f.o.modificado_en = ahora;
      escribirFila_(t.sh, HOJAS.DIR, f.fila, f.o);
      bitacora_(yo.usuario, 'directorio', f.o.id, 'Editó: «' + antes + '» → «' + nombre + ' / ' + cargo + '»' + (f.o.activo === 'NO' ? ' (desactivada)' : ''));
      return { persona: f.o };
    }
    var k = clavePersona_(nombre);
    if (!d.confirmar) {
      var parecidos = t.filas.filter(function (f) { return f.o.activo === 'SI' && parecido_(k, clavePersona_(f.o.nombre)) >= 0.75; })
        .map(function (f) { return { id: f.o.id, nombre: f.o.nombre, cargo: f.o.cargo }; }).slice(0, 5);
      if (parecidos.length) throw falla_('PARECIDO', 'Ya hay personas con un nombre parecido. ¿Es alguna de ellas?', { parecidos: parecidos });
    }
    var max = 0;
    t.filas.forEach(function (f) { max = Math.max(max, Number(String(f.o.id).replace(/\D/g, '')) || 0); });
    var p = { id: 'P' + ('000' + (max + 1)).slice(-Math.max(4, String(max + 1).length)), nombre: nombre, cargo: cargo,
      dependencia: dependencia, activo: 'SI', unido_a: '', creado_por: yo.usuario, creado_en: ahora, modificado_en: ahora };
    escribirFila_(t.sh, HOJAS.DIR, t.sh.getLastRow() + 1, p);
    bitacora_(yo.usuario, 'directorio', p.id, 'Alta: ' + nombre + (cargo ? ' / ' + cargo : ''));
    return { persona: p };
  } finally {
    soltar_(lock);
  }
}

/** Junta dos fichas de la misma persona: los registros de «de» pasan a «a». */
function unirPersonas_(yo, d) {
  if (!d.de || !d.a || d.de === d.a) throw falla_('DATOS', 'Elige dos personas distintas.');
  var lock = candado_(30000);
  try {
    var td = tabla_(HOJAS.DIR);
    var de = td.filas.filter(function (x) { return x.o.id === d.de; })[0];
    var a = td.filas.filter(function (x) { return x.o.id === d.a; })[0];
    if (!de || !a) throw falla_('NO_EXISTE', 'Alguna de las dos personas ya no existe.');
    var tr = tabla_(HOJAS.REG), cambiadas = [], ahora = sello_(new Date());
    var nuevoTexto = function (viejo) {
      var cargo = String(viejo || '').split('\n').slice(1).join(' ').trim() || a.o.cargo;
      return a.o.nombre + (cargo ? '\n' + cargo : '');
    };
    tr.filas.forEach(function (f) {
      var cambio = false;
      if (f.o.dirigido_id === d.de) { f.o.dirigido_id = d.a; f.o.dirigido_a = nuevoTexto(f.o.dirigido_a); cambio = true; }
      if (f.o.firma_id === d.de) { f.o.firma_id = d.a; f.o.firma = nuevoTexto(f.o.firma); cambio = true; }
      if (cambio) {
        f.o.version = Number(f.o.version) + 1;
        f.o.modificado_por = yo.usuario;
        f.o.modificado_en = ahora;
        cambiadas.push(f);
      }
    });
    escribirVarias_(tr, HOJAS.REG, cambiadas);
    var n = cambiadas.length;
    de.o.activo = 'NO';
    de.o.unido_a = d.a;
    de.o.modificado_en = ahora;
    escribirFila_(td.sh, HOJAS.DIR, de.fila, de.o);
    bitacora_(yo.usuario, 'directorio', d.a, 'Unió «' + de.o.nombre + '» con «' + a.o.nombre + '» (' + n + ' registros actualizados)');
    return { actualizados: n };
  } finally {
    soltar_(lock);
  }
}

/* ═══════════════════════════ Usuarios ═════════════════════════════════ */

function listarUsuarios_() {
  var ahora = new Date();
  return tabla_(HOJAS.USR).filas.map(function (f) {
    var o = f.o;
    return { usuario: o.usuario, nombre: o.nombre, rol: o.rol, tipos: o.tipos, activo: o.activo,
      debe_cambiar: o.debe_cambiar, bloqueado: !!(o.bloqueado_hasta && new Date(o.bloqueado_hasta) > ahora),
      creado_en: o.creado_en, ultimo_acceso: o.ultimo_acceso, informes: o.rol === 'admin' ? 'SI' : (o.informes === 'SI' ? 'SI' : 'NO'),
      correo: o.correo || '', dosPasos: !!o.totp };
  });
}

function guardarUsuario_(yo, d) {
  var nombre = String(d.nombre || '').replace(/\s+/g, ' ').trim();
  var rol = String(d.rol || '');
  if (!ROLES[rol]) throw falla_('DATOS', 'Rol desconocido.');
  if (nombre.length < 3 || nombre.length > 120) throw falla_('DATOS', 'Escribe el nombre completo.');
  var tipos = rol === 'admin' ? '*' : (d.tipos === '*' ? '*' : (Array.isArray(d.tipos) ? d.tipos : String(d.tipos || '').split(','))
    .map(function (x) { return String(x).trim(); }).filter(function (x) { return TIPOS[x]; }).join(','));
  if (!tipos) throw falla_('DATOS', 'Elige al menos una libreta.');
  var activo = d.activo === 'NO' ? 'NO' : 'SI';
  // Informes: los admin siempre; para los demás, solo si se marca. undefined = la
  // página (versión anterior) no lo manda: al editar se conserva lo que ya tenía.
  var informes = d.informes === undefined || d.informes === null ? undefined : (d.informes === true || d.informes === 'SI' ? 'SI' : 'NO');
  // Correo para avisos: undefined = página anterior (se conserva).
  var correo = d.correo === undefined || d.correo === null ? undefined : String(d.correo).trim().toLowerCase();
  if (correo !== undefined && !correoValido_(correo)) throw falla_('DATOS', 'Ese correo no parece válido.');
  // La contraseña temporal se cifra antes de tomar el candado (tarda).
  var temporal = d.nuevo ? claveTemporal_() : '';
  var hash = d.nuevo ? hashClave_(temporal) : '';
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.USR);
    var ahora = sello_(new Date());
    if (d.nuevo) {
      var usuario = String(d.usuario || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(usuario)) throw falla_('DATOS', 'El usuario debe tener de 3 a 30 letras minúsculas, números, punto o guion, sin espacios ni acentos.');
      if (t.filas.some(function (f) { return f.o.usuario === usuario; })) throw falla_('DATOS', 'Ese usuario ya existe.');
      var u = { usuario: usuario, nombre: nombre, rol: rol, tipos: tipos, activo: activo, clave: hash,
        debe_cambiar: 'SI', intentos: 0, bloqueado_hasta: '', sello: nuevoSello_(), creado_en: ahora, ultimo_acceso: '',
        informes: rol !== 'admin' && informes === 'SI' ? 'SI' : '', correo: correo || '', totp: '' };
      escribirFila_(t.sh, HOJAS.USR, t.sh.getLastRow() + 1, u);
      bitacora_(yo.usuario, 'usuarios', '', 'Alta de ' + usuario + ' (' + ROLES[rol] + ', ' + tipos + (u.informes === 'SI' ? ', con Informes' : '') + ')');
      return { usuario: usuario, temporal: temporal };
    }
    var f = t.filas.filter(function (x) { return x.o.usuario === d.usuario; })[0];
    if (!f) throw falla_('NO_EXISTE', 'Ese usuario no existe.');
    var quedaAdmin = rol === 'admin' && activo === 'SI';
    if (f.o.rol === 'admin' && !quedaAdmin) {
      var otros = t.filas.filter(function (x) { return x.o.usuario !== f.o.usuario && x.o.rol === 'admin' && x.o.activo === 'SI'; });
      if (!otros.length) throw falla_('DATOS', 'Debe quedar al menos un administrador activo.');
      if (f.o.usuario === yo.usuario) throw falla_('DATOS', 'No puedes quitarte a ti mismo el rol de administrador ni desactivarte.');
    }
    var informesNuevo = rol === 'admin' ? '' : (informes === undefined ? (f.o.informes === 'SI' ? 'SI' : '') : (informes === 'SI' ? 'SI' : ''));
    var txtInf = function (v) { return v === 'SI' ? '/informes' : ''; };
    var antes = f.o.rol + '/' + f.o.tipos + '/' + f.o.activo + txtInf(f.o.informes);
    var quitar2fa = !!(d.quitar2fa && f.o.totp);
    var cerrar = f.o.activo !== activo || f.o.rol !== rol || f.o.tipos !== tipos || (f.o.informes || '') !== informesNuevo || quitar2fa;
    var extra = [];
    f.o.nombre = nombre; f.o.rol = rol; f.o.tipos = tipos; f.o.activo = activo; f.o.informes = informesNuevo;
    if (correo !== undefined && correo !== (f.o.correo || '')) { extra.push('correo «' + (f.o.correo || '') + '» → «' + correo + '»'); f.o.correo = correo; }
    if (d.desbloquear) { f.o.bloqueado_hasta = ''; f.o.intentos = 0; CacheService.getScriptCache().remove('bloq:' + f.o.usuario); extra.push('desbloqueado'); }
    if (quitar2fa) { f.o.totp = ''; extra.push('le quitó la verificación en dos pasos'); }
    if (cerrar) f.o.sello = nuevoSello_();   // permisos nuevos = sesión nueva
    escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
    bitacora_(yo.usuario, 'usuarios', '', 'Cambió ' + f.o.usuario + ': ' + antes + ' → ' + rol + '/' + tipos + '/' + activo + txtInf(informesNuevo) +
      (extra.length ? ' (' + extra.join(', ') + ')' : ''));
    return { usuario: f.o.usuario };
  } finally {
    soltar_(lock);
  }
}

function restablecerClave_(yo, d) {
  var temporal = claveTemporal_();
  var hash = hashClave_(temporal);   // fuera del candado (tarda)
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.USR);
    var f = t.filas.filter(function (x) { return x.o.usuario === d.usuario; })[0];
    if (!f) throw falla_('NO_EXISTE', 'Ese usuario no existe.');
    f.o.clave = hash;
    f.o.debe_cambiar = 'SI';
    f.o.intentos = 0;
    f.o.bloqueado_hasta = '';
    f.o.sello = nuevoSello_();
    escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
    CacheService.getScriptCache().remove('bloq:' + f.o.usuario);
    bitacora_(yo.usuario, 'usuarios', '', 'Restableció la contraseña de ' + f.o.usuario);
    return { usuario: f.o.usuario, temporal: temporal };
  } finally {
    soltar_(lock);
  }
}

/* ═══════════════════════════ Bitácora y configuración ═════════════════ */

function bitacora_(usuario, accion, registroId, detalle) {
  bitacoraVarias_([[usuario, accion, registroId, detalle]]);
}

/**
 * Varias entradas de bitácora en UNA sola escritura. entradas = [[usuario, accion, registroId, detalle], …]
 * Siempre dentro del candado: si dos peticiones calcularan el mismo «último
 * renglón + 1», una borraría a la otra. Si quien llama ya tiene el candado,
 * se usa ese; si no, se toma aquí (máximo 15 s). Si ni así, appendRow (una
 * sola operación de Google, que no pisa renglones).
 */
function bitacoraVarias_(entradas) {
  if (!entradas.length) return;
  var cuando = sello_(new Date());
  var filas = entradas.map(function (e) { return [cuando, e[0], e[1], e[2] || '', corta_(e[3], 2000)].map(seguro_); });
  var propio = enCandado_() ? null : candado_(15000, true);
  try {
    var sh = hoja_(HOJAS.BIT);
    if (!enCandado_()) {
      console.warn('bitácora sin candado (ocupado): se usa appendRow');
      filas.forEach(function (f) { sh.appendRow(f); });
      return;
    }
    var n = sh.getLastRow() + 1;
    asegurarFilas_(sh, n + filas.length - 1);
    var rng = sh.getRange(n, 1, filas.length, 5);
    rng.setNumberFormat('@');
    rng.setValues(filas);
  } finally {
    if (propio) soltar_(propio);
  }
}

/**
 * La Bitácora del administrador. Crece todos los días, así que se lee desde
 * el final hacia atrás, en bloques: sin «desde», los últimos 20,000
 * movimientos; con «desde», hasta llegar a esa fecha.
 */
var BIT_BLOQUE = 2000, BIT_TOPE = 20000;

function listarBitacora_(yo, d) {
  var desde = String(d.desde || ''), hasta = String(d.hasta || '');
  var usuario = String(d.usuario || ''), accion = String(d.accion || '');
  var q = String(d.texto || '').toLowerCase();
  var sh = hoja_(HOJAS.BIT), cols = COLS[HOJAS.BIT];
  revisarEncabezados_(sh, HOJAS.BIT);
  var leidas = [], fin = sh.getLastRow();
  while (fin >= 2) {
    var ini = Math.max(2, fin - BIT_BLOQUE + 1);
    var v = sh.getRange(ini, 1, fin - ini + 1, cols.length).getValues();
    for (var i = v.length - 1; i >= 0; i--) {
      if (v[i].every(function (x) { return x === '' || x === null; })) continue;
      var o = {};
      for (var c = 0; c < cols.length; c++) o[cols[c]] = leerValor_(v[i][c], false);
      leidas.push(o);
    }
    fin = ini - 1;
    var masVieja = leidas.length ? String(leidas[leidas.length - 1].fecha).slice(0, 10) : '';
    if (desde ? masVieja && masVieja < desde : leidas.length >= BIT_TOPE) break;
  }
  var filas = leidas.filter(function (o) {
    var dia = String(o.fecha).slice(0, 10);
    return (!desde || dia >= desde) && (!hasta || dia <= hasta) && (!usuario || o.usuario === usuario) &&
      (!accion || o.accion === accion) && (!q || (o.detalle + ' ' + o.registro_id).toLowerCase().indexOf(q) >= 0);
  });
  var usuarios = {}, acciones = {};
  leidas.forEach(function (o) { usuarios[o.usuario] = true; acciones[o.accion] = true; });
  return { filas: filas.slice(0, 500), total: filas.length, usuarios: Object.keys(usuarios).sort(), acciones: Object.keys(acciones).sort(),
    revisados: leidas.length, parcial: fin >= 2 };
}

/** Lo de la pestaña Config. Se lee una vez por petición (y otra vez si se escribe en Config o se toma el candado). */
function config_() {
  if (MEMO_.cfg) return MEMO_.cfg;
  var o = {};
  tabla_(HOJAS.CFG).filas.forEach(function (f) { o[f.o.clave] = f.o.valor; });
  MEMO_.cfg = o;
  return o;
}

var CONFIG_EDITABLE = ['encabezado_1', 'encabezado_2', 'encabezado_3', 'plantilla_OFS', 'plazo_dias', 'url_web',
  // 1.7.0
  'dias_inhabiles', 'acuse_desde', 'plantilla_doc_OFS', 'avisos_correo', 'avisos_detalle', 'dos_pasos_admin'];
var CONFIG_SI_NO = { avisos_correo: true, avisos_detalle: true, dos_pasos_admin: true };

/** Limpia y valida un valor de Configuración. Devuelve el texto que se guarda. */
function valorConfig_(k, bruto, yo) {
  if (k === 'dias_inhabiles') {
    var fechas = (String(bruto).match(/\d{4}-\d{2}-\d{2}/g) || []);
    var malas = fechas.filter(function (x) { return !fechaValida_(x); });
    if (malas.length) throw falla_('DATOS', 'Estas fechas no existen: ' + malas.slice(0, 5).join(', ') + '.');
    var unicas = {};
    fechas.forEach(function (x) { unicas[x] = true; });
    var lista = Object.keys(unicas).sort();
    if (lista.length > 400) throw falla_('DATOS', 'Son demasiados días inhábiles (máximo 400).');
    return lista.join(', ');
  }
  var v = String(bruto).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (k === 'plantilla_OFS' && v && v.indexOf('{NNN}') < 0) throw falla_('DATOS', 'La plantilla debe incluir {NNN} (el consecutivo).');
  if (k === 'plazo_dias' && v && !/^\d{1,3}$/.test(v)) throw falla_('DATOS', 'El plazo debe ser un número de días.');
  if (k === 'url_web' && v && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s"'<>]*)?$/i.test(v)) throw falla_('DATOS', 'La dirección debe empezar con https:// (por ejemplo https://control-gestion.vercel.app).');
  if (k === 'acuse_desde' && v && !fechaValida_(v)) throw falla_('DATOS', 'La fecha de corte para «sin acuse» no es válida.');
  if (CONFIG_SI_NO[k]) v = v === 'SI' ? 'SI' : 'NO';
  if (k === 'dos_pasos_admin' && v === 'SI' && !yo.dosPasos) throw falla_('DATOS', 'Primero activa tu propia verificación en dos pasos (en «Mi cuenta»); si no, el sistema te la pediría al guardar.');
  if (k === 'plantilla_doc_OFS' && v) {
    var m = v.match(/[-\w]{25,}/);
    if (!m) throw falla_('DATOS', 'Pega el enlace o el ID del documento de Google que sirve de plantilla.');
    v = m[0];
    revisarPlantillaDoc_(v);
  }
  return v;
}

function guardarConfig_(yo, d) {
  var limpios = {};
  CONFIG_EDITABLE.forEach(function (k) { if (d[k] !== undefined && d[k] !== null) limpios[k] = valorConfig_(k, d[k], yo); });
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.CFG);
    var cambios = [];
    Object.keys(limpios).forEach(function (k) {
      var v = limpios[k];
      var f = t.filas.filter(function (x) { return x.o.clave === k; })[0];
      if (f && f.o.valor !== v) {
        cambios.push(k + ': «' + corta_(f.o.valor, 80) + '» → «' + corta_(v, 80) + '»');
        f.o.valor = v;
        escribirFila_(t.sh, HOJAS.CFG, f.fila, f.o);
      } else if (!f) {
        cambios.push(k + ': «' + corta_(v, 80) + '»');
        escribirFila_(t.sh, HOJAS.CFG, t.sh.getLastRow() + 1, { clave: k, valor: v, descripcion: '' });
        t = tabla_(HOJAS.CFG);
      }
    });
    if (cambios.length) bitacora_(yo.usuario, 'configuración', '', cambios.join(' · '));
  } finally {
    soltar_(lock);
  }
  return configPublica_(config_(), yo);
}

/* ═══════════════════════════ Acceso a la hoja ═════════════════════════ */

/** La hoja de la base. Se abre una sola vez por petición (MEMO_). */
function libro_() {
  if (MEMO_.libro) return MEMO_.libro;
  var id = PropertiesService.getScriptProperties().getProperty('ID_HOJA');
  if (!id) throw falla_('INSTALACION', 'El sistema no está instalado. Corre instalar() desde el editor de Apps Script.');
  MEMO_.libro = SpreadsheetApp.openById(id);
  return MEMO_.libro;
}

function hoja_(nombre) {
  var hojas = MEMO_.hojas || (MEMO_.hojas = {});
  if (hojas[nombre]) return hojas[nombre];
  var sh = libro_().getSheetByName(nombre);
  if (!sh) throw falla_('INSTALACION', 'Falta la pestaña «' + nombre + '». Corre instalar() desde el editor.');
  hojas[nombre] = sh;
  return sh;
}

/** Lee una pestaña completa → { sh, filas: [{ fila, o }] } (fila = número de renglón en la hoja). */
function tabla_(nombre) {
  var sh = hoja_(nombre);
  var cols = COLS[nombre];
  // Red de seguridad: si el código trae columnas nuevas (siempre al FINAL) y
  // todavía no se corre instalar(), se agregan aquí los encabezados que
  // faltan para que la app no se detenga. instalar() sigue siendo el paso
  // oficial (además da formato y protección).
  var anchas = MEMO_.anchas || (MEMO_.anchas = {});   // una revisión por pestaña y por petición
  if (!anchas[nombre]) {
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    anchas[nombre] = true;
  }
  var n = Math.max(1, sh.getLastRow());
  var todo = sh.getRange(1, 1, n, cols.length).getValues();
  for (var c0 = 0; c0 < cols.length; c0++) {
    var enc = String(todo[0][c0]).trim();
    if (enc === cols[c0]) continue;
    var vacias = function (fila) { return fila.slice(c0).every(function (x) { return x === null || String(x).trim() === ''; }); };
    // Solo se agregan encabezados al final si esas columnas están vacías en TODA la hoja
    // (si alguien escribió algo ahí a mano, no se adopta como dato: se pide revisar).
    if (enc === '' && c0 > 0 && todo.every(vacias)) {
      var faltan = cols.slice(c0);
      var cab = sh.getRange(1, c0 + 1, 1, faltan.length);
      cab.setNumberFormat('@');
      cab.setValues([faltan]);
      marcarEscrito_(nombre);
      for (var k = 0; k < faltan.length; k++) todo[0][c0 + k] = faltan[k];
      console.warn('Se agregaron columnas a «' + nombre + '»: ' + faltan.join(', ') + '. Corre instalar() desde el editor.');
      if (nombre !== HOJAS.BIT) bitacora_('sistema', 'instalación', '', 'Columnas nuevas en «' + nombre + '»: ' + faltan.join(', ') + ' (agregadas solas; corre instalar() desde el editor).');
      break;
    }
    throw falla_('INSTALACION', 'Las columnas de la pestaña «' + nombre + '» no son las esperadas (columna ' + (c0 + 1) +
      ' debería ser «' + cols[c0] + '»). No muevas columnas a mano; corre revisarSeguridad() desde el editor.');
  }
  (MEMO_.encOk || (MEMO_.encOk = {}))[nombre] = true;
  var valores = todo.slice(1);
  var num = NUMERICAS[nombre] || {};
  var filas = [];
  for (var i = 0; i < valores.length; i++) {
    var v = valores[i];
    if (v.every(function (x) { return x === '' || x === null; })) continue;
    var o = {};
    for (var c = 0; c < cols.length; c++) o[cols[c]] = leerValor_(v[c], num[cols[c]]);
    filas.push({ fila: i + 2, o: o });
  }
  if (nombre === HOJAS.REG) MEMO_.filasReg = filas;   // la última lectura (la usa conDetalle_)
  return { sh: sh, filas: filas };
}

/**
 * Revisa SOLO el renglón de títulos (una lectura chica). Si no coincide, tabla_()
 * hace lo de siempre: agrega las columnas nuevas que falten o avisa que movieron columnas.
 */
function revisarEncabezados_(sh, nombre) {
  var ok = MEMO_.encOk || (MEMO_.encOk = {});
  if (ok[nombre]) return;
  var cols = COLS[nombre];
  if (sh.getMaxColumns() < cols.length) { tabla_(nombre); return; }
  var cab = sh.getRange(1, 1, 1, cols.length).getValues()[0];
  for (var c = 0; c < cols.length; c++) {
    if (String(cab[c]).trim() !== cols[c]) { tabla_(nombre); return; }
  }
  ok[nombre] = true;
}

/* ─────────── Caché de Registros entre peticiones (1.7.0) ───────────
   Leer la pestaña Registros completa en cada petición crece en línea recta
   con los años. Lo que solo LEE (listas, portal, buscador, informes…) usa
   una copia comprimida en CacheService. Reglas para que nunca se vea algo
   viejo después de guardar:
    · Lo que escribe siempre lee la hoja directo, dentro del candado.
    · Al escribir, DESPUÉS del flush, se cambia la «versión» (reg:v); las
      copias de versiones anteriores ya no se usan.
    · Quien lee anota la versión ANTES de leer la hoja y guarda su copia con
      esa versión; si alguien escribió mientras tanto, la versión ya cambió.
    · Solo quien tiene el candado crea una versión cuando no hay ninguna.
    · Todo dura máximo 15 min: si alguien edita la hoja a mano, se ve a más
      tardar en ese tiempo (o al instante con instalar() / revisarSeguridad()).
   Se apaga con la propiedad del script CACHE_REGISTROS = NO. */

var CACHE_REG_SEG = 15 * 60;
var CACHE_TROZO = 90000;      // CacheService guarda hasta 100 KB por clave

function tablaLectura_(nombre) {
  if (nombre !== HOJAS.REG || enCandado_()) return tabla_(nombre);
  if (MEMO_.regLectura) return MEMO_.regLectura;
  var t = null;
  try { t = registrosDeCache_(); } catch (e) { console.warn('caché de Registros: ' + (e && e.message)); if (e && e.codigo) throw e; }
  MEMO_.regLectura = t || tabla_(nombre);
  return MEMO_.regLectura;
}

function registrosDeCache_() {
  if (PropertiesService.getScriptProperties().getProperty('CACHE_REGISTROS') === 'NO') return null;
  var cache = CacheService.getScriptCache();
  var v = cache.get('reg:v') || iniciarVersionRegistros_();
  if (!v) return null;
  var sh = hoja_(HOJAS.REG);
  revisarEncabezados_(sh, HOJAS.REG);
  var n = Number(cache.get('reg:' + v + ':n') || 0);
  if (n > 0) {
    var claves = [];
    for (var i = 0; i < n; i++) claves.push('reg:' + v + ':' + i);
    var trozos = cache.getAll(claves);
    if (claves.every(function (k) { return typeof trozos[k] === 'string'; })) {
      var filas = expandirFilas_(descomprimir_(claves.map(function (k) { return trozos[k]; }).join('')));
      if (filas) return { sh: sh, filas: filas, deCache: true };
    }
  }
  // No estaba (o se perdió un pedazo): se lee la hoja y se guarda con la versión vista ANTES de leer.
  var t = tabla_(HOJAS.REG);
  try { guardarRegistrosEnCache_(v, t.filas); } catch (e) { console.warn('no se guardó la caché: ' + (e && e.message)); }
  return t;
}

/** Solo con el candado (y sin esperar casi nada): así nadie crea una versión mientras otro escribe. */
function iniciarVersionRegistros_() {
  var lock = candado_(3000, true);
  if (!lock) return null;
  try {
    var cache = CacheService.getScriptCache();
    var v = cache.get('reg:v');
    if (!v) { v = Utilities.getUuid().replace(/-/g, '').slice(0, 10); cache.put('reg:v', v, CACHE_REG_SEG); }
    return v;
  } finally {
    soltar_(lock);
  }
}

function guardarRegistrosEnCache_(v, filas) {
  var cols = COLS[HOJAS.REG];
  var datos = filas.map(function (f) { var a = [f.fila]; for (var c = 0; c < cols.length; c++) a.push(f.o[cols[c]]); return a; });
  var txt = comprimir_(JSON.stringify({ c: cols.join(','), f: datos }));
  var n = Math.ceil(txt.length / CACHE_TROZO);
  if (n > 250) return;   // demasiado grande para la caché: se seguirá leyendo la hoja
  var trozos = {};
  for (var i = 0; i < n; i++) trozos['reg:' + v + ':' + i] = txt.slice(i * CACHE_TROZO, (i + 1) * CACHE_TROZO);
  trozos['reg:' + v + ':n'] = String(n);
  CacheService.getScriptCache().putAll(trozos, CACHE_REG_SEG);
}

function expandirFilas_(json) {
  var d = JSON.parse(json), cols = COLS[HOJAS.REG];
  if (!d || d.c !== cols.join(',')) return null;   // otras columnas (versión distinta del código): no sirve
  return d.f.map(function (a) {
    var o = {};
    for (var c = 0; c < cols.length; c++) o[cols[c]] = a[c + 1];
    return { fila: a[0], o: o };
  });
}

function comprimir_(texto) {
  return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(texto, 'application/json')).getBytes());
}

function descomprimir_(b64) {
  return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString();
}

/** Después de escribir en Registros (y del flush): la versión cambia y las copias viejas dejan de usarse. */
function publicarCambiosRegistros_() {
  if (!MEMO_.regSucio) return;
  MEMO_.regSucio = false;
  MEMO_.regLectura = null;
  try { SpreadsheetApp.flush(); } catch (e0) { /* ya se intentó en soltar_ */ }
  invalidarRegistros_();
}

function invalidarRegistros_() {
  var cache = CacheService.getScriptCache();
  try { cache.remove('reg:v'); } catch (e) { console.error('no se pudo quitar la versión de la caché: ' + (e && e.message)); }
  cache.put('reg:v', Utilities.getUuid().replace(/-/g, '').slice(0, 10), CACHE_REG_SEG);
}

/** Lo que se lee una vez por petición deja de valer cuando se escribe en esa pestaña. */
function marcarEscrito_(nombre) {
  if (nombre === HOJAS.REG) { MEMO_.regSucio = true; MEMO_.regLectura = null; }
  if (nombre === HOJAS.CFG) MEMO_.cfg = null;
  if (nombre === HOJAS.USR) MEMO_.usr = null;
}

function leerValor_(x, numerico) {
  if (x instanceof Date) return Utilities.formatDate(x, ZONA, 'yyyy-MM-dd');
  if (numerico) return x === '' ? '' : Number(x);
  var s = x === null || x === undefined ? '' : String(x);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

/** Texto que empiece con = + - @ no debe convertirse en fórmula. */
function seguro_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** Un objeto → los valores de su renglón, en el orden de COLS (texto seguro o número). */
function valoresFila_(nombre, o) {
  var num = NUMERICAS[nombre] || {};
  return COLS[nombre].map(function (c) {
    var v = o[c];
    if (num[c]) return v === '' || v === null || v === undefined ? '' : Number(v);
    return seguro_(v === null || v === undefined ? '' : String(v));
  });
}

/** Formato de cada celda del renglón: '0' en las numéricas, texto ('@') en las demás. */
function formatosFila_(nombre) {
  var num = NUMERICAS[nombre] || {};
  return COLS[nombre].map(function (c) { return num[c] ? '0' : '@'; });
}

function escribirFila_(sh, nombre, fila, o) {
  asegurarFilas_(sh, fila);
  var rng = sh.getRange(fila, 1, 1, COLS[nombre].length);
  rng.setNumberFormats([formatosFila_(nombre)]);
  rng.setValues([valoresFila_(nombre, o)]);
  marcarEscrito_(nombre);
}

/** Escribe varios registros seguidos, a partir de la fila «desde», en una sola operación. */
function escribirBloque_(sh, nombre, desde, objetos) {
  if (!objetos.length) return;
  var fmt = formatosFila_(nombre);
  asegurarFilas_(sh, desde + objetos.length - 1);
  var rng = sh.getRange(desde, 1, objetos.length, COLS[nombre].length);
  rng.setNumberFormats(objetos.map(function () { return fmt; }));
  rng.setValues(objetos.map(function (o) { return valoresFila_(nombre, o); }));
  marcarEscrito_(nombre);
}

/** Reescribe en una sola operación el bloque que va de la primera a la última fila cambiada (con el candado tomado). */
function escribirVarias_(t, nombre, cambiadas) {
  if (!cambiadas.length) return;
  if (cambiadas.length <= 5) { cambiadas.forEach(function (f) { escribirFila_(t.sh, nombre, f.fila, f.o); }); return; }
  var porFila = {};
  t.filas.forEach(function (f) { porFila[f.fila] = f.o; });
  var desde = Math.min.apply(null, cambiadas.map(function (f) { return f.fila; }));
  var hasta = Math.max.apply(null, cambiadas.map(function (f) { return f.fila; }));
  var fmt = formatosFila_(nombre), valores = [], formatos = [];
  for (var r = desde; r <= hasta; r++) {
    valores.push(valoresFila_(nombre, porFila[r] || {}));
    formatos.push(fmt);
  }
  var rng = t.sh.getRange(desde, 1, hasta - desde + 1, COLS[nombre].length);
  rng.setNumberFormats(formatos);
  rng.setValues(valores);
  marcarEscrito_(nombre);
}

function asegurarFilas_(sh, fila) {
  var max = sh.getMaxRows();
  if (fila > max) sh.insertRowsAfter(max, Math.max(200, fila - max));
}

function sello_(d) { return Utilities.formatDate(d, ZONA, 'yyyy-MM-dd HH:mm:ss'); }

function corta_(s, n) {
  s = String(s === null || s === undefined ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
