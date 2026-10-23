// ════════════════════════════════════════════════════════════════════════
//  simulador.cjs · Un Apps Script de mentiras para probar el servidor en
//  Node: hojas, caché, candado, propiedades, Drive, HMAC/SHA-256, sesión.
//
//  Se porta "pesimista" donde importa para seguridad:
//   · Un texto que empieza con "=" se guarda como FÓRMULA (como Sheets).
//   · En celdas sin formato de texto, "001" se vuelve 1 y "2026-01-12" fecha.
//   · getRange fuera de las filas que tiene la hoja truena (como Sheets).
//   · Lo que cruza google.script.run pasa por JSON y no admite Date.
// ════════════════════════════════════════════════════════════════════════
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const DIR = path.join(__dirname, "..", "apps-script");
// Todos los .gs del proyecto: Servidor.gs primero y los demás en orden alfabético
// (crearEntorno({ ordenGs: "inverso" }) los carga al revés, para comprobar que
// nada depende del orden en que Google cargue los archivos).
const ARCHIVOS_GS = ["Servidor.gs"].concat(fs.readdirSync(DIR).filter((f) => f.endsWith(".gs") && f !== "Servidor.gs").sort());

const firmados = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const aBuffer = (x) => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(x.map((b) => b & 0xff)));

function crearEntorno({ dueno = "dueno@gmail.com", ordenGs = "normal", iteraciones = 1000 } = {}) {
  // reloj.fijo (ms): el tiempo deja de correr solo; solo avanza con reloj.offset (para medir sin ruido).
  const reloj = { offset: 0, fijo: null };
  const RealDate = Date;
  const ahora = () => (reloj.fijo === null ? RealDate.now() : reloj.fijo) + reloj.offset;
  class FDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(ahora()); else super(...a); }
    static now() { return ahora(); }
  }
  const estado = { activo: dueno, dueno, errores: [], logs: [], url: "", correos: [], cuotaCorreo: 100, exportados: [] };
  // Contadores para medir cuánto trabaja cada acción (aperturas de la hoja, lecturas, celdas).
  const medidas = { aperturas: 0, lecturas: 0, celdas: 0, busquedas: 0, cache: 0, propiedades: 0 };

  // ── Hojas ─────────────────────────────────────────────────────────
  class Rango {
    constructor(h, r, c, nr, nc) { Object.assign(this, { h, r, c, nr, nc }); }
    getValues() {
      medidas.lecturas++; medidas.celdas += this.nr * this.nc;
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const fila = [];
        for (let j = 0; j < this.nc; j++) {
          const v = (this.h.datos[this.r - 1 + i] || [])[this.c - 1 + j];
          fila.push(v === undefined || v === null ? "" : v && v.formula ? "#FORMULA" : v);
        }
        out.push(fila);
      }
      return out;
    }
    setValues(v) {
      if (v.length !== this.nr || v.some((f) => f.length !== this.nc)) throw new Error("Las dimensiones no coinciden");
      v.forEach((fila, i) => fila.forEach((x, j) => {
        if (x instanceof RealDate || (x && x.constructor && x.constructor.name === "FDate")) throw new Error("Date en setValues: el servidor solo debe escribir texto");
        const rr = this.r - 1 + i, cc = this.c - 1 + j;
        const fmt = (this.h.formatos[rr] || [])[cc] || "";
        let val = x;
        if (typeof x === "string" && x.startsWith("=")) val = { formula: x };
        else if (typeof x === "string" && x.startsWith("'")) val = x.slice(1);
        else if (typeof x === "string" && fmt !== "@") {
          if (/^-?\d+(\.\d+)?$/.test(x)) val = Number(x);
          else if (/^\d{4}-\d{2}-\d{2}$/.test(x)) val = new RealDate(x + "T00:00:00");
        }
        (this.h.datos[rr] = this.h.datos[rr] || [])[cc] = val;
      }));
      return this;
    }
    setNumberFormat(f) {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) (this.h.formatos[this.r - 1 + i] = this.h.formatos[this.r - 1 + i] || [])[this.c - 1 + j] = f;
      return this;
    }
    setNumberFormats(m) { m.forEach((f, i) => f.forEach((x, j) => ((this.h.formatos[this.r - 1 + i] = this.h.formatos[this.r - 1 + i] || [])[this.c - 1 + j] = x))); return this; }
    getRow() { return this.r; }
    /** Como Range.createTextFinder de Sheets (solo lo que usa el servidor). */
    createTextFinder(texto) {
      const rango = this, op = { entera: false, mayus: false };
      const tf = {
        matchEntireCell(v) { op.entera = !!v; return tf; },
        matchCase(v) { op.mayus = !!v; return tf; },
        findAll() {
          medidas.busquedas++;
          const out = [], buscado = op.mayus ? String(texto) : String(texto).toLowerCase();
          for (let i = 0; i < rango.nr; i++) for (let j = 0; j < rango.nc; j++) {
            const v = (rango.h.datos[rango.r - 1 + i] || [])[rango.c - 1 + j];
            if (v === undefined || v === null || v === "") continue;
            const s = op.mayus ? String(v) : String(v).toLowerCase();
            if (op.entera ? s === buscado : s.indexOf(buscado) >= 0) out.push(new Rango(rango.h, rango.r + i, rango.c + j, 1, 1));
          }
          return out;
        },
      };
      return tf;
    }
    setFontWeight() { return this; }
    setBackground() { return this; }
    setFontColor() { return this; }
  }
  class Hoja {
    constructor(nombre) { this.nombre = nombre; this.datos = []; this.formatos = []; this.maxRows = 1000; this.maxCols = 26; this.protecciones = []; this.lecturas = 0; }
    getName() { return this.nombre; }
    getLastRow() { for (let i = this.datos.length - 1; i >= 0; i--) if ((this.datos[i] || []).some((v) => v !== "" && v !== undefined && v !== null)) return i + 1; return 0; }
    getLastColumn() { let m = 0; this.datos.forEach((f) => (f || []).forEach((v, j) => { if (v !== "" && v !== undefined && v !== null) m = Math.max(m, j + 1); })); return m; }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    insertRowsAfter(_d, n) { this.maxRows += n; }
    insertColumnsAfter(_d, n) { this.maxCols += n; }
    /** Como Sheets: agrega un renglón después del último con datos (una sola operación). */
    appendRow(fila) {
      const r = this.getLastRow() + 1;
      if (r > this.maxRows) this.maxRows = r;
      if (fila.length > this.maxCols) this.maxCols = fila.length;
      new Rango(this, r, 1, 1, fila.length).setValues([fila]);
      return this;
    }
    getRange(r, c, nr = 1, nc = 1) {
      if (r < 1 || c < 1 || r + nr - 1 > this.maxRows || c + nc - 1 > this.maxCols) throw new Error(`Rango fuera de la hoja ${this.nombre}: ${r},${c},${nr},${nc} (max ${this.maxRows}x${this.maxCols})`);
      this.lecturas++;
      return new Rango(this, r, c, nr, nc);
    }
    setFrozenRows() {}
    protect() { const p = { setDescription() { return p; }, setWarningOnly() { return p; } }; this.protecciones.push(p); return p; }
    getProtections() { return this.protecciones; }
  }
  const libros = new Map();
  const SHEET_MIME = "application/vnd.google-apps.spreadsheet", DOC_MIME = "application/vnd.google-apps.document";
  class Libro {
    constructor(nombre, idFijo, padre) {
      this.id = idFijo || idDrive("hoja"); this.nombre = nombre; this.hojas = []; libros.set(this.id, this);
      drive.archivos.set(this.id, nuevoArchivo(this.id, nombre, Buffer.from(""), SHEET_MIME, padre));
    }
    getId() { return this.id; }
    getSheetByName(n) { return this.hojas.find((h) => h.nombre === n) || null; }
    insertSheet(n) { const h = new Hoja(n); this.hojas.push(h); return h; }
    setSpreadsheetTimeZone(tz) { this.tz = tz; }
  }
  /** Copia de la hoja de cálculo (lo que hace makeCopy en Drive): se puede abrir con openById. */
  function clonarLibro(origen, nombre, padre) {
    const id = idDrive("hoja");
    const l = new Libro(nombre, id, padre);
    l.hojas = origen.hojas.map((h) => {
      const c = new Hoja(h.nombre);
      c.datos = h.datos.map((f) => (f ? f.slice() : f)); c.formatos = h.formatos.map((f) => (f ? f.slice() : f));
      c.maxRows = h.maxRows; c.maxCols = h.maxCols;
      return c;
    });
    return l;
  }

  // ── Drive ─────────────────────────────────────────────────────────
  // IDs como los de Drive: largos (33+), con letras, números, - y _
  const idDrive = (p) => p + "-" + crypto.randomBytes(24).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const drive = { archivos: new Map(), carpetas: new Map() };
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  function nuevoArchivo(id, nombre, bytes, mime, padre) {
    return { id, nombre, bytes, mime, padres: new Set(padre ? [padre] : []), papelera: false, acceso: "PRIVATE", editores: [], lectores: [], creado: new FDate(), modificado: new FDate() };
  }
  const Access = { PRIVATE: "PRIVATE", ANYONE: "ANYONE", ANYONE_WITH_LINK: "ANYONE_WITH_LINK", DOMAIN: "DOMAIN" };
  const usuarioDrive = (e) => ({ getEmail: () => e });
  function envolverArchivo(a) {
    return {
      getId: () => a.id, getName: () => a.nombre, isTrashed: () => a.papelera, setTrashed: (v) => { a.papelera = v; a.modificado = new FDate(); },
      getBlob: () => blob(firmados(a.bytes), a.mime, a.nombre), getMimeType: () => a.mime,
      getParents: () => iter([...a.padres].map((p) => envolverCarpeta(drive.carpetas.get(p)))),
      getSharingAccess: () => a.acceso, getEditors: () => [dueno, ...a.editores].map(usuarioDrive), getViewers: () => a.lectores.map(usuarioDrive),
      getDateCreated: () => a.creado, getLastUpdated: () => a.modificado,
      makeCopy: (nombre, carpeta) => {
        if (a.mime === SHEET_MIME && libros.has(a.id)) return envolverArchivo(drive.archivos.get(clonarLibro(libros.get(a.id), nombre, carpeta.getId()).id));
        const id = idDrive("f"); const c = nuevoArchivo(id, nombre, a.bytes, a.mime, carpeta.getId()); drive.archivos.set(id, c); return envolverArchivo(c);
      },
    };
  }
  /** Lo que usa el servidor de las búsquedas de Drive: modifiedDate > "…" y trashed = false. */
  function filtroBusqueda(q) {
    const m = /modifiedDate > "([^"]+)"/.exec(q);
    const desde = m ? new RealDate(m[1]).getTime() : -Infinity;
    const sinPapelera = /trashed = false/.test(q);
    return (a) => a.modificado.getTime() > desde && (!sinPapelera || !a.papelera);
  }
  function envolverCarpeta(c) {
    const archivosDe = () => [...drive.archivos.values()].filter((a) => a.padres.has(c.id));
    return {
      getId: () => c.id, getName: () => c.nombre, isTrashed: () => c.papelera, setTrashed: (v) => { c.papelera = v; },
      createFile: (b) => { const id = idDrive("f"); const a = nuevoArchivo(id, b.getName(), aBuffer(b.getBytes()), b.getContentType(), c.id); drive.archivos.set(id, a); return envolverArchivo(a); },
      createFolder: (nombre) => envolverCarpeta(crearCarpeta(nombre, c.id)),
      getFolders: () => iter([...drive.carpetas.values()].filter((x) => x.padre === c.id && !x.papelera).map(envolverCarpeta)),
      getFoldersByName: (n) => iter([...drive.carpetas.values()].filter((x) => x.padre === c.id && x.nombre === n && !x.papelera).map(envolverCarpeta)),
      getFiles: () => iter(archivosDe().filter((a) => !a.papelera).map(envolverArchivo)),
      getFilesByName: (n) => iter(archivosDe().filter((a) => !a.papelera && a.nombre === n).map(envolverArchivo)),
      searchFiles: (q) => iter(archivosDe().filter(filtroBusqueda(q)).map(envolverArchivo)),
      getSharingAccess: () => c.acceso, getEditors: () => [dueno, ...c.editores].map(usuarioDrive), getViewers: () => c.lectores.map(usuarioDrive),
    };
  }
  function crearCarpeta(nombre, padre) {
    const id = idDrive("d");
    const c = { id, nombre, padre: padre || null, papelera: false, acceso: "PRIVATE", editores: [], lectores: [] };
    drive.carpetas.set(id, c);
    return c;
  }
  const DriveApp = {
    Access,
    createFolder: (nombre) => envolverCarpeta(crearCarpeta(nombre)),
    getFolderById: (id) => { const c = drive.carpetas.get(id); if (!c) throw new Error("No existe la carpeta " + id); return envolverCarpeta(c); },
    getFileById: (id) => { const a = drive.archivos.get(id); if (!a) throw new Error("No existe el archivo " + id); return envolverArchivo(a); },
  };
  const MimeType = { GOOGLE_DOCS: DOC_MIME, GOOGLE_SHEETS: SHEET_MIME, PDF: "application/pdf" };

  // ── Utilities ─────────────────────────────────────────────────────
  function blob(datos, mime, nombre) {
    let bytes = typeof datos === "string" ? firmados(Buffer.from(datos, "utf8")) : datos.slice();
    return { getBytes: () => bytes.slice(), getDataAsString: () => aBuffer(bytes).toString("utf8"), getContentType: () => mime || "application/octet-stream", getName: () => nombre, setName(n) { nombre = n; return this; } };
  }
  /** Un SimpleDateFormat chiquito: yyyy MM dd HH mm ss u y 'literales'. */
  function formatear(d, tz, fmt) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
    const dia = { Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6", Sun: "7" }[p.weekday];
    return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|u/g, (t, lit) => (lit !== undefined ? lit : { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second, u: dia }[t]));
  }
  const Utilities = {
    DigestAlgorithm: { SHA_256: "sha256" }, MacAlgorithm: { HMAC_SHA_256: "sha256", HMAC_SHA_1: "sha1" }, Charset: { UTF_8: "utf8" },
    computeDigest: (alg, v) => firmados(crypto.createHash(alg).update(aBuffer(v)).digest()),
    computeHmacSignature: (alg, valor, clave) => {
      if (!Array.isArray(valor) || !Array.isArray(clave)) throw new Error("computeHmacSignature: en el servidor se usa con Byte[]");
      if (valor.concat(clave).some((b) => b > 127 || b < -128)) throw new Error("computeHmacSignature: los Byte[] van de -128 a 127");
      if (simular.hmac) simular.hmac();
      return firmados(crypto.createHmac(alg, aBuffer(clave)).update(aBuffer(valor)).digest());
    },
    base64Encode: (x) => aBuffer(x).toString("base64"),
    base64Decode: (s) => firmados(Buffer.from(s, "base64")),
    base64EncodeWebSafe: (x) => aBuffer(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    base64DecodeWebSafe: (s) => firmados(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64")),
    gzip: (b) => blob(firmados(zlib.gzipSync(aBuffer(b.getBytes()))), "application/x-gzip", "x.gz"),
    ungzip: (b) => blob(firmados(zlib.gunzipSync(aBuffer(b.getBytes()))), "application/octet-stream", "x"),
    getUuid: () => crypto.randomUUID(),
    newBlob: blob,
    formatDate: formatear,
  };

  // ── Servicios varios ──────────────────────────────────────────────
  const cacheMap = new Map();
  const cacheGet = (k) => { const e = cacheMap.get(k); if (!e || e.exp < FDate.now()) { cacheMap.delete(k); return null; } return e.v; };
  const cachePut = (k, v, seg = 600) => { if (String(v).length > 100000) throw new Error("Valor de caché demasiado grande"); if (seg > 21600) throw new Error("La caché dura máximo 6 h"); cacheMap.set(k, { v: String(v), exp: FDate.now() + seg * 1000 }); };
  const CacheService = { getScriptCache: () => ({
    get: (k) => { medidas.cache++; return cacheGet(k); },
    getAll: (ks) => { medidas.cache++; const o = {}; ks.forEach((k) => { const v = cacheGet(k); if (v !== null) o[k] = v; }); return o; },
    put: (k, v, seg) => { medidas.cache++; cachePut(k, v, seg); },
    putAll: (o, seg) => { medidas.cache++; Object.keys(o).forEach((k) => cachePut(k, o[k], seg)); },
    remove: (k) => cacheMap.delete(k),
    removeAll: (ks) => ks.forEach((k) => cacheMap.delete(k)),
  }) };
  const candado = { tomado: false, veces: 0, ocupadoPorOtro: false };
  const LockService = { getScriptLock: () => ({
    waitLock: () => { if (candado.ocupadoPorOtro) throw new Error("Lock timeout"); if (candado.tomado) throw new Error("Candado ocupado (¿no se liberó?)"); candado.tomado = true; candado.veces++; },
    tryLock: () => { if (candado.tomado || candado.ocupadoPorOtro) return false; candado.tomado = true; candado.veces++; return true; },
    releaseLock: () => { candado.tomado = false; },
  }) };
  const props = new Map();
  if (iteraciones) props.set("ITERACIONES_CLAVE", String(iteraciones));   // rápido en las pruebas (instalar() no recalibra si ya hay valor)
  const PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => { medidas.propiedades++; return props.has(k) ? props.get(k) : null; }, setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k),
  }) };
  const disparadores = [];
  const ScriptApp = {
    WeekDay: { MONDAY: "MONDAY" },
    getProjectTriggers: () => disparadores.map((d) => ({ getHandlerFunction: () => d.fn, getUniqueId: () => d.id })),
    deleteTrigger: (t) => { const i = disparadores.findIndex((d) => d.id === t.getUniqueId()); if (i >= 0) disparadores.splice(i, 1); },
    newTrigger: (fn) => {
      const d = { fn, id: String(Math.floor(Math.random() * 1e12)) };
      const b = { timeBased: () => b, onWeekDay: (x) => { d.dia = x; return b; }, everyDays: (n) => { d.cadaDias = n; return b; }, atHour: (h) => { d.hora = h; return b; }, create: () => { disparadores.push(d); return d; } };
      return b;
    },
    getService: () => ({ getUrl: () => estado.url }),
    getOAuthToken: () => "token-de-prueba",
  };
  const Session = { getActiveUser: () => ({ getEmail: () => estado.activo }), getEffectiveUser: () => ({ getEmail: () => estado.dueno }), getScriptTimeZone: () => "America/Mexico_City" };
  const MailApp = {
    sendEmail: (o) => { if (estado.cuotaCorreo <= 0) throw new Error("Service invoked too many times for one day: email."); estado.cuotaCorreo--; estado.correos.push(o); },
    getRemainingDailyQuota: () => estado.cuotaCorreo,
  };
  /** Un Google Doc de mentiras: su texto vive en los bytes del archivo de Drive. */
  const DocumentApp = {
    openById: (id) => {
      const a = drive.archivos.get(id);
      if (!a || a.mime !== DOC_MIME) throw new Error("No es un documento: " + id);
      let texto = aBuffer(a.bytes).toString("utf8");
      const parte = { replaceText: (patron, reemplazo) => { texto = texto.replace(new RegExp(patron, "g"), () => reemplazo.replace(/\\([\\$])/g, "$1")); return parte; } };
      return { getBody: () => parte, getHeader: () => null, getFooter: () => null, saveAndClose: () => { a.bytes = Buffer.from(texto, "utf8"); } };
    },
  };
  const UrlFetchApp = {
    fetch: (url, o) => {
      const m = /docs\.google\.com\/document\/d\/([^/]+)\/export\?format=docx/.exec(url);
      if (!m || !o || !o.headers || !/^Bearer /.test(o.headers.Authorization || "")) return { getResponseCode: () => 403, getBlob: () => blob("", "text/plain", "x") };
      const a = drive.archivos.get(m[1]);
      estado.exportados.push(m[1]);
      return { getResponseCode: () => (a ? 200 : 404), getBlob: () => blob("DOCX:" + (a ? aBuffer(a.bytes).toString("utf8") : ""), "application/octet-stream", "x.docx") };
    },
  };
  const simular = {};

  let libroActivo = new Libro("Control de Gestión");
  const SpreadsheetApp = {
    ProtectionType: { SHEET: "SHEET" },
    getActiveSpreadsheet: () => libroActivo,
    openById: (id) => { medidas.aperturas++; const l = libros.get(id); if (!l) throw new Error("No existe la hoja " + id); return l; },
    flush: () => {},
  };

  // ── HtmlService (plantillas <?!= ?>) ──────────────────────────────
  // Como Google: al leer un archivo HTML del proyecto se pierden los comentarios <!-- -->.
  const leerHtml = (n) => fs.readFileSync(path.join(DIR, n + ".html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const salida = (html) => { const o = { html, getContent: () => o.html, setTitle: (t) => { o.titulo = t; return o; }, setFaviconUrl: (u) => { if (!/^https:\/\//.test(u)) throw new Error("favicon inválido"); o.favicon = u; return o; }, addMetaTag: () => o, setXFrameOptionsMode: () => o }; return o; };
  const HtmlService = {
    XFrameOptionsMode: { DEFAULT: "DEFAULT", ALLOWALL: "ALLOWALL" },
    createHtmlOutputFromFile: (n) => salida(leerHtml(n)),
    createHtmlOutput: (html) => salida(String(html)),
    createTemplateFromFile: (n) => ({ evaluate: () => salida(leerHtml(n).replace(/<\?!=\s*([\s\S]*?)\s*\?>/g, (_, expr) => String(vm.runInContext(expr, ctx)))) }),
  };

  const ContentService = {
    MimeType: { JSON: "application/json", TEXT: "text/plain" },
    createTextOutput: (t) => { const o = { texto: String(t), mime: "text/plain", getContent: () => o.texto, setMimeType: (m) => { o.mime = m; return o; } }; return o; },
  };

  const consola = {
    log: (...a) => estado.logs.push(a.join(" ")),
    error: (...a) => estado.errores.push(a.join(" ")),
    warn: (...a) => estado.logs.push(a.join(" ")),
  };

  const ctx = vm.createContext({ Date: FDate, Math, JSON, String, Number, Object, Array, RegExp, Error, Boolean, isNaN, parseInt, parseFloat, encodeURIComponent,
    SpreadsheetApp, CacheService, LockService, PropertiesService, DriveApp, ScriptApp, Session, Utilities, HtmlService, ContentService,
    MailApp, DocumentApp, UrlFetchApp, MimeType, console: consola });
  const orden = ordenGs === "inverso" ? ARCHIVOS_GS.slice().reverse() : ARCHIVOS_GS;
  const fuentes = orden.map((f) => fs.readFileSync(path.join(DIR, f), "utf8"));
  orden.forEach((f, i) => vm.runInContext(fuentes[i], ctx, { filename: f }));

  const funcionesDeclaradas = [...new Set(fuentes.flatMap((s) => [...s.matchAll(/^function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1])))];

  function sinFechas(x, donde) {
    if (x instanceof RealDate || (x && x.constructor && x.constructor.name === "FDate")) throw new Error("google.script.run no admite Date (" + donde + ")");
    if (x && typeof x === "object") Object.values(x).forEach((v) => sinFechas(v, donde));
  }

  return {
    ctx, estado, reloj, candado, drive, props, disparadores, cacheMap, medidas, simular, libros,
    /** Corre la función como la llamaría SU disparador (con el ID del disparador en el evento). */
    disparar(fn) { const d = disparadores.find((x) => x.fn === fn); if (!d) throw new Error("No hay disparador para " + fn); return ctx[fn]({ triggerUid: d.id }); },
    /** Un Google Doc (para plantillas) dentro de una carpeta. */
    crearDoc(nombre, texto, carpetaId) { const id = idDrive("doc"); drive.archivos.set(id, nuevoArchivo(id, nombre, Buffer.from(texto, "utf8"), DOC_MIME, carpetaId)); return id; },
    /** Pone los contadores en cero y devuelve los anteriores. */
    medir() { const m = { ...medidas }; Object.keys(medidas).forEach((k) => { medidas[k] = 0; }); return m; },
    libro: () => libroActivo,
    funcionesDeclaradas,
    /** Llama una función del servidor como lo haría google.script.run. */
    run(fn, ...args) {
      if (typeof fn !== "string" || fn.endsWith("_") || !funcionesDeclaradas.includes(fn)) throw new Error("google.script.run: " + fn + " no es una función pública");
      sinFechas(args, "argumentos");
      const r = ctx[fn](...JSON.parse(JSON.stringify(args)));
      sinFechas(r, "respuesta de " + fn);
      if (candado.tomado) throw new Error(fn + " dejó el candado tomado");
      return r === undefined ? null : JSON.parse(JSON.stringify(r));
    },
    api(token, accion, datos) { return this.run("api", token, accion, datos || {}); },
    /** Como un POST a la URL /exec (lo que hace la página publicada en Vercel). */
    post(cuerpo) {
      const salida = ctx.doPost({ postData: { contents: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), type: "text/plain" } });
      if (candado.tomado) throw new Error("doPost dejó el candado tomado");
      return { mime: salida.mime, json: JSON.parse(salida.getContent()) };
    },
    comoDueno(fn) { const a = estado.activo; estado.activo = dueno; try { return ctx[fn](); } finally { estado.activo = a; } },
    comoAnonimo() { estado.activo = ""; },
    /** Carga base.json como si fuera el Excel convertido a Google Sheets (todo texto). */
    cargarBase(base) {
      for (const [nombre, filas] of Object.entries(base)) {
        const h = libroActivo.getSheetByName(nombre) || libroActivo.insertSheet(nombre);
        h.maxRows = Math.max(1000, filas.length + 5);
        h.maxCols = Math.max(26, ...filas.map((f) => f.length));
        filas.forEach((f, i) => { h.datos[i] = f.map((v) => v); h.formatos[i] = f.map(() => "@"); });
      }
    },
    hoja: (n) => libroActivo.getSheetByName(n),
  };
}

module.exports = { crearEntorno };
