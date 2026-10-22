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
 *      instalar, restablecerAdministrador, revisarSeguridad, respaldoSemanal
 *      (las últimas cuatro se protegen solas; ver Instalacion.gs).
 *   2. Nunca se devuelven contraseñas, "sellos" ni IDs de Drive al cliente
 *      más allá de lo necesario.
 *   3. Lo que escribe el usuario se guarda como texto: si empieza con
 *      = + - @ se le antepone un apóstrofo para que la hoja no lo tome como
 *      fórmula.
 * ════════════════════════════════════════════════════════════════════════
 */

var VERSION = '1.2.0';   // súbela junto con VERSION_APP (App.html) en cada cambio
var ZONA = 'America/Mexico_City';
var ITERACIONES_CLAVE = 1000;      // PBKDF2-HMAC-SHA256
var MAX_INTENTOS = 5;              // contraseñas fallidas antes de bloquear
var MINUTOS_BLOQUEO = 15;
var SESION_SEG = 3 * 60 * 60;      // 3 h sin actividad cierran la sesión
var MAX_ARCHIVO_MB = 10;
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
    'version', 'origen'],
  Directorio: ['id', 'nombre', 'cargo', 'dependencia', 'activo', 'unido_a',
    'creado_por', 'creado_en', 'modificado_en'],
  Usuarios: ['usuario', 'nombre', 'rol', 'tipos', 'activo', 'clave', 'debe_cambiar',
    'intentos', 'bloqueado_hasta', 'sello', 'creado_en', 'ultimo_acceso'],
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
var ROLES = { admin: 'Administrador', captura: 'Captura', consulta: 'Consulta' };

/* ═══════════════════════════ Entrada de la app web ═════════════════════ */

function doGet() {
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
    incluir_('Estilos') + '</head><body>' + incluir_('Index') + incluir_('Excel') + incluir_('App') + '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Control de Gestión')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function incluir_(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
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
  try {
    datos = datos || {};
    if (typeof accion !== 'string') throw falla_('PETICION', 'Petición inválida.');
    if (accion === 'estado') return { ok: true, datos: estadoPublico_() };
    if (accion === 'entrar') return { ok: true, datos: entrar_(datos) };
    var yo = sesion_(token);
    var a = ACCIONES_[accion];
    if (!a || !Object.prototype.hasOwnProperty.call(ACCIONES_, accion)) throw falla_('PETICION', 'Acción desconocida.');
    if (yo.debe_cambiar && accion !== 'cambiarClave' && accion !== 'salir') {
      throw falla_('CAMBIAR_CLAVE', 'Antes de seguir tienes que cambiar tu contraseña temporal.');
    }
    if (a.rol && !tieneRol_(yo, a.rol)) throw falla_('PERMISO', 'No tienes permiso para esto.');
    return { ok: true, datos: a.fn(yo, datos, token) };
  } catch (e) {
    if (e && e.codigo) return { ok: false, codigo: e.codigo, error: e.message, extra: e.extra || null };
    var ref = Utilities.getUuid().slice(0, 8);
    console.error('api(' + accion + ') ref ' + ref + ': ' + (e && e.stack ? e.stack : e));
    return { ok: false, codigo: 'INTERNO', error: 'Ocurrió un error interno (referencia ' + ref + '). Intenta de nuevo.' };
  }
}

var ACCIONES_ = {
  salir: { fn: salir_ },
  cambiarClave: { fn: cambiarClave_ },
  inicio: { fn: inicio_ },
  indicadores: { fn: function (yo) { return indicadores_(yo); } },
  listar: { fn: listar_ },
  obtener: { fn: obtener_ },
  guardar: { fn: guardar_, rol: 'captura' },
  cancelar: { fn: cancelar_, rol: 'admin' },
  pendientes: { fn: pendientes_ },
  exportar: { fn: exportar_ },
  subirArchivo: { fn: subirArchivo_, rol: 'captura' },
  descargarArchivo: { fn: descargarArchivo_ },
  quitarArchivo: { fn: quitarArchivo_, rol: 'captura' },
  directorio: { fn: listarDirectorio_ },
  guardarPersona: { fn: guardarPersona_, rol: 'captura' },
  unirPersonas: { fn: unirPersonas_, rol: 'admin' },
  usuarios: { fn: listarUsuarios_, rol: 'admin' },
  guardarUsuario: { fn: guardarUsuario_, rol: 'admin' },
  restablecerClave: { fn: restablecerClave_, rol: 'admin' },
  bitacora: { fn: listarBitacora_, rol: 'admin' },
  guardarConfig: { fn: guardarConfig_, rol: 'admin' }
};

function falla_(codigo, mensaje, extra) {
  var e = new Error(mensaje);
  e.codigo = codigo;
  e.extra = extra;
  return e;
}

/* ═══════════════════════════ Sesión y contraseñas ═════════════════════ */

function estadoPublico_() {
  var cfg = config_();
  return { encabezados: [cfg.encabezado_1, cfg.encabezado_2, cfg.encabezado_3].filter(Boolean), version: VERSION };
}

function entrar_(d) {
  var usuario = String(d.usuario || '').trim().toLowerCase();
  var clave = String(d.clave || '');
  var cache = CacheService.getScriptCache();
  // Freno general contra ataques de fuerza bruta a muchos usuarios
  var minuto = 'login:' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMddHHmm');
  var intentosMinuto = Number(cache.get(minuto) || 0);
  if (intentosMinuto >= 60) throw falla_('ESPERA', 'Demasiados intentos. Espera un minuto.');
  cache.put(minuto, String(intentosMinuto + 1), 120);

  var t = tabla_(HOJAS.USR);
  var u = null;
  for (var i = 0; i < t.filas.length; i++) if (t.filas[i].o.usuario === usuario) { u = t.filas[i]; break; }
  var generico = falla_('CREDENCIALES', 'Usuario o contraseña incorrectos.');
  if (!u || !usuario || !clave) {
    verificarClave_(clave || 'x', 'pbkdf2$' + ITERACIONES_CLAVE + '$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'); // mismo tiempo de respuesta
    throw generico;
  }
  var o = u.o;
  var ahora = new Date();
  if (o.bloqueado_hasta && new Date(o.bloqueado_hasta) > ahora) {
    var min = Math.ceil((new Date(o.bloqueado_hasta) - ahora) / 60000);
    throw falla_('BLOQUEADO', 'Cuenta bloqueada por intentos fallidos. Intenta en ' + min + ' min o pide a un administrador que la desbloquee.');
  }
  if (!verificarClave_(clave, o.clave)) {
    o.intentos = Number(o.intentos || 0) + 1;
    if (o.intentos >= MAX_INTENTOS) {
      o.bloqueado_hasta = new Date(ahora.getTime() + MINUTOS_BLOQUEO * 60000).toISOString();
      o.intentos = 0;
      bitacora_(usuario, 'bloqueo', '', 'Cuenta bloqueada ' + MINUTOS_BLOQUEO + ' min por ' + MAX_INTENTOS + ' contraseñas incorrectas.');
    } else {
      bitacora_(usuario, 'entrada fallida', '', 'Contraseña incorrecta (' + o.intentos + ' de ' + MAX_INTENTOS + ').');
    }
    escribirFila_(t.sh, HOJAS.USR, u.fila, o);
    throw generico;
  }
  if (o.activo !== 'SI') throw falla_('INACTIVO', 'Tu cuenta está desactivada. Habla con un administrador.');
  o.intentos = 0;
  o.bloqueado_hasta = '';
  o.ultimo_acceso = sello_(ahora);
  escribirFila_(t.sh, HOJAS.USR, u.fila, o);
  bitacora_(usuario, 'entrar', '', '');
  return { token: abrirSesion_(o), debe_cambiar: o.debe_cambiar === 'SI', nombre: o.nombre };
}

function abrirSesion_(o) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('ses:' + token, JSON.stringify({ u: o.usuario, s: o.sello, t: Date.now() }), SESION_SEG);
  return token;
}

/** Devuelve el usuario de la sesión o lanza SESION. Revisa en la hoja que siga activo. */
function sesion_(token) {
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
  if (Date.now() - s.t > 5 * 60 * 1000) {  // renueva la ventana de inactividad
    s.t = Date.now();
    cache.put('ses:' + token, JSON.stringify(s), SESION_SEG);
  }
  return {
    usuario: u.usuario, nombre: u.nombre, rol: u.rol, debe_cambiar: u.debe_cambiar === 'SI',
    tipos: u.rol === 'admin' || u.tipos === '*' ? ORDEN_TIPOS.slice() :
      String(u.tipos || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return TIPOS[x]; })
  };
}

function salir_(yo, d, token) {
  CacheService.getScriptCache().remove('ses:' + token);
  bitacora_(yo.usuario, 'salir', '', '');
  return true;
}

function cambiarClave_(yo, d) {
  var t = tabla_(HOJAS.USR);
  var u = t.filas.filter(function (f) { return f.o.usuario === yo.usuario; })[0];
  if (!verificarClave_(String(d.actual || ''), u.o.clave)) throw falla_('CREDENCIALES', 'La contraseña actual no es correcta.');
  var nueva = String(d.nueva || '');
  validarClave_(nueva, yo.usuario);
  if (verificarClave_(nueva, u.o.clave)) throw falla_('DATOS', 'La nueva contraseña debe ser distinta de la actual.');
  u.o.clave = hashClave_(nueva);
  u.o.debe_cambiar = 'NO';
  u.o.sello = nuevoSello_();           // cierra las demás sesiones
  escribirFila_(t.sh, HOJAS.USR, u.fila, u.o);
  bitacora_(yo.usuario, 'cambio de contraseña', '', '');
  return { token: abrirSesion_(u.o) };
}

function validarClave_(clave, usuario) {
  if (clave.length < 8) throw falla_('DATOS', 'La contraseña debe tener al menos 8 caracteres.');
  if (clave.length > 128) throw falla_('DATOS', 'La contraseña es demasiado larga.');
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(clave) || !/\d/.test(clave)) throw falla_('DATOS', 'La contraseña debe tener letras y números.');
  if (clave.toLowerCase().indexOf(String(usuario).toLowerCase()) >= 0) throw falla_('DATOS', 'La contraseña no puede contener tu usuario.');
}

/** PBKDF2-HMAC-SHA256 con sal aleatoria. Formato: pbkdf2$iter$sal_b64$hash_b64 */
function hashClave_(clave, salB64, iter) {
  iter = iter || ITERACIONES_CLAVE;
  var sal = salB64 ? Utilities.base64Decode(salB64) : bytesAleatorios_(16);
  var dk = pbkdf2_(Utilities.newBlob(clave).getBytes(), sal, iter);
  return 'pbkdf2$' + iter + '$' + Utilities.base64Encode(sal) + '$' + Utilities.base64Encode(dk);
}

function pbkdf2_(clave, sal, iter) {
  var bloque = sal.concat([0, 0, 0, 1]);
  var u = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, bloque, clave);
  var t = u.slice();
  for (var i = 1; i < iter; i++) {
    u = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, u, clave);
    for (var j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return t;
}

function verificarClave_(clave, guardada) {
  var p = String(guardada || '').split('$');
  if (p.length !== 4 || p[0] !== 'pbkdf2') return false;
  var calc = hashClave_(clave, p[2], Number(p[1])).split('$')[3];
  var a = calc, b = p[3], dif = a.length ^ b.length;
  for (var i = 0; i < Math.min(a.length, b.length); i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function bytesAleatorios_(n) {
  var out = [];
  while (out.length < n) {
    out = out.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid() + Date.now(), Utilities.Charset.UTF_8));
  }
  return out.slice(0, n);
}

function nuevoSello_() { return Utilities.getUuid().replace(/-/g, ''); }

function claveTemporal_() {
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  var dig = '23456789';
  var b = bytesAleatorios_(12).map(function (x) { return x & 0xff; });
  var s = '';
  for (var i = 0; i < 8; i++) s += abc.charAt(b[i] % abc.length);
  return s.slice(0, 4) + dig.charAt(b[8] % 8) + dig.charAt(b[9] % 8) + s.slice(4);
}

function buscarUsuario_(usuario) {
  var t = tabla_(HOJAS.USR);
  for (var i = 0; i < t.filas.length; i++) if (t.filas[i].o.usuario === usuario) return t.filas[i].o;
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
  var regs = tabla_(HOJAS.REG).filas;
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
    yo: { usuario: yo.usuario, nombre: yo.nombre, rol: yo.rol, rolNombre: ROLES[yo.rol], tipos: yo.tipos },
    tipos: tipos, orden: yo.tipos, estatus: ESTATUS, roles: ROLES, todosTipos: TIPOS,
    config: { encabezados: [cfg.encabezado_1, cfg.encabezado_2, cfg.encabezado_3].filter(Boolean),
      plantilla_OFS: cfg.plantilla_OFS, plazo_dias: cfg.plazo_dias, url_web: cfg.url_web || '' },
    anioActual: anioActual,
    anios: Object.keys(anios).map(Number).sort(function (a, b) { return b - a; }),
    conteos: conteos,
    sugerenciasElaboro: Object.keys(elaboro).sort(function (a, b) { return elaboro[b] - elaboro[a]; }).slice(0, 60),
    indicadores: indicadores_(yo, regs),
    directorio: directorioActivo_(),
    version: VERSION
  };
}

/** Números de las tarjetas del portal: por libreta y en total (solo libretas propias). */
function indicadores_(yo, regs) {
  regs = regs || tabla_(HOJAS.REG).filas;
  var hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  var anio = Number(hoy.slice(0, 4)), mes = hoy.slice(0, 7);
  var porTipo = {}, global = { porAtender: 0, vencidos: 0, venceHoy: 0, sinAcuse: 0 };
  yo.tipos.forEach(function (t) { porTipo[t] = { total: 0, porAtender: 0, vencidos: 0, venceHoy: 0, sinAcuse: 0, esteMes: 0 }; });
  regs.forEach(function (f) {
    var r = f.o, p = porTipo[r.tipo];
    if (!p) return;
    var activo = r.estatus === 'Pendiente' || r.estatus === 'En trámite';
    if (activo) {
      p.porAtender++; global.porAtender++;
      if (r.fecha_limite && r.fecha_limite < hoy) { p.vencidos++; global.vencidos++; }
      else if (r.fecha_limite === hoy) { p.venceHoy++; global.venceHoy++; }
    }
    // global.sinAcuse = la sección "sin acuse" de Pendientes (sin repetir lo que ya está por atender)
    if (r.tipo === 'OFS' && r.acuse !== 'SI' && r.estatus !== 'Cancelado' && !activo && Number(r.anio) >= anio - 1) global.sinAcuse++;
    if (Number(r.anio) === anio) {
      p.total++;
      if (r.tipo === 'OFS' && r.acuse !== 'SI' && r.estatus !== 'Cancelado') p.sinAcuse++;   // igual que el indicador de la libreta
      if (String(r.fecha_recepcion || r.fecha).slice(0, 7) === mes) p.esteMes++;
    }
  });
  return { porTipo: porTipo, global: global, hoy: hoy };
}

function directorioActivo_() {
  return tabla_(HOJAS.DIR).filas.filter(function (f) { return f.o.activo === 'SI'; })
    .map(function (f) { return { id: f.o.id, nombre: f.o.nombre, cargo: f.o.cargo, dependencia: f.o.dependencia }; })
    .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
}

/* ═══════════════════════════ Registros ════════════════════════════════ */

var CAMPOS_LISTA = ['id', 'tipo', 'anio', 'consecutivo', 'sufijo', 'numero', 'asunto', 'dirigido_id', 'dirigido_a', 'firma_id', 'firma',
  'fecha', 'fecha_recepcion', 'elaboro', 'acuse', 'carpeta', 'estatus', 'fecha_limite', 'turnado_a', 'relacionado_id'];

function resumen_(r) {
  var o = {};
  CAMPOS_LISTA.forEach(function (c) { o[c] = r[c]; });
  o.asunto = corta_(r.asunto, 300);
  o.obs = corta_(r.observaciones, 200);
  o.tiene_archivo = !!r.archivo_id;
  o.tiene_acuse_archivo = !!r.acuse_archivo_id;
  return o;
}

function listar_(yo, d) {
  var tipo = String(d.tipo || '');
  puedeTipo_(yo, tipo);
  var anio = Number(d.anio) || Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
  return tabla_(HOJAS.REG).filas
    .filter(function (f) { return f.o.tipo === tipo && Number(f.o.anio) === anio; })
    .map(function (f) { return resumen_(f.o); })
    .sort(function (a, b) { return b.consecutivo - a.consecutivo || (b.sufijo > a.sufijo ? 1 : -1); });
}

function obtener_(yo, d) {
  var t = tabla_(HOJAS.REG);
  var f = buscarRegistro_(t, d.id);
  puedeTipo_(yo, f.o.tipo);
  var r = publico_(f.o);
  var ligados = t.filas.filter(function (x) {
    return x.o.id !== f.o.id && (x.o.relacionado_id === f.o.id || x.o.id === f.o.relacionado_id) && yo.tipos.indexOf(x.o.tipo) >= 0;
  }).map(function (x) { return resumen_(x.o); });
  var hist = tabla_(HOJAS.BIT).filas.filter(function (x) { return x.o.registro_id === f.o.id; })
    .map(function (x) { return x.o; }).reverse().slice(0, 100);
  return { registro: r, ligados: ligados, historial: hist };
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

function guardar_(yo, d) {
  var tipo = String(d.tipo || '');
  var nuevo = !d.id;
  var limpio = validarRegistro_(d, tipo);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
      var anio = Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
      revisarDuplicado_(t, tipo, anio, limpio.numero, null, d.confirmarDuplicado);
      var max = 0;
      t.filas.forEach(function (f) {
        if (f.o.tipo === tipo && Number(f.o.anio) === anio) max = Math.max(max, Number(f.o.consecutivo) || 0);
      });
      r = {};
      COLS.Registros.forEach(function (c) { r[c] = ''; });
      r.id = 'r' + Utilities.getUuid().replace(/-/g, '').slice(0, 15);
      r.tipo = tipo;
      r.anio = anio;
      r.consecutivo = max + 1;
      EDITABLES.forEach(function (c) { r[c] = limpio[c]; });
      if (TIPOS[tipo].numeroAuto) r.numero = numeroOficial_(tipo, r.consecutivo, '', anio);
      r.creado_por = yo.usuario;
      r.creado_en = ahora;
      r.modificado_por = yo.usuario;
      r.modificado_en = ahora;
      r.version = 1;
      r.origen = 'App';
      escribirFila_(t.sh, HOJAS.REG, t.sh.getLastRow() + 1, r);
      bitacora_(yo.usuario, 'alta', r.id, TIPOS[tipo].singular + ' ' + etiquetaNum_(r) + ': ' + corta_(r.asunto, 120));
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
      var cambios = [];
      EDITABLES.forEach(function (c) {
        if (TIPOS[r.tipo].numeroAuto && c === 'numero') return;
        if (String(r[c]) !== String(limpio[c])) {
          if (c.slice(-3) !== '_id') cambios.push(c + ': «' + corta_(r[c], 60) + '» → «' + corta_(limpio[c], 60) + '»');
          r[c] = limpio[c];
        }
      });
      if (!cambios.length) return { registro: publico_(r), sinCambios: true };
      r.modificado_por = yo.usuario;
      r.modificado_en = ahora;
      r.version = Number(r.version) + 1;
      escribirFila_(t.sh, HOJAS.REG, f.fila, r);
      bitacora_(yo.usuario, 'edición', r.id, cambios.join(' · '));
    }
    // "Responder": deja el original como Atendido
    if (nuevo && d.marcarAtendido && r.relacionado_id) {
      var orig = t.filas.filter(function (x) { return x.o.id === r.relacionado_id; })[0];
      if (orig && yo.tipos.indexOf(orig.o.tipo) >= 0 && ['', 'Pendiente', 'En trámite'].indexOf(orig.o.estatus) >= 0) {
        orig.o.estatus = 'Atendido';
        orig.o.modificado_por = yo.usuario;
        orig.o.modificado_en = ahora;
        orig.o.version = Number(orig.o.version) + 1;
        escribirFila_(t.sh, HOJAS.REG, orig.fila, orig.o);
        bitacora_(yo.usuario, 'edición', orig.o.id, 'estatus → «Atendido» (respondido con ' + TIPOS[r.tipo].singular + ' ' + etiquetaNum_(r) + ')');
      }
    }
    return { registro: publico_(r) };
  } finally {
    lock.releaseLock();
  }
}

function validarRegistro_(d, tipo) {
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
  // Los IDs del directorio deben existir; si no, se borran (queda el texto)
  if (o.dirigido_id || o.firma_id) {
    var ids = {};
    tabla_(HOJAS.DIR).filas.forEach(function (f) { ids[f.o.id] = true; });
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
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
    lock.releaseLock();
  }
}

function pendientes_(yo) {
  var anio = Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'));
  var porAtender = [], sinAcuse = [];
  tabla_(HOJAS.REG).filas.forEach(function (f) {
    var r = f.o;
    if (yo.tipos.indexOf(r.tipo) < 0) return;
    if (r.estatus === 'Pendiente' || r.estatus === 'En trámite') porAtender.push(resumen_(r));
    else if (r.tipo === 'OFS' && r.acuse !== 'SI' && r.estatus !== 'Cancelado' && Number(r.anio) >= anio - 1) sinAcuse.push(resumen_(r));
  });
  porAtender.sort(function (a, b) {
    return (a.fecha_limite || '9999') < (b.fecha_limite || '9999') ? -1 : (a.fecha_limite || '9999') > (b.fecha_limite || '9999') ? 1 : 0;
  });
  sinAcuse.sort(function (a, b) { return (a.fecha || '') < (b.fecha || '') ? -1 : 1; });
  return { porAtender: porAtender, sinAcuse: sinAcuse };
}

function exportar_(yo, d) {
  var tipos = d.tipo === 'TODOS' ? yo.tipos : [String(d.tipo || '')];
  tipos.forEach(function (t) { puedeTipo_(yo, t); });
  var anio = Number(d.anio);
  if (!(anio >= 2000 && anio <= 2100)) throw falla_('DATOS', 'Año inválido.');
  var filas = tabla_(HOJAS.REG).filas
    .filter(function (f) { return tipos.indexOf(f.o.tipo) >= 0 && Number(f.o.anio) === anio; })
    .map(function (f) { return publico_(f.o); });
  bitacora_(yo.usuario, 'exportación', '', 'Excel de ' + (d.tipo === 'TODOS' ? 'todas las libretas' : TIPOS[tipos[0]].nombre) + ' ' + anio + ' (' + filas.length + ' registros)');
  return { filas: filas };
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
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = tabla_(HOJAS.REG);
    var f = buscarRegistro_(t, d.id);
    puedeTipo_(yo, f.o.tipo);
    if (f.o.estatus === 'Cancelado') throw falla_('DATOS', 'El registro está cancelado.');
    var ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mime];
    var nombre = f.o.tipo + ' ' + etiquetaNum_(f.o).replace('/', '-') + ' ' + clase + ext;
    var archivo = carpetaArchivos_().createFile(Utilities.newBlob(bytes, mime, nombre));
    var campo = clase === 'acuse' ? 'acuse_archivo' : 'archivo';
    var anterior = f.o[campo + '_id'];
    f.o[campo + '_id'] = archivo.getId();
    f.o[campo + '_nombre'] = corta_(String(d.nombre || nombre).replace(/[\\/:*?"<>|]/g, '_'), 120);
    if (clase === 'acuse') f.o.acuse = 'SI';
    f.o.modificado_por = yo.usuario;
    f.o.modificado_en = sello_(new Date());
    f.o.version = Number(f.o.version) + 1;
    escribirFila_(t.sh, HOJAS.REG, f.fila, f.o);
    if (anterior) { try { DriveApp.getFileById(anterior).setTrashed(true); } catch (e) { /* ya no estaba */ } }
    bitacora_(yo.usuario, 'archivo', f.o.id, (anterior ? 'Reemplazó ' : 'Subió ') + (clase === 'acuse' ? 'el acuse' : 'el documento') + ': ' + f.o[campo + '_nombre']);
    return { registro: publico_(f.o) };
  } finally {
    lock.releaseLock();
  }
}

function descargarArchivo_(yo, d) {
  var clase = d.clase === 'acuse' ? 'acuse' : 'oficio';
  var t = tabla_(HOJAS.REG);
  var f = buscarRegistro_(t, d.id);
  puedeTipo_(yo, f.o.tipo);
  var campo = clase === 'acuse' ? 'acuse_archivo' : 'archivo';
  var id = f.o[campo + '_id'];
  if (!id) throw falla_('NO_EXISTE', 'Este registro no tiene ese archivo.');
  var archivo = DriveApp.getFileById(id);
  // Defensa extra: solo se entregan archivos de la carpeta del sistema
  var carpeta = carpetaArchivos_().getId(), propio = false, padres = archivo.getParents();
  while (padres.hasNext()) if (padres.next().getId() === carpeta) propio = true;
  if (!propio || archivo.isTrashed()) throw falla_('NO_EXISTE', 'El archivo ya no está disponible.');
  var blob = archivo.getBlob();
  bitacora_(yo.usuario, 'descarga', f.o.id, (clase === 'acuse' ? 'Acuse' : 'Documento') + ': ' + f.o[campo + '_nombre']);
  return { nombre: f.o[campo + '_nombre'] || archivo.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function quitarArchivo_(yo, d) {
  var clase = d.clase === 'acuse' ? 'acuse' : 'oficio';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = tabla_(HOJAS.REG);
    var f = buscarRegistro_(t, d.id);
    puedeTipo_(yo, f.o.tipo);
    if (f.o.estatus === 'Cancelado' && yo.rol !== 'admin') throw falla_('PERMISO', 'El registro está cancelado.');
    var campo = clase === 'acuse' ? 'acuse_archivo' : 'archivo';
    var id = f.o[campo + '_id'];
    if (!id) return { registro: publico_(f.o) };
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* ya no estaba */ }
    var nombre = f.o[campo + '_nombre'];
    f.o[campo + '_id'] = '';
    f.o[campo + '_nombre'] = '';
    f.o.modificado_por = yo.usuario;
    f.o.modificado_en = sello_(new Date());
    f.o.version = Number(f.o.version) + 1;
    escribirFila_(t.sh, HOJAS.REG, f.fila, f.o);
    bitacora_(yo.usuario, 'archivo', f.o.id, 'Quitó ' + (clase === 'acuse' ? 'el acuse' : 'el documento') + ': ' + nombre + ' (queda en la papelera de Drive 30 días)');
    return { registro: publico_(f.o) };
  } finally {
    lock.releaseLock();
  }
}

/* ═══════════════════════════ Directorio ═══════════════════════════════ */

function listarDirectorio_(yo) {
  var usos = {};
  tabla_(HOJAS.REG).filas.forEach(function (f) {
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
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
    lock.releaseLock();
  }
}

/** Junta dos fichas de la misma persona: los registros de «de» pasan a «a». */
function unirPersonas_(yo, d) {
  if (!d.de || !d.a || d.de === d.a) throw falla_('DATOS', 'Elige dos personas distintas.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
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
    lock.releaseLock();
  }
}

/* ═══════════════════════════ Usuarios ═════════════════════════════════ */

function listarUsuarios_() {
  var ahora = new Date();
  return tabla_(HOJAS.USR).filas.map(function (f) {
    var o = f.o;
    return { usuario: o.usuario, nombre: o.nombre, rol: o.rol, tipos: o.tipos, activo: o.activo,
      debe_cambiar: o.debe_cambiar, bloqueado: !!(o.bloqueado_hasta && new Date(o.bloqueado_hasta) > ahora),
      creado_en: o.creado_en, ultimo_acceso: o.ultimo_acceso };
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
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = tabla_(HOJAS.USR);
    var ahora = sello_(new Date());
    if (d.nuevo) {
      var usuario = String(d.usuario || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(usuario)) throw falla_('DATOS', 'El usuario debe tener de 3 a 30 letras minúsculas, números, punto o guion, sin espacios ni acentos.');
      if (t.filas.some(function (f) { return f.o.usuario === usuario; })) throw falla_('DATOS', 'Ese usuario ya existe.');
      var temporal = claveTemporal_();
      var u = { usuario: usuario, nombre: nombre, rol: rol, tipos: tipos, activo: activo, clave: hashClave_(temporal),
        debe_cambiar: 'SI', intentos: 0, bloqueado_hasta: '', sello: nuevoSello_(), creado_en: ahora, ultimo_acceso: '' };
      escribirFila_(t.sh, HOJAS.USR, t.sh.getLastRow() + 1, u);
      bitacora_(yo.usuario, 'usuarios', '', 'Alta de ' + usuario + ' (' + ROLES[rol] + ', ' + tipos + ')');
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
    var antes = f.o.rol + '/' + f.o.tipos + '/' + f.o.activo;
    var cerrar = f.o.activo !== activo || f.o.rol !== rol || f.o.tipos !== tipos;
    f.o.nombre = nombre; f.o.rol = rol; f.o.tipos = tipos; f.o.activo = activo;
    if (d.desbloquear) { f.o.bloqueado_hasta = ''; f.o.intentos = 0; }
    if (cerrar) f.o.sello = nuevoSello_();   // permisos nuevos = sesión nueva
    escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
    bitacora_(yo.usuario, 'usuarios', '', 'Cambió ' + f.o.usuario + ': ' + antes + ' → ' + rol + '/' + tipos + '/' + activo + (d.desbloquear ? ' (desbloqueado)' : ''));
    return { usuario: f.o.usuario };
  } finally {
    lock.releaseLock();
  }
}

function restablecerClave_(yo, d) {
  var t = tabla_(HOJAS.USR);
  var f = t.filas.filter(function (x) { return x.o.usuario === d.usuario; })[0];
  if (!f) throw falla_('NO_EXISTE', 'Ese usuario no existe.');
  var temporal = claveTemporal_();
  f.o.clave = hashClave_(temporal);
  f.o.debe_cambiar = 'SI';
  f.o.intentos = 0;
  f.o.bloqueado_hasta = '';
  f.o.sello = nuevoSello_();
  escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
  bitacora_(yo.usuario, 'usuarios', '', 'Restableció la contraseña de ' + f.o.usuario);
  return { usuario: f.o.usuario, temporal: temporal };
}

/* ═══════════════════════════ Bitácora y configuración ═════════════════ */

function bitacora_(usuario, accion, registroId, detalle) {
  var sh = hoja_(HOJAS.BIT);
  var fila = [sello_(new Date()), usuario, accion, registroId || '', corta_(detalle, 2000)].map(seguro_);
  var n = sh.getLastRow() + 1;
  asegurarFilas_(sh, n);
  var rng = sh.getRange(n, 1, 1, fila.length);
  rng.setNumberFormat('@');
  rng.setValues([fila]);
}

function listarBitacora_(yo, d) {
  var desde = String(d.desde || ''), hasta = String(d.hasta || '');
  var usuario = String(d.usuario || ''), accion = String(d.accion || '');
  var q = String(d.texto || '').toLowerCase();
  var filas = tabla_(HOJAS.BIT).filas.map(function (f) { return f.o; }).filter(function (o) {
    var dia = String(o.fecha).slice(0, 10);
    return (!desde || dia >= desde) && (!hasta || dia <= hasta) && (!usuario || o.usuario === usuario) &&
      (!accion || o.accion === accion) && (!q || (o.detalle + ' ' + o.registro_id).toLowerCase().indexOf(q) >= 0);
  });
  var usuarios = {}, acciones = {};
  tabla_(HOJAS.BIT).filas.forEach(function (f) { usuarios[f.o.usuario] = true; acciones[f.o.accion] = true; });
  return { filas: filas.reverse().slice(0, 500), total: filas.length, usuarios: Object.keys(usuarios).sort(), acciones: Object.keys(acciones).sort() };
}

function config_() {
  var o = {};
  tabla_(HOJAS.CFG).filas.forEach(function (f) { o[f.o.clave] = f.o.valor; });
  return o;
}

var CONFIG_EDITABLE = ['encabezado_1', 'encabezado_2', 'encabezado_3', 'plantilla_OFS', 'plazo_dias', 'url_web'];

function guardarConfig_(yo, d) {
  var t = tabla_(HOJAS.CFG);
  var cambios = [];
  CONFIG_EDITABLE.forEach(function (k) {
    if (d[k] === undefined) return;
    var v = String(d[k]).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (k === 'plantilla_OFS' && v && v.indexOf('{NNN}') < 0) throw falla_('DATOS', 'La plantilla debe incluir {NNN} (el consecutivo).');
    if (k === 'plazo_dias' && v && !/^\d{1,3}$/.test(v)) throw falla_('DATOS', 'El plazo debe ser un número de días.');
    if (k === 'url_web' && v && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s"'<>]*)?$/i.test(v)) throw falla_('DATOS', 'La dirección debe empezar con https:// (por ejemplo https://control-gestion.vercel.app).');
    var f = t.filas.filter(function (x) { return x.o.clave === k; })[0];
    if (f && f.o.valor !== v) {
      cambios.push(k + ': «' + f.o.valor + '» → «' + v + '»');
      f.o.valor = v;
      escribirFila_(t.sh, HOJAS.CFG, f.fila, f.o);
    } else if (!f) {
      cambios.push(k + ': «' + v + '»');
      escribirFila_(t.sh, HOJAS.CFG, t.sh.getLastRow() + 1, { clave: k, valor: v, descripcion: '' });
    }
  });
  if (cambios.length) bitacora_(yo.usuario, 'configuración', '', cambios.join(' · '));
  return config_();
}

/* ═══════════════════════════ Acceso a la hoja ═════════════════════════ */

function libro_() {
  var id = PropertiesService.getScriptProperties().getProperty('ID_HOJA');
  if (!id) throw falla_('INSTALACION', 'El sistema no está instalado. Corre instalar() desde el editor de Apps Script.');
  return SpreadsheetApp.openById(id);
}

function hoja_(nombre) {
  var sh = libro_().getSheetByName(nombre);
  if (!sh) throw falla_('INSTALACION', 'Falta la pestaña «' + nombre + '». Corre instalar() desde el editor.');
  return sh;
}

/** Lee una pestaña completa → { sh, filas: [{ fila, o }] } (fila = número de renglón en la hoja). */
function tabla_(nombre) {
  var sh = hoja_(nombre);
  var cols = COLS[nombre];
  var n = Math.max(1, sh.getLastRow());
  var todo = sh.getRange(1, 1, n, cols.length).getValues();
  for (var c0 = 0; c0 < cols.length; c0++) {
    if (String(todo[0][c0]).trim() !== cols[c0]) {
      throw falla_('INSTALACION', 'Las columnas de la pestaña «' + nombre + '» no son las esperadas (columna ' + (c0 + 1) +
        ' debería ser «' + cols[c0] + '»). No muevas columnas a mano; corre revisarSeguridad() desde el editor.');
    }
  }
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
  return { sh: sh, filas: filas };
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

function escribirFila_(sh, nombre, fila, o) {
  var cols = COLS[nombre];
  var num = NUMERICAS[nombre] || {};
  var valores = cols.map(function (c) {
    var v = o[c];
    if (num[c]) return v === '' || v === null || v === undefined ? '' : Number(v);
    return seguro_(v === null || v === undefined ? '' : String(v));
  });
  asegurarFilas_(sh, fila);
  var rng = sh.getRange(fila, 1, 1, cols.length);
  rng.setNumberFormats([cols.map(function (c) { return num[c] ? '0' : '@'; })]);
  rng.setValues([valores]);
}

/** Reescribe en una sola operación el bloque que va de la primera a la última fila cambiada. */
function escribirVarias_(t, nombre, cambiadas) {
  if (!cambiadas.length) return;
  if (cambiadas.length <= 5) { cambiadas.forEach(function (f) { escribirFila_(t.sh, nombre, f.fila, f.o); }); return; }
  var cols = COLS[nombre], num = NUMERICAS[nombre] || {};
  var porFila = {};
  t.filas.forEach(function (f) { porFila[f.fila] = f.o; });
  var desde = Math.min.apply(null, cambiadas.map(function (f) { return f.fila; }));
  var hasta = Math.max.apply(null, cambiadas.map(function (f) { return f.fila; }));
  var valores = [], formatos = [];
  for (var r = desde; r <= hasta; r++) {
    var o = porFila[r] || {};
    valores.push(cols.map(function (c) {
      var v = o[c];
      if (num[c]) return v === '' || v === null || v === undefined ? '' : Number(v);
      return seguro_(v === null || v === undefined ? '' : String(v));
    }));
    formatos.push(cols.map(function (c) { return num[c] ? '0' : '@'; }));
  }
  var rng = t.sh.getRange(desde, 1, hasta - desde + 1, cols.length);
  rng.setNumberFormats(formatos);
  rng.setValues(valores);
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
