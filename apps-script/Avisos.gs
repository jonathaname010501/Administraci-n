/**
 * ════════════════════════════════════════════════════════════════════════
 *  CONTROL DE GESTIÓN · Avisos por correo (1.7.0)
 *
 *   · Al turnar un asunto a una persona del sistema, le llega un correo
 *     (si tiene correo en Usuarios y los avisos están prendidos en
 *     Configuración). Nunca se avisa a quien turnó a sí mismo.
 *   · avisosDiarios(): resumen de lo vencido, lo que vence hoy y lo que vence
 *     en los próximos 2 días hábiles. Lo corre un disparador a las 8 am; no
 *     manda nada en fin de semana ni en días inhábiles.
 *   · Por omisión los correos NO llevan el asunto (solo número, libreta y
 *     fecha límite). Configuración → «Incluir el asunto» lo cambia.
 *
 *  Los correos salen de la cuenta dueña (MailApp). Una cuenta gratuita puede
 *  mandar unos 100 al día; si se acaba la cuota, se deja de mandar y queda
 *  en el registro de Apps Script.
 * ════════════════════════════════════════════════════════════════════════
 */

var NOMBRE_SISTEMA = 'Control de Gestión';
var MAX_EN_CORREO = 20;

function avisosActivos_() { return String(config_().avisos_correo || '') === 'SI'; }

function urlApp_() {
  var web = String(config_().url_web || '');
  if (web) return web;
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function datosAviso_(r) {
  return { tipo: TIPOS[r.tipo] ? TIPOS[r.tipo].singular : r.tipo, num: etiquetaNum_(r), numero: r.numero || '',
    limite: r.fecha_limite || '', asunto: corta_(String(r.asunto || '').replace(/\s+/g, ' '), 160) };
}

/** Se anota (no se manda todavía): los correos salen al final de la petición, ya sin el candado. */
function avisarTurno_(yo, usuarioDestino, registros) {
  if (!usuarioDestino || usuarioDestino === yo.usuario || !registros.length) return;
  if (!avisosActivos_()) return;
  var u = buscarUsuario_(usuarioDestino);
  if (!u || u.activo !== 'SI' || !u.correo) return;
  (MEMO_.avisos || (MEMO_.avisos = [])).push({ tipo: 'turno', para: u.correo, nombre: u.nombre, quien: yo.nombre,
    registros: registros.map(datosAviso_) });
}

/** A los administradores activos con correo (alertas de seguridad). */
function avisarAdmins_(asunto, texto) {
  if (!avisosActivos_()) return;
  tabla_(HOJAS.USR).filas.map(function (f) { return f.o; })
    .filter(function (u) { return u.rol === 'admin' && u.activo === 'SI' && u.correo; })
    .forEach(function (u) { (MEMO_.avisos || (MEMO_.avisos = [])).push({ tipo: 'texto', para: u.correo, nombre: u.nombre, asunto: asunto, texto: texto }); });
}

function enviarAvisos_(avisos) {
  var detalle = String(config_().avisos_detalle || '') === 'SI';
  var url = urlApp_();
  var enviados = 0;
  avisos.forEach(function (a) {
    try {
      if (MailApp.getRemainingDailyQuota() < 2) { console.warn('Sin cuota de correo: no se mandó el aviso a ' + a.para); return; }
      var m = a.tipo === 'turno' ? correoTurno_(a, detalle, url) : a.tipo === 'diario' ? correoDiario_(a, detalle, url) : correoTexto_(a, url);
      MailApp.sendEmail({ to: a.para, subject: m.asunto, body: m.texto, htmlBody: m.html, name: NOMBRE_SISTEMA });
      enviados++;
    } catch (e) {
      console.error('No se pudo mandar el aviso a ' + a.para + ': ' + (e && e.message));
    }
  });
  return enviados;
}

/* ─────────── Contenido de los correos ─────────── */

function lineaAviso_(r, detalle) {
  return r.tipo + ' ' + r.num + (r.numero && r.numero !== r.num ? ' (' + r.numero + ')' : '') +
    (r.limite ? ' · límite ' + fechaCortaSrv_(r.limite) : '') + (detalle && r.asunto ? ' · ' + r.asunto : '');
}

function fechaCortaSrv_(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }

function armarCorreo_(asunto, saludo, bloques, url) {
  var pie = 'Este aviso lo manda el sistema porque tienes un correo registrado. Para dejar de recibirlos, quítalo en «Mi cuenta».';
  var texto = saludo + '\n\n' + bloques.map(function (b) {
    return (b.titulo ? b.titulo + '\n' : '') + b.lineas.map(function (l) { return '  · ' + l; }).join('\n');
  }).join('\n\n') + '\n\n' + (url ? 'Entra a ' + NOMBRE_SISTEMA + ': ' + url + '\n\n' : '') + pie;
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#2d2a2e;max-width:560px">' +
    '<div style="border-top:4px solid #8f4889;padding:14px 0 4px"><strong style="color:#8f4889;font-size:16px">' + escHtml_(NOMBRE_SISTEMA) + '</strong></div>' +
    '<p>' + escHtml_(saludo) + '</p>' +
    bloques.map(function (b) {
      return (b.titulo ? '<p style="margin:14px 0 4px"><strong>' + escHtml_(b.titulo) + '</strong></p>' : '') +
        '<ul style="margin:0;padding-left:18px">' + b.lineas.map(function (l) { return '<li style="margin:2px 0">' + escHtml_(l) + '</li>'; }).join('') + '</ul>';
    }).join('') +
    (url ? '<p style="margin:18px 0"><a href="' + escHtml_(url) + '" style="background:#8f4889;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">Abrir ' + escHtml_(NOMBRE_SISTEMA) + '</a></p>' : '') +
    '<p style="color:#7b7e80;font-size:12px">' + escHtml_(pie) + '</p></div>';
  return { asunto: asunto, texto: texto, html: html };
}

function limitar_(lista, detalle) {
  var l = lista.slice(0, MAX_EN_CORREO).map(function (r) { return lineaAviso_(r, detalle); });
  if (lista.length > MAX_EN_CORREO) l.push('y ' + (lista.length - MAX_EN_CORREO) + ' más (velos en «Mis asuntos»)');
  return l;
}

function correoTurno_(a, detalle, url) {
  var n = a.registros.length;
  var asunto = n === 1 ? 'Te turnaron: ' + a.registros[0].tipo + ' ' + a.registros[0].num : 'Te turnaron ' + n + ' asuntos';
  return armarCorreo_(asunto, 'Hola, ' + a.nombre + '. ' + a.quien + (n === 1 ? ' te turnó este asunto:' : ' te turnó estos asuntos:'),
    [{ lineas: limitar_(a.registros, detalle) }], url);
}

function correoDiario_(a, detalle, url) {
  var bloques = [];
  if (a.vencidos.length) bloques.push({ titulo: 'Vencidos (' + a.vencidos.length + ')', lineas: limitar_(a.vencidos, detalle) });
  if (a.hoy.length) bloques.push({ titulo: 'Vencen hoy (' + a.hoy.length + ')', lineas: limitar_(a.hoy, detalle) });
  if (a.pronto.length) bloques.push({ titulo: 'Vencen en los próximos 2 días hábiles (' + a.pronto.length + ')', lineas: limitar_(a.pronto, detalle) });
  if (a.sinResponsable) bloques.push({ titulo: 'Para administradores', lineas: [a.sinResponsable + ' asunto(s) vencido(s) sin responsable en el sistema (velos en Pendientes)'] });
  var partes = [];
  if (a.vencidos.length) partes.push(a.vencidos.length + ' vencido' + (a.vencidos.length === 1 ? '' : 's'));
  if (a.hoy.length) partes.push(a.hoy.length + ' vence' + (a.hoy.length === 1 ? '' : 'n') + ' hoy');
  if (a.pronto.length) partes.push(a.pronto.length + ' por vencer');
  if (!partes.length && a.sinResponsable) partes.push(a.sinResponsable + ' vencido(s) sin responsable');
  return armarCorreo_('Tus asuntos de hoy: ' + partes.join(', '), 'Buenos días, ' + a.nombre + '. Esto es lo que tienes pendiente:', bloques, url);
}

function correoTexto_(a, url) {
  return armarCorreo_(a.asunto, 'Hola, ' + a.nombre + '.', [{ lineas: [a.texto] }], url);
}

/* ─────────── Resumen diario (disparador) ─────────── */

/**
 * Pública porque la llama su disparador. Desde la app web no hace nada: solo
 * corre si la llama SU disparador (o el dueño desde el editor, para probar),
 * y una sola vez por día hábil.
 */
function avisosDiarios(e) {
  nuevaPeticion_();
  if (!llamadaDeDisparador_(e, 'avisosDiarios') && !esDueno_()) return 'Esta función la corre su disparador.';
  var props = PropertiesService.getScriptProperties();
  var hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  if (props.getProperty('ULTIMO_AVISO') === hoy) return 'Ya se mandaron los avisos de hoy.';
  var dia = Number(Utilities.formatDate(new Date(), ZONA, 'u'));   // 1 = lunes … 7 = domingo
  var inhabiles = diasInhabiles_();
  if (dia >= 6 || inhabiles.indexOf(hoy) >= 0) return 'Hoy no es día hábil: no se mandan avisos.';
  if (!avisosActivos_()) return 'Los avisos por correo están apagados (Configuración).';
  props.setProperty('ULTIMO_AVISO', hoy);
  var regs = tablaLectura_(HOJAS.REG).filas.map(function (f) { return f.o; });
  var activo = function (r) { return r.estatus === 'Pendiente' || r.estatus === 'En trámite'; };
  var avisos = [];
  tabla_(HOJAS.USR).filas.map(function (f) { return f.o; })
    .filter(function (u) { return u.activo === 'SI' && u.correo; })
    .forEach(function (u) {
      var tipos = tiposDeUsuario_(u);
      var mios = regs.filter(function (r) { return r.turnado_usuario === u.usuario && tipos.indexOf(r.tipo) >= 0 && activo(r) && r.fecha_limite; });
      var a = {
        tipo: 'diario', para: u.correo, nombre: u.nombre,
        vencidos: mios.filter(function (r) { return r.fecha_limite < hoy; }).map(datosAviso_),
        hoy: mios.filter(function (r) { return r.fecha_limite === hoy; }).map(datosAviso_),
        pronto: mios.filter(function (r) { return r.fecha_limite > hoy && diasHabiles_(hoy, r.fecha_limite, inhabiles) <= 2; }).map(datosAviso_),
        sinResponsable: u.rol === 'admin' ? regs.filter(function (r) { return activo(r) && !r.turnado_usuario && r.fecha_limite && r.fecha_limite < hoy; }).length : 0
      };
      if (a.vencidos.length || a.hoy.length || a.pronto.length || a.sinResponsable) avisos.push(a);
    });
  var enviados = avisos.length ? enviarAvisos_(avisos) : 0;
  bitacora_('sistema', 'avisos', '', 'Resumen diario por correo: ' + enviados + ' de ' + avisos.length + ' persona(s)');
  return 'Avisos enviados: ' + enviados;
}

/** ¿La llamó de verdad su disparador? (el evento trae el ID del disparador y se compara con los del proyecto) */
function llamadaDeDisparador_(e, funcion) {
  var uid = e && e.triggerUid;
  if (!uid) return false;
  try {
    return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === funcion && String(t.getUniqueId()) === String(uid); });
  } catch (err) { return false; }
}
