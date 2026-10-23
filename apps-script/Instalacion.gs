/**
 * ════════════════════════════════════════════════════════════════════════
 *  CONTROL DE GESTIÓN · Instalación y herramientas del dueño
 *
 *  Se corren desde el editor de Apps Script (botón ▶ Ejecutar). Están
 *  protegidas: si alguien intenta llamarlas desde la app web, Google no
 *  le da su correo a la app y soloDueno_() las rechaza.
 *
 *   instalar()                  Prepara pestañas, carpetas privadas, secretos,
 *                               disparadores (respaldo diario y avisos) y el
 *                               primer administrador. Se puede correr varias
 *                               veces: no borra nada. Córrelo en cada versión
 *                               que traiga columnas o permisos nuevos.
 *   restablecerAdministrador()  Si se olvidó la contraseña del administrador
 *                               (o perdió el teléfono de la verificación en
 *                               dos pasos).
 *   revisarSeguridad()          Revisa que nada esté compartido y que la base
 *                               esté sana. Córrela cuando tengas duda.
 *   revisarRespaldos()          (Respaldos.gs) Abre la copia más reciente y
 *                               revisa que esté completa.
 * ════════════════════════════════════════════════════════════════════════
 */

function instalar() {
  nuevaPeticion_();
  soloDueno_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Abre este proyecto desde la hoja (Extensiones → Apps Script) y corre instalar() desde ahí.');
  var props = PropertiesService.getScriptProperties();
  var previo = props.getProperty('ID_HOJA');
  if (previo && previo !== ss.getId()) {
    throw new Error('Este proyecto ya está instalado en otra hoja (' + previo + '). Si de verdad quieres cambiar de hoja, ' +
      'borra la propiedad ID_HOJA en Configuración del proyecto → Propiedades de la secuencia de comandos.');
  }
  var log = ['Instalación de Control de Gestión ' + VERSION, ''];
  props.setProperty('ID_HOJA', ss.getId());
  ss.setSpreadsheetTimeZone(ZONA);

  Object.keys(COLS).forEach(function (nombre) { prepararPestana_(ss, nombre, log); });
  completarConfig_(log);

  carpetaPropia_('ID_CARPETA', 'Control de Gestión · Archivos (NO COMPARTIR)', log);
  carpetaPropia_('ID_RESPALDOS', 'Control de Gestión · Respaldos (NO COMPARTIR)', log);
  carpetaPropia_('ID_PLANTILLAS', 'Control de Gestión · Plantillas (NO COMPARTIR)', log);

  // Secretos que NO van en la hoja (si alguien la copia, no le sirven)
  var habiaPimienta = !!props.getProperty('PIMIENTA');
  secreto_('PIMIENTA');
  secreto_('SECRETO_EQUIPOS');
  log.push(habiaPimienta ? '✔ Secretos de contraseñas: ya estaban.' : '✔ Secretos de contraseñas creados (en las propiedades del script, no en la hoja).');
  var cal = calibrarClaves_();
  log.push('✔ Contraseñas: PBKDF2 con ' + cal.repeticiones + ' repeticiones' + (cal.nuevo ? ' (medido en este servidor: ~' + MILIS_OBJETIVO + ' ms por contraseña)' : '') +
    '. Cada quien pasa al formato nuevo la próxima vez que entra.');

  prepararDisparadores_(log);

  var t = tabla_(HOJAS.USR);
  var admins = t.filas.filter(function (f) { return f.o.rol === 'admin' && f.o.activo === 'SI'; });
  if (!admins.length) {
    var temporal = claveTemporal_();
    var hash = hashClave_(temporal);
    var usuario;
    var lock = candado_(30000);
    try {
      t = tabla_(HOJAS.USR);
      usuario = t.filas.some(function (f) { return f.o.usuario === 'admin'; }) ? 'admin' + t.filas.length : 'admin';
      escribirFila_(t.sh, HOJAS.USR, t.sh.getLastRow() + 1, {
        usuario: usuario, nombre: 'Administrador', rol: 'admin', tipos: '*', activo: 'SI', clave: hash,
        debe_cambiar: 'SI', intentos: 0, bloqueado_hasta: '', sello: nuevoSello_(), creado_en: sello_(new Date()), ultimo_acceso: ''
      });
      bitacora_('sistema', 'usuarios', '', 'Instalación: se creó el administrador ' + usuario);
    } finally {
      soltar_(lock);
    }
    log.push('', '★ PRIMER ADMINISTRADOR', '   Usuario: ' + usuario, '   Contraseña temporal: ' + temporal,
      '   (Al entrar te pedirá cambiarla. Copia estos datos ahora: no se vuelven a mostrar.)');
  } else {
    log.push('✔ Administradores activos: ' + admins.map(function (f) { return f.o.usuario; }).join(', '));
  }

  rellenarFechaAtencion_(log);
  invalidarRegistros_();   // la caché de Registros empieza de cero

  log.push('');
  revisar_(log);
  props.setProperty('INSTALADO', VERSION);
  log.push('', 'Listo. Siguiente paso: Implementar → Gestionar implementaciones → ✏ → Nueva versión (ver INSTALAR.md).');
  console.log(log.join('\n'));
  return log.join('\n');
}

/** Respaldo diario (6 am) y avisos por correo (8 am). Quita el disparador semanal de la 1.6.0. */
function prepararDisparadores_(log) {
  var quitados = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'respaldoSemanal') { ScriptApp.deleteTrigger(t); quitados++; }
  });
  var hay = function (fn) { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === fn; }); };
  if (!hay('respaldoDiario')) {
    ScriptApp.newTrigger('respaldoDiario').timeBased().everyDays(1).atHour(6).create();
    log.push('✔ Respaldo automático: todos los días a las 6 am' + (quitados ? ' (reemplaza al semanal)' : '') + '.');
  } else {
    log.push('✔ Respaldo automático: ya estaba programado (diario).');
  }
  if (!hay('avisosDiarios')) {
    ScriptApp.newTrigger('avisosDiarios').timeBased().everyDays(1).atHour(8).create();
    log.push('✔ Avisos por correo: resumen a las 8 am en días hábiles (se prenden en Configuración).');
  } else {
    log.push('✔ Avisos por correo: el disparador ya estaba.');
  }
}

/**
 * Lo que se atendió antes de la 1.5.0 no tiene «fecha_atencion». Si en la
 * Bitácora consta el cambio a Atendido/Concluido, se copia esa fecha (así
 * Informes ya no tiene que leer toda la Bitácora).
 */
function rellenarFechaAtencion_(log) {
  var lock = candado_(30000);
  try {
    var t = tabla_(HOJAS.REG);
    var faltan = t.filas.filter(function (f) { return CERRADOS.indexOf(f.o.estatus) >= 0 && !fechaValida_(String(f.o.fecha_atencion || '')); });
    if (!faltan.length) return;
    var re = /estatus(?::\s*«[^»]*»)?\s*→\s*«(Atendido|Concluido)»/, dia = {};
    tabla_(HOJAS.BIT).filas.forEach(function (f) {
      var b = f.o;
      if (!b.registro_id || !re.test(String(b.detalle))) return;
      var x = String(b.fecha).slice(0, 10);
      if (!dia[b.registro_id] || x > dia[b.registro_id]) dia[b.registro_id] = x;
    });
    var cambiadas = faltan.filter(function (f) { return dia[f.o.id]; });
    cambiadas.forEach(function (f) { f.o.fecha_atencion = dia[f.o.id]; });
    if (cambiadas.length) {
      escribirVarias_(t, HOJAS.REG, cambiadas);
      log.push('✔ Fecha de atención tomada de la Bitácora: ' + cambiadas.length + ' registro(s).');
    }
  } finally {
    soltar_(lock);
  }
}

function restablecerAdministrador() {
  nuevaPeticion_();
  soloDueno_();
  var temporal = claveTemporal_();
  var hash = hashClave_(temporal);
  var usuario;
  var lock = candado_(30000);
  try {
    var t = tabla_(HOJAS.USR);
    var f = t.filas.filter(function (x) { return x.o.rol === 'admin'; })[0];
    if (!f) {
      usuario = 'admin';
      escribirFila_(t.sh, HOJAS.USR, t.sh.getLastRow() + 1, {
        usuario: 'admin', nombre: 'Administrador', rol: 'admin', tipos: '*', activo: 'SI', clave: hash,
        debe_cambiar: 'SI', intentos: 0, bloqueado_hasta: '', sello: nuevoSello_(), creado_en: sello_(new Date()), ultimo_acceso: ''
      });
    } else {
      usuario = f.o.usuario;
      f.o.clave = hash;
      f.o.activo = 'SI';
      f.o.debe_cambiar = 'SI';
      f.o.intentos = 0;
      f.o.bloqueado_hasta = '';
      f.o.totp = '';        // por si perdió el teléfono de la verificación en dos pasos
      f.o.sello = nuevoSello_();
      escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
    }
    CacheService.getScriptCache().remove('bloq:' + usuario);
    bitacora_('sistema', 'usuarios', '', 'El dueño de la hoja restableció la contraseña de ' + usuario + ' (y su verificación en dos pasos)');
  } finally {
    soltar_(lock);
  }
  var msg = 'Usuario: ' + usuario + '\nContraseña temporal: ' + temporal +
    '\n(Te pedirá cambiarla al entrar. Si tenía verificación en dos pasos, se quitó: actívala de nuevo en «Mi cuenta».)';
  console.log(msg);
  return msg;
}

function revisarSeguridad() {
  nuevaPeticion_();
  soloDueno_();
  var log = ['Revisión de seguridad · ' + sello_(new Date()), ''];
  revisar_(log);
  invalidarRegistros_();   // si alguien editó la hoja a mano, la app lo ve ya
  console.log(log.join('\n'));
  return log.join('\n');
}

/* ─────────────────────────── privadas ─────────────────────────── */

/** Solo el dueño, desde el editor. En la app web (anónima) Google no da el correo. */
function soloDueno_() {
  if (!esDueno_()) throw new Error('Esto solo lo puede correr el dueño de la hoja desde el editor de Apps Script.');
}

function esDueno_() {
  var activo = '', dueno = '';
  try { activo = Session.getActiveUser().getEmail(); dueno = Session.getEffectiveUser().getEmail(); } catch (e) { return false; }
  return !!activo && activo === dueno;
}

function prepararPestana_(ss, nombre, log) {
  var cols = COLS[nombre];
  var num = NUMERICAS[nombre] || {};
  var sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    log.push('✔ Pestaña creada: ' + nombre);
  }
  if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
  var ancho = Math.max(cols.length, sh.getLastColumn(), 1);
  var actuales = sh.getRange(1, 1, 1, ancho).getValues()[0].map(function (x) { return String(x).trim(); });
  var vacia = actuales.every(function (x) { return x === ''; });
  if (!vacia) {
    for (var i = 0; i < cols.length; i++) {
      if (actuales[i] === cols[i]) continue;
      if (actuales[i] === '' && actuales.slice(i).every(function (x) { return x === ''; })) break; // faltan al final: se agregan
      throw new Error('La pestaña «' + nombre + '» tiene en la columna ' + (i + 1) + ' «' + actuales[i] + '» y debería ser «' +
        cols[i] + '». No se cambió nada. Revisa que no hayan movido columnas.');
    }
  }
  var cab = sh.getRange(1, 1, 1, cols.length);
  cab.setNumberFormat('@').setValues([cols]).setFontWeight('bold').setBackground('#8f4889').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  var filas = Math.max(sh.getMaxRows(), 2);
  for (var c = 0; c < cols.length; c++) sh.getRange(2, c + 1, filas - 1, 1).setNumberFormat(num[cols[c]] ? '0' : '@');
  if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    sh.protect().setDescription('La escribe el sistema. Editar a mano puede romperlo.').setWarningOnly(true);
  }
  if (vacia) log.push('✔ Encabezados escritos: ' + nombre);
  else log.push('✔ Pestaña revisada: ' + nombre + ' (' + Math.max(0, sh.getLastRow() - 1) + ' filas)');
}

var CONFIG_INICIAL = [
  ['encabezado_1', 'Secretaría de Atención y Participación Ciudadana', 'Primera línea del encabezado (pantalla y Excel)'],
  ['encabezado_2', 'Subsecretaría de Territorios de Paz e Igualdad', 'Segunda línea'],
  ['encabezado_3', 'Dirección Ejecutiva de Gabinetes de Paz', 'Tercera línea (déjala vacía si no aplica)'],
  ['plantilla_OFS', 'SAPCI/STPI/{NNN}/{AAAA}', 'Número oficial de los oficios salientes. {NNN} = consecutivo, {AAAA} = año'],
  ['plazo_dias', '', 'Días hábiles por omisión para la fecha límite de un entrante (vacío = sin fecha límite)'],
  ['url_web', '', 'Dirección pública de la app si se publica fuera de Google (Vercel). Vacío = se usa la de Google'],
  ['esquema', '1', 'Versión del esquema de la base (no la cambies)'],
  ['mantenimiento', 'NO', 'SI = solo los administradores pueden usar el sistema (se cambia en Configuración)'],
  ['mantenimiento_msg', '', 'Mensaje que ve la gente mientras hay mantenimiento'],
  // 1.7.0
  ['dias_inhabiles', '', 'Días inhábiles (AAAA-MM-DD, separados por coma): no cuentan para fechas límite ni tiempos de respuesta'],
  ['acuse_desde', '', '«Sin acuse» cuenta solo oficios desde esta fecha (AAAA-MM-DD). Vacío = todos'],
  ['plantilla_doc_OFS', '', 'ID del Google Doc que sirve de plantilla del oficio (debe estar en la carpeta Plantillas)'],
  ['avisos_correo', 'NO', 'SI = se mandan correos al turnar y el resumen diario'],
  ['avisos_detalle', 'NO', 'SI = los correos incluyen el asunto'],
  ['dos_pasos_admin', 'NO', 'SI = los administradores deben tener verificación en dos pasos'],
  ['espejo_archivos', 'SI', 'SI = cada día se copian los escaneos nuevos a Respaldos/Archivos (espejo). Solo el dueño, aquí en la hoja'],
  ['respaldo_externo', '', 'ID de una carpeta de OTRA cuenta o unidad compartida para una copia más de cada respaldo. Solo el dueño, aquí en la hoja']
];

function completarConfig_(log) {
  var lock = candado_(30000);
  try {
    var t = tabla_(HOJAS.CFG);
    var hay = {};
    t.filas.forEach(function (f) { hay[f.o.clave] = true; });
    CONFIG_INICIAL.forEach(function (c) {
      if (hay[c[0]]) return;
      escribirFila_(t.sh, HOJAS.CFG, t.sh.getLastRow() + 1, { clave: c[0], valor: c[1], descripcion: c[2] });
      log.push('✔ Configuración: ' + c[0] + ' = ' + c[1]);
    });
  } finally {
    soltar_(lock);
  }
}

function carpetaPropia_(prop, nombre, log) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(prop);
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) { log.push('✔ Carpeta: ' + f.getName()); return f; }
    } catch (e) { /* se crea de nuevo */ }
  }
  var nueva = DriveApp.createFolder(nombre);
  props.setProperty(prop, nueva.getId());
  log.push('✔ Carpeta creada en tu Drive: ' + nombre);
  return nueva;
}

function revisar_(log) {
  var props = PropertiesService.getScriptProperties();
  var problemas = 0;
  var revisarArchivo = function (id, que, esCarpeta) {
    if (!id) { log.push('✘ ' + que + ': no configurada (corre instalar()).'); problemas++; return; }
    var f;
    try { f = esCarpeta ? DriveApp.getFolderById(id) : DriveApp.getFileById(id); } catch (e) { f = null; }
    if (!f) { log.push('✘ ' + que + ': no se encontró.'); problemas++; return; }
    var acceso = f.getSharingAccess();
    var gente = f.getEditors().concat(f.getViewers()).map(function (u) { return u.getEmail(); })
      .filter(function (e) { return e && e !== Session.getEffectiveUser().getEmail(); });
    if (acceso !== DriveApp.Access.PRIVATE || gente.length) {
      problemas++;
      log.push('✘ ' + que + ' ESTÁ COMPARTIDA' + (acceso !== DriveApp.Access.PRIVATE ? ' (acceso general: ' + acceso + ')' : '') +
        (gente.length ? ' con: ' + gente.join(', ') : '') + '. Quítalo en Compartir → solo tú.');
    } else {
      log.push('✔ ' + que + ': privada (solo tú).');
    }
  };
  revisarArchivo(props.getProperty('ID_HOJA'), 'La hoja de la base', false);
  revisarArchivo(props.getProperty('ID_CARPETA'), 'La carpeta de archivos', true);
  revisarArchivo(props.getProperty('ID_RESPALDOS'), 'La carpeta de respaldos', true);
  revisarArchivo(props.getProperty('ID_PLANTILLAS'), 'La carpeta de plantillas', true);
  if (props.getProperty('PIMIENTA') && props.getProperty('SECRETO_EQUIPOS')) log.push('✔ Secretos de contraseñas: en las propiedades del script.');
  else { log.push('✘ Faltan los secretos de contraseñas (corre instalar()).'); problemas++; }
  var disp = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  ['respaldoDiario', 'avisosDiarios'].forEach(function (fn) {
    if (disp.indexOf(fn) >= 0) log.push('✔ Disparador ' + fn + '.');
    else { log.push('✘ Falta el disparador ' + fn + ' (corre instalar()).'); problemas++; }
  });
  var ultimo = Number(props.getProperty('ULTIMO_RESPALDO') || 0);
  if (ultimo) {
    var dias = Math.floor((Date.now() - ultimo) / 86400000);
    log.push((dias <= 2 ? '✔' : '✘') + ' Último respaldo automático: hace ' + dias + ' día(s).');
    if (dias > 2) problemas++;
  } else {
    log.push('· Todavía no hay respaldo automático (el primero es mañana a las 6 am; o corre respaldoDiario()).');
  }
  var ext = String((function () { try { return config_().respaldo_externo || ''; } catch (e) { return ''; } })()).match(/[-\w]{25,}/);
  if (ext) {
    try { DriveApp.getFolderById(ext[0]); log.push('✔ Carpeta externa de respaldos: accesible.'); }
    catch (e) { log.push('✘ Carpeta externa de respaldos: no se puede abrir (revisa el ID y que la cuenta dueña la pueda editar).'); problemas++; }
  } else {
    log.push('· Sin carpeta externa de respaldos (recomendado: ver INSTALAR.md, «Respaldo fuera de la cuenta»).');
  }
  try {
    Object.keys(COLS).forEach(function (n) { tabla_(n); });
    log.push('✔ Pestañas y columnas en orden.');
  } catch (e) {
    problemas++;
    log.push('✘ ' + e.message);
  }
  try {
    var u = tabla_(HOJAS.USR).filas;
    var adm = u.filter(function (f) { return f.o.rol === 'admin' && f.o.activo === 'SI'; }).length;
    log.push((adm ? '✔' : '✘') + ' Usuarios: ' + u.length + ' (' + adm + ' administrador(es) activo(s)).');
    if (!adm) problemas++;
  } catch (e) { /* ya reportado */ }
  try {
    var url = ScriptApp.getService().getUrl();
    log.push(url ? '✔ App web publicada: ' + url : '· App web todavía no publicada.');
  } catch (e) { /* sin implementación */ }
  log.push(problemas ? '⚠ Hay ' + problemas + ' punto(s) por corregir.' : '✔ Todo en orden.');
}
