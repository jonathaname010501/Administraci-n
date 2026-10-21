/**
 * ════════════════════════════════════════════════════════════════════════
 *  CONTROL DE GESTIÓN · Instalación, respaldos y herramientas del dueño
 *
 *  Se corren desde el editor de Apps Script (botón ▶ Ejecutar). Están
 *  protegidas: si alguien intenta llamarlas desde la app web, Google no
 *  le da su correo a la app y soloDueno_() las rechaza.
 *
 *   instalar()                  Prepara pestañas, carpetas privadas, respaldo
 *                               semanal y el primer administrador. Se puede
 *                               correr varias veces: no borra nada.
 *   restablecerAdministrador()  Si se olvidó la contraseña del administrador.
 *   revisarSeguridad()          Revisa que nada esté compartido y que la base
 *                               esté sana. Córrela cuando tengas duda.
 *   respaldoSemanal()           Copia de la hoja (la corre un disparador cada
 *                               lunes; no hace nada si ya hubo copia esa semana).
 * ════════════════════════════════════════════════════════════════════════
 */

function instalar() {
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

  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'respaldoSemanal'; });
  if (!hay) {
    ScriptApp.newTrigger('respaldoSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
    log.push('✔ Respaldo automático: cada lunes a las 7 am.');
  } else {
    log.push('✔ Respaldo automático: ya estaba programado.');
  }

  var t = tabla_(HOJAS.USR);
  var admins = t.filas.filter(function (f) { return f.o.rol === 'admin' && f.o.activo === 'SI'; });
  if (!admins.length) {
    var temporal = claveTemporal_();
    var usuario = t.filas.some(function (f) { return f.o.usuario === 'admin'; }) ? 'admin' + t.filas.length : 'admin';
    escribirFila_(t.sh, HOJAS.USR, t.sh.getLastRow() + 1, {
      usuario: usuario, nombre: 'Administrador', rol: 'admin', tipos: '*', activo: 'SI', clave: hashClave_(temporal),
      debe_cambiar: 'SI', intentos: 0, bloqueado_hasta: '', sello: nuevoSello_(), creado_en: sello_(new Date()), ultimo_acceso: ''
    });
    bitacora_('sistema', 'usuarios', '', 'Instalación: se creó el administrador ' + usuario);
    log.push('', '★ PRIMER ADMINISTRADOR', '   Usuario: ' + usuario, '   Contraseña temporal: ' + temporal,
      '   (Al entrar te pedirá cambiarla. Copia estos datos ahora: no se vuelven a mostrar.)');
  } else {
    log.push('✔ Administradores activos: ' + admins.map(function (f) { return f.o.usuario; }).join(', '));
  }

  log.push('');
  revisar_(log);
  props.setProperty('INSTALADO', VERSION);
  log.push('', 'Listo. Siguiente paso: Implementar → Nueva implementación → Aplicación web (ver INSTALAR.md).');
  console.log(log.join('\n'));
  return log.join('\n');
}

function restablecerAdministrador() {
  soloDueno_();
  var t = tabla_(HOJAS.USR);
  var f = t.filas.filter(function (x) { return x.o.rol === 'admin'; })[0];
  var temporal = claveTemporal_();
  if (!f) {
    escribirFila_(t.sh, HOJAS.USR, t.sh.getLastRow() + 1, {
      usuario: 'admin', nombre: 'Administrador', rol: 'admin', tipos: '*', activo: 'SI', clave: hashClave_(temporal),
      debe_cambiar: 'SI', intentos: 0, bloqueado_hasta: '', sello: nuevoSello_(), creado_en: sello_(new Date()), ultimo_acceso: ''
    });
    f = { o: { usuario: 'admin' } };
  } else {
    f.o.clave = hashClave_(temporal);
    f.o.activo = 'SI';
    f.o.debe_cambiar = 'SI';
    f.o.intentos = 0;
    f.o.bloqueado_hasta = '';
    f.o.sello = nuevoSello_();
    escribirFila_(t.sh, HOJAS.USR, f.fila, f.o);
  }
  bitacora_('sistema', 'usuarios', '', 'El dueño de la hoja restableció la contraseña de ' + f.o.usuario);
  var msg = 'Usuario: ' + f.o.usuario + '\nContraseña temporal: ' + temporal + '\n(Te pedirá cambiarla al entrar.)';
  console.log(msg);
  return msg;
}

function revisarSeguridad() {
  soloDueno_();
  var log = ['Revisión de seguridad · ' + sello_(new Date()), ''];
  revisar_(log);
  console.log(log.join('\n'));
  return log.join('\n');
}

function respaldoSemanal() {
  // Pública a propósito (la llama el disparador). Si alguien la llama desde
  // fuera, lo más que logra es una copia por semana en la carpeta privada.
  var props = PropertiesService.getScriptProperties();
  var ultimo = Number(props.getProperty('ULTIMO_RESPALDO') || 0);
  if (Date.now() - ultimo < 6 * 24 * 3600 * 1000) return 'Ya hay respaldo de esta semana.';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'Ocupado; se intentará la próxima vez.';
  try {
    var carpeta = DriveApp.getFolderById(props.getProperty('ID_RESPALDOS'));
    var nombre = 'Respaldo Control de Gestión ' + Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
    DriveApp.getFileById(props.getProperty('ID_HOJA')).makeCopy(nombre, carpeta);
    props.setProperty('ULTIMO_RESPALDO', String(Date.now()));
    var copias = [], it = carpeta.getFiles();
    while (it.hasNext()) copias.push(it.next());
    copias.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    copias.slice(8).forEach(function (f) { f.setTrashed(true); });   // se quedan las 8 más recientes
    bitacora_('sistema', 'respaldo', '', 'Copia semanal: ' + nombre);
    return nombre;
  } finally {
    lock.releaseLock();
  }
}

/* ─────────────────────────── privadas ─────────────────────────── */

/** Solo el dueño, desde el editor. En la app web (anónima) Google no da el correo. */
function soloDueno_() {
  var activo = Session.getActiveUser().getEmail();
  var dueno = Session.getEffectiveUser().getEmail();
  if (!activo || activo !== dueno) throw new Error('Esto solo lo puede correr el dueño de la hoja desde el editor de Apps Script.');
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
  ['esquema', '1', 'Versión del esquema de la base (no la cambies)']
];

function completarConfig_(log) {
  var t = tabla_(HOJAS.CFG);
  var hay = {};
  t.filas.forEach(function (f) { hay[f.o.clave] = true; });
  CONFIG_INICIAL.forEach(function (c) {
    if (hay[c[0]]) return;
    escribirFila_(t.sh, HOJAS.CFG, t.sh.getLastRow() + 1, { clave: c[0], valor: c[1], descripcion: c[2] });
    log.push('✔ Configuración: ' + c[0] + ' = ' + c[1]);
  });
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
