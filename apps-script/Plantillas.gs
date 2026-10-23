/**
 * ════════════════════════════════════════════════════════════════════════
 *  CONTROL DE GESTIÓN · Borrador del oficio saliente en Word (1.7.0)
 *
 *  Toma un documento de Google Docs que sirve de plantilla, pone los datos
 *  del oficio donde dice {{NUMERO}}, {{FECHA_LARGA}}, {{DESTINATARIO}}…, y lo
 *  regresa como .docx para terminarlo en Word. La copia temporal se borra.
 *
 *  Por seguridad, la plantilla TIENE que estar en la carpeta «Control de
 *  Gestión · Plantillas» del Drive de la cuenta dueña (la crea instalar()):
 *  así nadie puede usar esta función para sacar otro documento de esa cuenta.
 * ════════════════════════════════════════════════════════════════════════
 */

var CAMPOS_PLANTILLA = ['NUMERO', 'CONSECUTIVO', 'ANIO', 'FECHA', 'FECHA_LARGA', 'DESTINATARIO', 'CARGO_DESTINATARIO',
  'ASUNTO', 'FIRMA', 'CARGO_FIRMA', 'ELABORO', 'CARPETA', 'OBSERVACIONES'];
var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function carpetaPlantillas_() {
  var id = PropertiesService.getScriptProperties().getProperty('ID_PLANTILLAS');
  if (!id) throw falla_('INSTALACION', 'Falta la carpeta de plantillas. El dueño debe correr instalar() desde el editor.');
  return DriveApp.getFolderById(id);
}

function idPlantillaDoc_(cfg) {
  var v = String((cfg || config_()).plantilla_doc_OFS || '');
  return /^[-\w]{25,}$/.test(v) ? v : '';
}

/** El archivo de la plantilla, si existe, es un Google Doc y está en la carpeta de plantillas. */
function revisarPlantillaDoc_(id) {
  var f;
  try { f = DriveApp.getFileById(id); } catch (e) { throw falla_('DATOS', 'No encontré ese documento. Revisa el enlace.'); }
  if (f.getMimeType() !== MimeType.GOOGLE_DOCS) {
    throw falla_('DATOS', 'La plantilla debe ser un documento de Google Docs (no Word ni PDF). Si tienes un Word, ábrelo en Drive y usa Archivo → Guardar como Documentos de Google.');
  }
  var carpeta = carpetaPlantillas_().getId(), dentro = false, it = f.getParents();
  while (it.hasNext()) if (it.next().getId() === carpeta) dentro = true;
  if (!dentro || f.isTrashed()) {
    throw falla_('DATOS', 'Por seguridad, la plantilla debe estar en la carpeta «Control de Gestión · Plantillas» del Drive de la cuenta dueña. Muévela ahí y vuelve a intentarlo.');
  }
  return f;
}

function fechaLarga_(iso) {
  if (!fechaValida_(String(iso || ''))) return '';
  var p = iso.split('-').map(Number);
  return p[2] + ' de ' + MESES_LARGOS[p[1] - 1] + ' de ' + p[0];
}

function valoresPlantilla_(r) {
  var lineas = function (s) { var x = String(s || '').split('\n'); return { primera: x[0].trim(), resto: x.slice(1).join(' ').trim() }; };
  var dir = lineas(r.dirigido_a), fir = lineas(r.firma);
  var plano = function (s) { return String(s || '').replace(/\s*\n\s*/g, ' ').trim(); };
  return {
    NUMERO: r.numero || etiquetaNum_(r), CONSECUTIVO: etiquetaNum_(r).split('/')[0], ANIO: String(r.anio),
    FECHA: fechaCortaSrv_(r.fecha), FECHA_LARGA: fechaLarga_(r.fecha),
    DESTINATARIO: dir.primera, CARGO_DESTINATARIO: dir.resto, ASUNTO: plano(r.asunto),
    FIRMA: fir.primera, CARGO_FIRMA: fir.resto, ELABORO: plano(r.elaboro), CARPETA: plano(r.carpeta), OBSERVACIONES: plano(r.observaciones)
  };
}

/** replaceText usa expresiones regulares de Java: en el reemplazo, $ y \ tienen significado. */
function literalReemplazo_(s) { return String(s).replace(/\\/g, '\\\\').replace(/\$/g, '\\$'); }

function generarOficio_(yo, d) {
  var r = registroPorId_(d.id);
  puedeTipo_(yo, r.tipo);
  if (!TIPOS[r.tipo].numeroAuto) throw falla_('DATOS', 'El borrador solo se genera para oficios salientes.');
  if (r.estatus === 'Cancelado') throw falla_('DATOS', 'El oficio está cancelado.');
  var id = idPlantillaDoc_();
  if (!id) throw falla_('DATOS', 'Falta configurar la plantilla del oficio (Configuración → Plantilla del oficio).');
  var plantilla = revisarPlantillaDoc_(id);
  var nombre = 'Oficio ' + String(r.numero || etiquetaNum_(r)).replace(/[\\/:*?"<>|]+/g, '-');
  var copia = plantilla.makeCopy(nombre, subcarpeta_(carpetaPlantillas_(), 'Temporales (se borran solos)'));
  try {
    var doc = DocumentApp.openById(copia.getId());
    var valores = valoresPlantilla_(r);
    [doc.getBody(), doc.getHeader(), doc.getFooter()].forEach(function (parte) {
      if (!parte) return;
      CAMPOS_PLANTILLA.forEach(function (k) { parte.replaceText('\\{\\{' + k + '\\}\\}', literalReemplazo_(valores[k])); });
    });
    doc.saveAndClose();
    var resp = UrlFetchApp.fetch('https://docs.google.com/document/d/' + copia.getId() + '/export?format=docx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('Google no exportó el documento (' + resp.getResponseCode() + ')');
    var bytes = resp.getBlob().getBytes();
    bitacora_(yo.usuario, 'oficio', r.id, 'Generó el borrador en Word de ' + (r.numero || etiquetaNum_(r)));
    return { nombre: nombre + '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: Utilities.base64Encode(bytes) };
  } finally {
    try { copia.setTrashed(true); } catch (e) { /* se queda en Temporales */ }
  }
}
