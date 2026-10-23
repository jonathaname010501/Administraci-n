/**
 * ════════════════════════════════════════════════════════════════════════
 *  CONTROL DE GESTIÓN · Respaldos (1.7.0)
 *
 *   respaldoDiario()     La corre un disparador todos los días (6 am). Hace
 *                        una copia de la hoja en «Respaldos» y se quedan las
 *                        14 más recientes y una por semana (lunes) de las
 *                        últimas 12 semanas. Además copia los escaneos nuevos
 *                        a «Respaldos/Archivos (espejo)»: si alguien quita un
 *                        escaneo, la copia sigue ahí aunque la papelera de
 *                        Drive se vacíe a los 30 días.
 *   Carpeta externa      Si en la pestaña Config (solo el dueño, en la hoja)
 *                        se escribe en «respaldo_externo» el ID de una carpeta
 *                        de OTRA cuenta o de una unidad compartida (con permiso
 *                        de edición para la cuenta dueña), cada copia y cada
 *                        escaneo se copian también ahí. Ver INSTALAR.md.
 *   revisarRespaldos()   (solo el dueño, desde el editor) Abre la copia más
 *                        reciente, revisa que tenga las pestañas y columnas
 *                        correctas, compara cuántos renglones tiene y cuenta
 *                        los escaneos del espejo. Es la «prueba de restauración».
 *   respaldoSemanal()    El nombre del disparador de la 1.6.0; hace lo mismo
 *                        que respaldoDiario() hasta que instalar() lo cambie.
 *
 *  Son públicas (las llaman los disparadores) pero no hacen daño si alguien
 *  más las llama: a lo mucho una copia por día, en las carpetas privadas.
 * ════════════════════════════════════════════════════════════════════════
 */

var PREFIJO_RESPALDO = 'Respaldo Control de Gestión ';
var RESPALDOS_DIARIOS = 14;
var RESPALDOS_SEMANALES = 12;
var ESPEJO_MAX_POR_VEZ = 200;      // escaneos por corrida (lo que falte sigue al día siguiente)
var NOMBRE_ESPEJO = 'Archivos (espejo)';

function respaldoDiario() {
  nuevaPeticion_();
  return respaldoAutomatico_();
}

function respaldoSemanal() {
  nuevaPeticion_();
  return respaldoAutomatico_();
}

function respaldoAutomatico_() {
  var props = PropertiesService.getScriptProperties();
  var reciente = function () { return Date.now() - Number(props.getProperty('ULTIMO_RESPALDO') || 0) < 20 * 3600 * 1000; };
  if (reciente()) return 'Ya hay respaldo de hoy.';
  var lock = candado_(30000, true);
  if (!lock) return 'Ocupado; se intentará la próxima vez.';
  var nombre, hoja, carpeta, podadas;
  try {
    if (reciente()) return 'Ya hay respaldo de hoy.';
    // Con el candado: nadie está guardando a medias mientras se copia.
    SpreadsheetApp.flush();
    hoja = DriveApp.getFileById(props.getProperty('ID_HOJA'));
    carpeta = DriveApp.getFolderById(props.getProperty('ID_RESPALDOS'));
    nombre = PREFIJO_RESPALDO + Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
    hoja.makeCopy(nombre, carpeta);
    props.setProperty('ULTIMO_RESPALDO', String(Date.now()));
  } finally {
    soltar_(lock);
  }
  podadas = podarRespaldos_(carpeta);
  // Lo que tarda (escaneos y carpeta externa) va ya sin el candado.
  var partes = ['Copia diaria: ' + nombre];
  if (podadas) partes.push(podadas + ' copia(s) vieja(s) a la papelera');
  var esp = null;
  try { esp = espejoArchivos_(carpeta, 'ULTIMO_ESPEJO'); } catch (e) { console.error('espejo: ' + (e && e.message)); partes.push('✘ espejo de escaneos: ' + (e && e.message)); }
  if (esp) partes.push('escaneos copiados al espejo: ' + esp.copiados + (esp.pendientes ? ' (faltan ' + esp.pendientes + ', siguen mañana)' : ''));
  var ext = respaldoExterno_(hoja, nombre);
  if (ext) partes.push(ext.ok ? 'carpeta externa: copia y ' + (ext.espejo ? ext.espejo.copiados : 0) + ' escaneo(s)' : '✘ carpeta externa: ' + ext.error);
  bitacora_('sistema', 'respaldo', '', partes.join(' · '));
  return partes.join('\n');
}

function diaDeRespaldo_(f) {
  var m = String(f.getName()).match(/^Respaldo Control de Gestión (\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Se quedan las 14 copias más recientes y una por semana (la del lunes) de las 12 semanas anteriores. */
function podarRespaldos_(carpeta) {
  var copias = [], it = carpeta.getFiles();
  while (it.hasNext()) {
    var f = it.next(), dia = diaDeRespaldo_(f);
    if (dia && !f.isTrashed()) copias.push({ f: f, dia: dia });
  }
  copias.sort(function (a, b) { return a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : b.f.getDateCreated() - a.f.getDateCreated(); });
  var diarias = 0, semanales = 0, vistos = {}, quitadas = 0;
  copias.forEach(function (c) {
    var quitar = false;
    if (vistos[c.dia]) quitar = true;   // dos copias del mismo día: se queda la más nueva
    else if (diarias < RESPALDOS_DIARIOS) diarias++;
    else if (esLunes_(c.dia) && semanales < RESPALDOS_SEMANALES) semanales++;
    else quitar = true;
    vistos[c.dia] = true;
    if (quitar) { c.f.setTrashed(true); quitadas++; }
  });
  return quitadas;
}

function esLunes_(dia) {
  var p = dia.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() === 1;
}

function subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/**
 * Copia a «<padre>/Archivos (espejo)» los escaneos nuevos o cambiados desde la
 * última vez (se guarda la fecha en la propiedad «clave»). Cada copia lleva el
 * ID del original en el nombre, así no se repite.
 */
function espejoArchivos_(padre, clave) {
  if (String(config_().espejo_archivos || 'SI') === 'NO') return null;
  var props = PropertiesService.getScriptProperties();
  var destino = subcarpeta_(padre, NOMBRE_ESPEJO);
  var desde = props.getProperty(clave) || '2000-01-01T00:00:00Z';
  var it = carpetaArchivos_().searchFiles('modifiedDate > "' + desde + '" and trashed = false');
  var lista = [];
  while (it.hasNext()) lista.push(it.next());
  lista.sort(function (a, b) { return a.getLastUpdated() - b.getLastUpdated(); });
  var copiados = 0, i = 0, inicio = Date.now(), ultima = null;
  for (; i < lista.length && copiados < ESPEJO_MAX_POR_VEZ && Date.now() - inicio < 150000; i++) {
    var f = lista[i], nombre = f.getId() + ' · ' + f.getName();
    if (!destino.getFilesByName(nombre).hasNext()) { f.makeCopy(nombre, destino); copiados++; }
    ultima = f.getLastUpdated();
  }
  // Un segundo antes: si dos escaneos tienen la misma hora, el que faltó entra la próxima vez (el nombre evita duplicados).
  if (ultima) props.setProperty(clave, Utilities.formatDate(new Date(ultima.getTime() - 1000), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"));
  return { copiados: copiados, pendientes: lista.length - i };
}

/** La copia fuera de la cuenta. Si algo falla aquí, el respaldo normal ya quedó. */
function respaldoExterno_(hoja, nombre) {
  var m = String(config_().respaldo_externo || '').match(/[-\w]{25,}/);
  if (!m) return null;
  try {
    var ext = DriveApp.getFolderById(m[0]);
    hoja.makeCopy(nombre, ext);
    podarRespaldos_(ext);
    var esp = espejoArchivos_(ext, 'ULTIMO_ESPEJO_EXT');
    return { ok: true, espejo: esp };
  } catch (e) {
    console.error('respaldo externo: ' + (e && e.message));
    return { ok: false, error: 'no se pudo copiar (¿la carpeta existe y la cuenta dueña puede editarla?)' };
  }
}

/* ─────────── Prueba de restauración (solo el dueño) ─────────── */

function revisarRespaldos() {
  nuevaPeticion_();
  soloDueno_();
  var props = PropertiesService.getScriptProperties();
  var log = ['Revisión de respaldos · ' + sello_(new Date()), ''];
  var problemas = 0;
  var actuales = {};
  Object.keys(COLS).forEach(function (n) { try { actuales[n] = Math.max(0, hoja_(n).getLastRow() - 1); } catch (e) { actuales[n] = null; } });
  var revisarCarpeta = function (titulo, id) {
    if (!id) { log.push('· ' + titulo + ': no configurada.'); return; }
    var carpeta;
    try { carpeta = DriveApp.getFolderById(id); } catch (e) { log.push('✘ ' + titulo + ': no se encontró la carpeta.'); problemas++; return; }
    var copias = [], it = carpeta.getFiles();
    while (it.hasNext()) { var f = it.next(), dia = diaDeRespaldo_(f); if (dia && !f.isTrashed()) copias.push({ f: f, dia: dia }); }
    copias.sort(function (a, b) { return a.dia < b.dia ? 1 : -1; });
    if (!copias.length) { log.push('✘ ' + titulo + ': no hay copias todavía.'); problemas++; return; }
    var ult = copias[0];
    var dias = Math.round((Date.now() - new Date(ult.dia + 'T12:00:00').getTime()) / 86400000);
    log.push((dias <= 2 ? '✔ ' : '✘ ') + titulo + ': ' + copias.length + ' copia(s); la más reciente es del ' + ult.dia + (dias > 2 ? ' (hace ' + dias + ' días: revisa el disparador respaldoDiario)' : '') + '.');
    if (dias > 2) problemas++;
    try {
      var libro = SpreadsheetApp.openById(ult.f.getId());
      Object.keys(COLS).forEach(function (n) {
        var sh = libro.getSheetByName(n);
        if (!sh) { log.push('   ✘ falta la pestaña ' + n); problemas++; return; }
        var cols = COLS[n], ancho = Math.min(cols.length, sh.getMaxColumns());
        var cab = sh.getRange(1, 1, 1, ancho).getValues()[0].map(function (x) { return String(x).trim(); });
        var bien = cab.every(function (x, i) { return x === cols[i] || x === ''; });
        var filas = Math.max(0, sh.getLastRow() - 1);
        log.push('   ' + (bien ? '✔' : '✘') + ' ' + n + ': ' + filas + ' renglón(es)' + (actuales[n] !== null ? ' (hoy: ' + actuales[n] + ')' : '') + (bien ? '' : ' · columnas distintas'));
        if (!bien) problemas++;
      });
    } catch (e) {
      log.push('   ✘ no se pudo abrir la copia: ' + (e && e.message)); problemas++;
    }
    try {
      var esp = carpeta.getFoldersByName(NOMBRE_ESPEJO);
      if (esp.hasNext()) {
        var n = 0, it2 = esp.next().getFiles();
        while (it2.hasNext() && n < 20000) { it2.next(); n++; }
        log.push('   · Escaneos en el espejo: ' + n);
      }
    } catch (e2) { /* sin espejo */ }
  };
  revisarCarpeta('Respaldos (misma cuenta)', props.getProperty('ID_RESPALDOS'));
  var m = String(config_().respaldo_externo || '').match(/[-\w]{25,}/);
  revisarCarpeta('Carpeta externa', m ? m[0] : '');
  var vivos = 0;
  try { var it3 = carpetaArchivos_().getFiles(); while (it3.hasNext() && vivos < 20000) { if (!it3.next().isTrashed()) vivos++; } } catch (e3) { /* sin carpeta */ }
  log.push('', '· Escaneos en «Archivos»: ' + vivos);
  log.push(problemas ? '⚠ Hay ' + problemas + ' punto(s) por revisar.' : '✔ Los respaldos se pueden abrir y están completos.');
  console.log(log.join('\n'));
  return log.join('\n');
}
