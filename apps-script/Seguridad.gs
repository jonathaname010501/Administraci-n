/**
 * ════════════════════════════════════════════════════════════════════════
 *  CONTROL DE GESTIÓN · Seguridad de acceso (1.7.0)
 *
 *   · Entrar: freno general que solo cuenta intentos FALLIDOS, bloqueo de la
 *     cuenta que crece si se repite (15 min → 1 h → 4 h) y «equipo de
 *     confianza»: quien ya entró desde ese equipo y pidió que lo recordara
 *     no se queda fuera aunque alguien más esté provocando bloqueos.
 *   · Contraseñas: PBKDF2-HMAC-SHA256 con sal y con «pimienta» (un secreto
 *     que vive en las propiedades del script, NO en la hoja: si alguien
 *     copia la hoja, los hashes no le sirven). Las repeticiones se calibran
 *     al instalar para que cifrar tarde ~0.35 s, y cada contraseña se vuelve
 *     a cifrar sola al entrar si usa el formato o las repeticiones anteriores.
 *   · Reglas: 10 caracteres o más, letras y números, sin usuario ni nombre y
 *     sin palabras obvias del trabajo (las mismas listas que App.html).
 *   · Verificación en dos pasos (TOTP, RFC 6238), compatible con Google
 *     Authenticator, Microsoft Authenticator y similares.
 *   · Aviso de consultas inusuales (muchas aperturas o descargas en un día).
 *
 *  Todo aquí es privado (termina en _); se llega solo a través de api().
 * ════════════════════════════════════════════════════════════════════════
 */

var ITERACIONES_MIN = 1000;          // nunca menos que en la 1.6.0
var ITERACIONES_MAX = 60000;
var MILIS_OBJETIVO = 350;            // lo que debe tardar cifrar una contraseña en Apps Script
var MAX_INTENTOS = 5;                // contraseñas (o códigos) fallidos antes de bloquear la cuenta
var BLOQUEOS_MIN = [15, 60, 240];    // minutos del 1.º, 2.º y 3.º+ bloqueo (si se repite antes de 6 h)
var LIMITE_FALLAS_MINUTO = 30;       // intentos fallidos de todo el sistema por minuto
var DIAS_EQUIPO = 180;               // vigencia del «equipo de confianza»
var MAX_FALLAS_EQUIPO = 10;          // con más fallas (en 6 h), ese equipo deja de contar como de confianza
var MIN_CLAVE = 10;
var TICKET_SEG = 300;                // tiempo para escribir el código de dos pasos
var CACHE_MAX = 21600;               // CacheService guarda máximo 6 h

/* Palabras que hacen fácil de adivinar una contraseña. Las MISMAS listas
   están en AppEntrada.html (la prueba revisa que coincidan). Se comparan sin
   acentos, en minúsculas y solo con las letras de la contraseña. */
var CLAVE_CONTIENE = ['contrasena', 'password', 'passw', 'gestion', 'minutario', 'oficio', 'secretari', 'subsecretari',
  'administrador', 'usuario', 'bienvenid', 'territorio', 'gabinete', 'igualdad', 'ciudaddemexico', 'cdmx', 'sapci', 'stpi',
  'mexico', 'control', 'qwert', 'asdfg', 'zxcvb', 'abcde'];
var CLAVE_EXACTAS = ['paz', 'hola', 'admin', 'amor', 'teamo', 'abc', 'pass', 'prueba', 'test', 'mama', 'papa', 'dios', 'familia',
  'america', 'chivas', 'pumas', 'cruzazul', 'tigres', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
  'primavera', 'verano', 'otono', 'invierno', 'clave', 'acceso', 'sistema'];

/* ═══════════════════════════ Entrar ═══════════════════════════════════ */

function entrar_(d) {
  var usuario = String(d.usuario || '').trim().toLowerCase();
  var clave = String(d.clave || '');
  var minuto = 'loginf:' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMddHHmm');
  var equipo = usuario ? equipoValido_(d.equipo, usuario) : false;
  if (!equipo && Number(CacheService.getScriptCache().get(minuto) || 0) >= LIMITE_FALLAS_MINUTO) {
    throw falla_('ESPERA', 'Hay demasiados intentos fallidos en este momento. Espera un minuto e intenta de nuevo.');
  }
  var generico = falla_('CREDENCIALES', 'Usuario o contraseña incorrectos.');
  var u = usuario && clave ? buscarUsuario_(usuario) : null;
  if (!u) {
    verificarClave_(clave || 'x', hashFalso_());   // mismo tiempo de respuesta que con un usuario real
    contarFalla_(minuto, equipo, d.equipo);
    throw generico;
  }
  var ahora = new Date();
  if (!equipo) revisarBloqueo_(u, ahora);
  var ok = verificarClave_(clave, u.clave);
  // Cifrar otra vez (si hace falta) es lento: se hace antes de tomar el candado.
  var nuevoHash = ok && necesitaRecifrar_(u.clave) ? hashClave_(clave) : null;
  var res = null, ticket = null;
  var lock = candado_(20000);
  try {
    // Se vuelve a leer la fila DENTRO del candado: un administrador pudo
    // desactivarla o cambiarle permisos mientras se revisaba la contraseña.
    var t = tabla_(HOJAS.USR), f = filaUsuario_(t, usuario);
    if (!f) throw generico;
    var o = f.o;
    if (o.clave !== u.clave) { ok = verificarClave_(clave, o.clave); nuevoHash = null; }
    if (!ok) {
      contarFalla_(minuto, equipo, d.equipo);
      registrarFallaCuenta_(o, ahora, 'Contraseña incorrecta');
      escribirFila_(t.sh, HOJAS.USR, f.fila, o);
      throw generico;
    }
    if (o.activo !== 'SI') throw falla_('INACTIVO', 'Tu cuenta está desactivada. Habla con un administrador.');
    var mant = mantenimiento_();
    if (mant.activo && o.rol !== 'admin') throw falla_('MANTENIMIENTO', mant.mensaje);
    if (nuevoHash) o.clave = nuevoHash;
    var motivo = '';
    // Se acaba de escribir bien: si ya no cumple las reglas, se pide cambiarla.
    if (o.debe_cambiar !== 'SI' && problemaClave_(clave, o.usuario, o.nombre)) { o.debe_cambiar = 'SI'; motivo = 'reglas'; }
    if (o.totp) {
      // Falta el segundo paso. Los intentos NO se reinician hasta que el código también esté bien.
      if (nuevoHash || motivo) escribirFila_(t.sh, HOJAS.USR, f.fila, o);
      ticket = nuevoTicket_({ u: o.usuario, recordar: !!d.recordar, motivo: motivo, equipo: equipo ? String(d.equipo) : '' });
    } else {
      res = completarEntrada_(t, f, o, ahora, { recordar: !!d.recordar, motivo: motivo, equipo: equipo });
    }
  } finally {
    soltar_(lock);
  }
  if (ticket) return { requiereCodigo: true, ticket: ticket };
  return conInicio_(res);
}

/** Segundo paso: el código de 6 dígitos de la app de autenticación. */
function entrarCodigo_(d) {
  var cache = CacheService.getScriptCache();
  var ticket = String(d.ticket || '');
  var vencido = falla_('CODIGO_VENCIDO', 'Pasó demasiado tiempo. Vuelve a escribir tu contraseña.');
  if (!/^[0-9a-f]{40}$/.test(ticket)) throw vencido;
  var raw = cache.get('pre:' + ticket);
  if (!raw) throw vencido;
  var p = JSON.parse(raw);
  var u = buscarUsuario_(p.u);
  if (!u || !u.totp) { cache.remove('pre:' + ticket); throw vencido; }
  var ahora = new Date();
  var equipo = p.equipo ? equipoValido_(p.equipo, p.u) : false;
  if (!equipo) revisarBloqueo_(u, ahora);
  var codigo = String(d.codigo || '').replace(/\D/g, '');
  var paso = codigo.length === 6 ? totpVerificar_(descifrarTotp_(u.usuario, u.totp), codigo, Number(cache.get('totpu:' + u.usuario) || 0)) : -1;
  var res = null;
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.USR), f = filaUsuario_(t, p.u);
    if (!f || f.o.activo !== 'SI') { cache.remove('pre:' + ticket); throw falla_('INACTIVO', 'Tu cuenta está desactivada. Habla con un administrador.'); }
    if (paso < 0) {
      p.n = (p.n || 0) + 1;
      if (p.n >= MAX_INTENTOS) cache.remove('pre:' + ticket); else cache.put('pre:' + ticket, JSON.stringify(p), TICKET_SEG);
      registrarFallaCuenta_(f.o, ahora, 'Código de verificación incorrecto');
      escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
      throw falla_('CODIGO', 'El código no es correcto. Escribe el que muestra ahora tu app (revisa que la hora del teléfono esté bien).' +
        (p.n >= MAX_INTENTOS ? ' Vuelve a escribir tu contraseña.' : ''), { reiniciar: p.n >= MAX_INTENTOS });
    }
    cache.remove('pre:' + ticket);
    cache.put('totpu:' + p.u, String(paso), 600);   // ese código ya no se puede volver a usar
    res = completarEntrada_(t, f, f.o, ahora, { recordar: p.recordar, motivo: p.motivo, equipo: equipo, dosPasos: true });
  } finally {
    soltar_(lock);
  }
  return conInicio_(res);
}

/** Dentro del candado: deja la fila al día, anota la entrada y abre la sesión. */
function completarEntrada_(t, f, o, ahora, op) {
  o.intentos = 0;
  o.bloqueado_hasta = '';
  o.ultimo_acceso = sello_(ahora);
  escribirFila_(t.sh, HOJAS.USR, f.fila, o);
  bitacora_(o.usuario, 'entrar', '', [op.dosPasos ? 'con verificación en dos pasos' : '', op.equipo ? 'desde un equipo de confianza' : ''].filter(Boolean).join(', '));
  var yo = yoDe_(o);
  return { token: abrirSesion_(o), debe_cambiar: o.debe_cambiar === 'SI', motivo: op.motivo || '', nombre: o.nombre,
    equipo: op.recordar ? nuevoEquipo_(o.usuario) : null, activar2fa: debeActivar2fa_(yo), _yo: yo };
}

/** Ya sin el candado: la entrada trae los datos del portal (una vuelta menos). */
function conInicio_(res) {
  var yo = res._yo;
  delete res._yo;
  if (!res.debe_cambiar && !res.activar2fa) {
    try { res.inicio = inicio_(yo); } catch (e) { console.warn('entrar: sin inicio (' + e.message + ')'); }
  }
  return res;
}

function filaUsuario_(t, usuario) {
  for (var i = 0; i < t.filas.length; i++) if (t.filas[i].o.usuario === usuario) return t.filas[i];
  return null;
}

function revisarBloqueo_(u, ahora) {
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > ahora) {
    var min = Math.ceil((new Date(u.bloqueado_hasta) - ahora) / 60000);
    throw falla_('BLOQUEADO', 'Cuenta bloqueada por intentos fallidos. Intenta en ' + min + ' min o pide a un administrador que la desbloquee.');
  }
}

/** Cuenta una falla de la cuenta y, a la quinta, la bloquea (cada vez por más tiempo si se repite antes de 6 h). */
function registrarFallaCuenta_(o, ahora, motivo) {
  var cache = CacheService.getScriptCache();
  o.intentos = Number(o.intentos || 0) + 1;
  if (o.intentos >= MAX_INTENTOS) {
    var nivel = Number(cache.get('bloq:' + o.usuario) || 0);
    var minutos = BLOQUEOS_MIN[Math.min(nivel, BLOQUEOS_MIN.length - 1)];
    o.bloqueado_hasta = new Date(ahora.getTime() + minutos * 60000).toISOString();
    o.intentos = 0;
    cache.put('bloq:' + o.usuario, String(nivel + 1), CACHE_MAX);
    bitacora_(o.usuario, 'bloqueo', '', 'Cuenta bloqueada ' + minutos + ' min por ' + MAX_INTENTOS + ' intentos fallidos' +
      (nivel ? ' (bloqueo ' + (nivel + 1) + ' seguido)' : '') + '. Último: ' + motivo.toLowerCase() + '.');
  } else {
    bitacora_(o.usuario, 'entrada fallida', '', motivo + ' (' + o.intentos + ' de ' + MAX_INTENTOS + ').');
  }
}

/** El freno general solo cuenta FALLAS. Con equipo de confianza, cuenta aparte (y si son muchas, el equipo deja de servir). */
function contarFalla_(minuto, equipo, tokenEquipo) {
  var cache = CacheService.getScriptCache();
  var k = equipo ? 'eqf:' + String(tokenEquipo).split('.')[1].slice(0, 40) : minuto;
  cache.put(k, String(Number(cache.get(k) || 0) + 1), equipo ? CACHE_MAX : 120);
}

function nuevoTicket_(datos) {
  var ticket = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  datos.n = 0;
  CacheService.getScriptCache().put('pre:' + ticket, JSON.stringify(datos), TICKET_SEG);
  return ticket;
}

/* ─────────── Equipo de confianza ───────────
   Un comprobante firmado (usuario + vencimiento) que la página guarda solo si
   la persona marca «Recordar mi usuario en este equipo». No abre la sesión:
   la contraseña (y el código) se piden igual; solo evita quedarse fuera por
   bloqueos que provoque alguien más. */

function nuevoEquipo_(usuario) {
  var cuerpo = usuario + '|' + (Date.now() + DIAS_EQUIPO * 86400000).toString(36);
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(cuerpo).getBytes()) + '.' + firmaEquipo_(cuerpo);
}

function firmaEquipo_(texto) {
  var f = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, Utilities.newBlob(texto).getBytes(),
    Utilities.base64Decode(secreto_('SECRETO_EQUIPOS')));
  return Utilities.base64EncodeWebSafe(f).replace(/=+$/, '');
}

function equipoValido_(token, usuario) {
  if (typeof token !== 'string' || token.length > 400) return false;
  var partes = token.split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return false;
  var cuerpo;
  try { cuerpo = Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString(); } catch (e) { return false; }
  var c = cuerpo.split('|');
  if (c.length !== 2 || c[0] !== usuario || !(parseInt(c[1], 36) > Date.now())) return false;
  if (!igualSeguro_(firmaEquipo_(cuerpo), partes[1])) return false;
  return Number(CacheService.getScriptCache().get('eqf:' + partes[1].slice(0, 40)) || 0) < MAX_FALLAS_EQUIPO;
}

/* ═══════════════════════════ Contraseñas ═══════════════════════════════ */

function cambiarClave_(yo, d) {
  var u = buscarUsuario_(yo.usuario);
  var actual = String(d.actual || '');
  if (!verificarClave_(actual, u.clave)) {
    var l0 = candado_(20000);
    try {
      var t0 = tabla_(HOJAS.USR), f0 = filaUsuario_(t0, yo.usuario);
      registrarFallaCuenta_(f0.o, new Date(), 'Contraseña actual incorrecta al cambiarla');
      escribirFila_(t0.sh, HOJAS.USR, f0.fila, f0.o);
    } finally { soltar_(l0); }
    throw falla_('CREDENCIALES', 'La contraseña actual no es correcta.');
  }
  var nueva = String(d.nueva || '');
  validarClave_(nueva, yo.usuario, u.nombre);
  if (verificarClave_(nueva, u.clave)) throw falla_('DATOS', 'La nueva contraseña debe ser distinta de la actual.');
  var hash = hashClave_(nueva);   // fuera del candado (tarda)
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.USR), f = filaUsuario_(t, yo.usuario);
    if (!f || f.o.clave !== u.clave) throw falla_('CAMBIO', 'Tu contraseña cambió mientras tanto. Sal y vuelve a entrar.');
    f.o.clave = hash;
    f.o.debe_cambiar = 'NO';
    f.o.sello = nuevoSello_();           // cierra las demás sesiones
    escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
    bitacora_(yo.usuario, 'cambio de contraseña', '', '');
    return { token: abrirSesion_(f.o) };
  } finally {
    soltar_(lock);
  }
}

function validarClave_(clave, usuario, nombre) {
  var p = problemaClave_(clave, usuario, nombre);
  if (p) throw falla_('DATOS', p);
}

function sinAcentos_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

/** null si la contraseña sirve; si no, el motivo (el mismo texto que muestra la página). */
function problemaClave_(clave, usuario, nombre) {
  clave = String(clave || '');
  if (clave.length < MIN_CLAVE) return 'La contraseña debe tener al menos ' + MIN_CLAVE + ' caracteres.';
  if (clave.length > 128) return 'La contraseña es demasiado larga.';
  if (!/[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]/.test(clave) || !/\d/.test(clave)) return 'La contraseña debe tener letras y números.';
  var n = sinAcentos_(clave);
  var us = sinAcentos_(usuario);
  var partesUs = us.split(/[^a-z0-9ñ]+/).filter(function (x) { return x.length >= 4; });
  if ((us && n.indexOf(us) >= 0) || partesUs.some(function (x) { return n.indexOf(x) >= 0; })) return 'La contraseña no puede contener tu usuario.';
  var partesNom = sinAcentos_(nombre).split(/[^a-zñ]+/).filter(function (x) { return x.length >= 4; });
  if (partesNom.some(function (x) { return n.indexOf(x) >= 0; })) return 'La contraseña no puede contener tu nombre.';
  if (claveObvia_(n)) return 'Es fácil de adivinar. Evita palabras del trabajo (gestión, oficio, CDMX…), meses, equipos o secuencias como «qwerty»; una frase corta con números funciona bien.';
  return null;
}

function claveObvia_(normalizada) {
  var letras = normalizada.replace(/[^a-zñ]/g, '');
  if (!letras) return true;
  if (/^(.)\1*$/.test(letras)) return true;
  if (letras.length >= 3 && ('abcdefghijklmnopqrstuvwxyz'.indexOf(letras) >= 0 || 'zyxwvutsrqponmlkjihgfedcba'.indexOf(letras) >= 0)) return true;
  if (CLAVE_EXACTAS.indexOf(letras) >= 0) return true;
  return CLAVE_CONTIENE.some(function (w) { return letras.indexOf(w) >= 0; });
}

/** PBKDF2-HMAC-SHA256 con sal y pimienta. Formato: pbkdf2p$repeticiones$sal_b64$hash_b64 */
function hashClave_(clave, salB64, iter) {
  iter = iter || iteracionesClave_();
  var sal = salB64 ? Utilities.base64Decode(salB64) : bytesAleatorios_(16);
  var dk = pbkdf2_(conPimienta_(clave), sal, iter);
  return 'pbkdf2p$' + iter + '$' + Utilities.base64Encode(sal) + '$' + Utilities.base64Encode(dk);
}

/** La contraseña pasa primero por HMAC con la pimienta (32 bytes que no están en la hoja). */
function conPimienta_(clave) {
  return Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, Utilities.newBlob(String(clave)).getBytes(),
    Utilities.base64Decode(secreto_('PIMIENTA')));
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

/** Acepta el formato de la 1.6.0 (pbkdf2$, sin pimienta) y el nuevo (pbkdf2p$). */
function verificarClave_(clave, guardada) {
  var p = String(guardada || '').split('$');
  if (p.length !== 4 || (p[0] !== 'pbkdf2' && p[0] !== 'pbkdf2p')) return false;
  var iter = Number(p[1]);
  if (!(iter >= 1 && iter <= 1000000)) return false;
  var bytes = p[0] === 'pbkdf2p' ? conPimienta_(clave) : Utilities.newBlob(String(clave)).getBytes();
  var calc = Utilities.base64Encode(pbkdf2_(bytes, Utilities.base64Decode(p[2]), iter));
  return igualSeguro_(calc, p[3]);
}

function igualSeguro_(a, b) {
  a = String(a); b = String(b);
  var dif = a.length ^ b.length;
  for (var i = 0; i < Math.min(a.length, b.length); i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function necesitaRecifrar_(guardada) {
  var p = String(guardada || '').split('$');
  return p[0] !== 'pbkdf2p' || Number(p[1]) < iteracionesClave_();
}

function hashFalso_() { return 'pbkdf2p$' + iteracionesClave_() + '$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'; }

function iteracionesClave_() {
  if (MEMO_.iter) return MEMO_.iter;
  var n = Number(PropertiesService.getScriptProperties().getProperty('ITERACIONES_CLAVE'));
  MEMO_.iter = n >= ITERACIONES_MIN ? Math.min(n, ITERACIONES_MAX) : ITERACIONES_MIN;
  return MEMO_.iter;
}

/**
 * Mide cuánto tarda PBKDF2 en ESTE servidor y guarda las repeticiones para
 * que cifrar una contraseña tarde ~MILIS_OBJETIVO. Lo corre instalar() la
 * primera vez (y otra vez si borras la propiedad ITERACIONES_CLAVE).
 */
function calibrarClaves_(forzar) {
  var props = PropertiesService.getScriptProperties();
  var ya = Number(props.getProperty('ITERACIONES_CLAVE'));
  if (!forzar && ya >= ITERACIONES_MIN) return { repeticiones: ya, nuevo: false };
  var muestra = 400, clave = bytesAleatorios_(32), sal = bytesAleatorios_(16);
  pbkdf2_(clave, sal, 20);   // calentamiento
  var t0 = Date.now();
  pbkdf2_(clave, sal, muestra);
  var ms = Math.max(1, Date.now() - t0);
  var n = Math.round(MILIS_OBJETIVO / ms * muestra / 500) * 500;
  n = Math.max(ITERACIONES_MIN, Math.min(ITERACIONES_MAX, n));
  props.setProperty('ITERACIONES_CLAVE', String(n));
  MEMO_.iter = n;
  return { repeticiones: n, nuevo: true, msPorMil: Math.round(ms / muestra * 1000) };
}

/**
 * Un secreto aleatorio en las propiedades del script (NO en la hoja). Se crea
 * la primera vez, dentro del candado para que dos peticiones no creen dos.
 * Ojo: si se borra PIMIENTA, ninguna contraseña vuelve a servir (corre
 * restablecerAdministrador() y da contraseñas temporales nuevas).
 */
function secreto_(nombre) {
  var memo = MEMO_.secretos || (MEMO_.secretos = {});
  if (memo[nombre]) return memo[nombre];
  var props = PropertiesService.getScriptProperties();
  var v = props.getProperty(nombre);
  if (!v) {
    var lock = enCandado_() ? null : candado_(20000);
    try {
      v = props.getProperty(nombre);
      if (!v) {
        v = Utilities.base64Encode(bytesAleatorios_(32));
        props.setProperty(nombre, v);
        console.warn('Se creó el secreto ' + nombre + ' en las propiedades del script.');
      }
    } finally {
      if (lock) soltar_(lock);
    }
  }
  memo[nombre] = v;
  return v;
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

/** Contraseña temporal de 12: letras y números sin los que se confunden (0/O, 1/l). */
function claveTemporal_() {
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  var dig = '23456789';
  for (var intento = 0; intento < 20; intento++) {
    var b = bytesAleatorios_(16).map(function (x) { return x & 0xff; });
    var s = '';
    for (var i = 0; i < 9; i++) s += abc.charAt(b[i] % abc.length);
    var t = s.slice(0, 4) + dig.charAt(b[9] % 8) + dig.charAt(b[10] % 8) + dig.charAt(b[11] % 8) + s.slice(4);
    if (!claveObvia_(sinAcentos_(t))) return t;
  }
  return t;
}

/* ═══════════════════════════ Verificación en dos pasos ════════════════ */

var B32_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32_(bytes) {
  var bits = 0, valor = 0, out = '';
  for (var i = 0; i < bytes.length; i++) {
    valor = (valor << 8) | (bytes[i] & 255);
    bits += 8;
    while (bits >= 5) { out += B32_.charAt((valor >>> (bits - 5)) & 31); bits -= 5; }
  }
  if (bits > 0) out += B32_.charAt((valor << (5 - bits)) & 31);
  return out;
}

function conSigno_(b) { b = b & 255; return b > 127 ? b - 256 : b; }

/** Código TOTP de 6 dígitos (HMAC-SHA1, pasos de 30 s) del paso dado. */
function totpCodigo_(secreto, paso) {
  var msg = [0, 0, 0, 0, (paso >>> 24) & 255, (paso >>> 16) & 255, (paso >>> 8) & 255, paso & 255].map(conSigno_);
  var h = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, msg, secreto.map(conSigno_)).map(function (b) { return b & 255; });
  var off = h[h.length - 1] & 15;
  var bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return ('000000' + (bin % 1000000)).slice(-6);
}

/** El paso del código si es válido (ahora, el anterior o el siguiente) y no se ha usado; si no, -1. */
function totpVerificar_(secreto, codigo, ultimoPaso) {
  if (!secreto || !/^\d{6}$/.test(codigo)) return -1;
  var ahora = Math.floor(Date.now() / 30000);
  for (var k = -1; k <= 1; k++) {
    var p = ahora + k;
    if (p <= (ultimoPaso || 0)) continue;
    if (igualSeguro_(totpCodigo_(secreto, p), codigo)) return p;
  }
  return -1;
}

/** El secreto se guarda en la hoja cifrado con una llave que sale de la pimienta (que no está en la hoja). */
function llaveTotp_(usuario) {
  return Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, Utilities.newBlob('totp|' + usuario).getBytes(),
    Utilities.base64Decode(secreto_('PIMIENTA')));
}

function cifrarTotp_(usuario, secreto) {
  var k = llaveTotp_(usuario);
  return 'v1$' + Utilities.base64Encode(secreto.map(function (b, i) { return conSigno_((b & 255) ^ (k[i] & 255)); }));
}

function descifrarTotp_(usuario, guardado) {
  var p = String(guardado || '').split('$');
  if (p.length !== 2 || p[0] !== 'v1') return null;
  var k = llaveTotp_(usuario);
  return Utilities.base64Decode(p[1]).map(function (b, i) { return (b & 255) ^ (k[i] & 255); });
}

function debeActivar2fa_(yo) {
  return yo.rol === 'admin' && !yo.dosPasos && String(config_().dos_pasos_admin || '') === 'SI';
}

/** Paso 1: un secreto nuevo (todavía no se guarda en la hoja; espera 10 min a que se confirme). */
function totpIniciar_(yo) {
  if (yo.dosPasos) throw falla_('DATOS', 'Ya tienes activada la verificación en dos pasos.');
  var secreto = bytesAleatorios_(20).map(function (b) { return b & 255; });
  CacheService.getScriptCache().put('totpp:' + yo.usuario, JSON.stringify(secreto), 600);
  var b32 = base32_(secreto);
  var emisor = 'Control de Gestión';
  return { secreto: b32.replace(/(.{4})/g, '$1 ').trim(), uri: 'otpauth://totp/' + encodeURIComponent(emisor + ':' + yo.usuario) +
    '?secret=' + b32 + '&issuer=' + encodeURIComponent(emisor) };   // SHA1, 6 dígitos y 30 s son los valores por omisión
}

/** Paso 2: con la contraseña y el primer código, queda activada. Cierra las demás sesiones. */
function totpConfirmar_(yo, d) {
  var u = verificarIdentidad_(yo, d.clave);
  var raw = CacheService.getScriptCache().get('totpp:' + yo.usuario);
  if (!raw) throw falla_('DATOS', 'Pasaron más de 10 minutos. Empieza otra vez.');
  var secreto = JSON.parse(raw);
  var paso = totpVerificar_(secreto, String(d.codigo || '').replace(/\D/g, ''), 0);
  if (paso < 0) throw falla_('CODIGO', 'El código no coincide. Escribe el que muestra ahora la app (revisa que la hora del teléfono esté bien).');
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.USR), f = filaUsuario_(t, yo.usuario);
    if (!f || f.o.clave !== u.clave) throw falla_('CAMBIO', 'Tu cuenta cambió mientras tanto. Sal y vuelve a entrar.');
    f.o.totp = cifrarTotp_(yo.usuario, secreto);
    f.o.sello = nuevoSello_();
    escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
    bitacora_(yo.usuario, 'seguridad', '', 'Activó la verificación en dos pasos');
    CacheService.getScriptCache().remove('totpp:' + yo.usuario);
    CacheService.getScriptCache().put('totpu:' + yo.usuario, String(paso), 600);
    return { dosPasos: true, token: abrirSesion_(f.o) };
  } finally {
    soltar_(lock);
  }
}

/** Quitarla uno mismo pide la contraseña y un código actual (si perdió el teléfono, lo hace un administrador). */
function totpQuitar_(yo, d) {
  var u = verificarIdentidad_(yo, d.clave);
  if (!u.totp) throw falla_('DATOS', 'No tienes activada la verificación en dos pasos.');
  var cache = CacheService.getScriptCache();
  var paso = totpVerificar_(descifrarTotp_(yo.usuario, u.totp), String(d.codigo || '').replace(/\D/g, ''), Number(cache.get('totpu:' + yo.usuario) || 0));
  if (paso < 0) throw falla_('CODIGO', 'El código no coincide.');
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.USR), f = filaUsuario_(t, yo.usuario);
    f.o.totp = '';
    escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
    bitacora_(yo.usuario, 'seguridad', '', 'Quitó su verificación en dos pasos');
    cache.put('totpu:' + yo.usuario, String(paso), 600);
    return { dosPasos: false };
  } finally {
    soltar_(lock);
  }
}

/** Para cambios delicados de la propia cuenta: la contraseña otra vez (y cuenta como intento si está mal). */
function verificarIdentidad_(yo, clave) {
  var u = buscarUsuario_(yo.usuario);
  if (verificarClave_(String(clave || ''), u.clave)) return u;
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.USR), f = filaUsuario_(t, yo.usuario);
    registrarFallaCuenta_(f.o, new Date(), 'Contraseña incorrecta en «Mi cuenta»');
    escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
  } finally {
    soltar_(lock);
  }
  throw falla_('CREDENCIALES', 'La contraseña no es correcta.');
}

/* ═══════════════════════════ Mi cuenta ═════════════════════════════════ */

function correoValido_(c) {
  return c === '' || (c.length <= 120 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(c));
}

/** Sin datos: devuelve lo de la cuenta. Con «correo»: lo cambia (para los avisos). */
function miCuenta_(yo, d) {
  if (d.correo === undefined) return { usuario: yo.usuario, nombre: yo.nombre, correo: yo.correo, dosPasos: yo.dosPasos };
  var correo = String(d.correo || '').trim().toLowerCase();
  if (!correoValido_(correo)) throw falla_('DATOS', 'Ese correo no parece válido.');
  var lock = candado_(20000);
  try {
    var t = tabla_(HOJAS.USR), f = filaUsuario_(t, yo.usuario);
    var antes = f.o.correo || '';
    if (antes !== correo) {
      f.o.correo = correo;
      escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
      bitacora_(yo.usuario, 'usuarios', '', 'Cambió su correo para avisos: «' + antes + '» → «' + correo + '»');
    }
    return { usuario: yo.usuario, nombre: yo.nombre, correo: correo, dosPasos: yo.dosPasos };
  } finally {
    soltar_(lock);
  }
}

/* ═══════════════════════════ Consultas inusuales ═══════════════════════
   La Exportación es solo de administradores, pero cualquiera puede ir abriendo
   registro por registro o pedir listas de años anteriores. Eso no se impide
   (es su trabajo), pero si en un día alguien rebasa estos números queda una
   «alerta» en la Bitácora y, si hay avisos por correo, se avisa a los administradores. */

var LIMITES_CONSULTA = { obtener: 300, buscar: 300, descargarArchivo: 100, listarAnterior: 12 };
var TEXTO_CONSULTA = { obtener: 'abrió', buscar: 'hizo', descargarArchivo: 'descargó', listarAnterior: 'pidió' };
var QUE_CONSULTA = { obtener: 'registros', buscar: 'búsquedas', descargarArchivo: 'escaneos', listarAnterior: 'listas de años anteriores' };

function vigilarConsulta_(yo, accion, d) {
  if (yo.rol === 'admin') return;
  var clave = null;
  if (accion === 'obtener' || accion === 'buscar' || accion === 'descargarArchivo') clave = accion;
  else if (accion === 'listar' && Number(d && d.anio) && Number(d.anio) !== Number(Utilities.formatDate(new Date(), ZONA, 'yyyy'))) clave = 'listarAnterior';
  if (!clave) return;
  var cache = CacheService.getScriptCache();
  var k = 'uso:' + yo.usuario + ':' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMdd') + ':' + clave;
  var n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), CACHE_MAX);   // cada uso renueva las 6 h
  if (n !== LIMITES_CONSULTA[clave]) return;
  var texto = 'Consulta inusual: ' + yo.usuario + ' ' + TEXTO_CONSULTA[clave] + ' ' + n + ' ' + QUE_CONSULTA[clave] + ' hoy.';
  bitacora_(yo.usuario, 'alerta', '', texto);
  avisarAdmins_('Alerta de consulta inusual', texto);
}
