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

const DIR = path.join(__dirname, "..", "apps-script");
const ARCHIVOS_GS = ["Servidor.gs", "Instalacion.gs"];

const firmados = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const aBuffer = (x) => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(x.map((b) => b & 0xff)));

function crearEntorno({ dueno = "dueno@gmail.com" } = {}) {
  const reloj = { offset: 0 };
  const RealDate = Date;
  class FDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + reloj.offset); else super(...a); }
    static now() { return RealDate.now() + reloj.offset; }
  }
  const estado = { activo: dueno, dueno, errores: [], logs: [], url: "" };

  // ── Hojas ─────────────────────────────────────────────────────────
  class Rango {
    constructor(h, r, c, nr, nc) { Object.assign(this, { h, r, c, nr, nc }); }
    getValues() {
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
  class Libro {
    constructor(nombre) { this.id = "hoja-" + crypto.randomUUID().slice(0, 8); this.nombre = nombre; this.hojas = []; libros.set(this.id, this); drive.archivos.set(this.id, nuevoArchivo(this.id, nombre, Buffer.from(""), "application/vnd.google-apps.spreadsheet")); }
    getId() { return this.id; }
    getSheetByName(n) { return this.hojas.find((h) => h.nombre === n) || null; }
    insertSheet(n) { const h = new Hoja(n); this.hojas.push(h); return h; }
    setSpreadsheetTimeZone(tz) { this.tz = tz; }
  }

  // ── Drive ─────────────────────────────────────────────────────────
  const drive = { archivos: new Map(), carpetas: new Map() };
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  function nuevoArchivo(id, nombre, bytes, mime, padre) {
    return { id, nombre, bytes, mime, padres: new Set(padre ? [padre] : []), papelera: false, acceso: "PRIVATE", editores: [], lectores: [], creado: new FDate() };
  }
  const Access = { PRIVATE: "PRIVATE", ANYONE: "ANYONE", ANYONE_WITH_LINK: "ANYONE_WITH_LINK", DOMAIN: "DOMAIN" };
  const usuarioDrive = (e) => ({ getEmail: () => e });
  function envolverArchivo(a) {
    return {
      getId: () => a.id, getName: () => a.nombre, isTrashed: () => a.papelera, setTrashed: (v) => { a.papelera = v; },
      getBlob: () => blob(firmados(a.bytes), a.mime, a.nombre),
      getParents: () => iter([...a.padres].map((p) => envolverCarpeta(drive.carpetas.get(p)))),
      getSharingAccess: () => a.acceso, getEditors: () => [dueno, ...a.editores].map(usuarioDrive), getViewers: () => a.lectores.map(usuarioDrive),
      getDateCreated: () => a.creado,
      makeCopy: (nombre, carpeta) => { const id = "f-" + crypto.randomUUID().slice(0, 8); const c = nuevoArchivo(id, nombre, a.bytes, a.mime, carpeta.getId()); drive.archivos.set(id, c); return envolverArchivo(c); },
    };
  }
  function envolverCarpeta(c) {
    return {
      getId: () => c.id, getName: () => c.nombre, isTrashed: () => c.papelera, setTrashed: (v) => { c.papelera = v; },
      createFile: (b) => { const id = "f-" + crypto.randomUUID().slice(0, 12); const a = nuevoArchivo(id, b.getName(), aBuffer(b.getBytes()), b.getContentType(), c.id); drive.archivos.set(id, a); return envolverArchivo(a); },
      getFiles: () => iter([...drive.archivos.values()].filter((a) => a.padres.has(c.id) && !a.papelera).map(envolverArchivo)),
      getSharingAccess: () => c.acceso, getEditors: () => [dueno, ...c.editores].map(usuarioDrive), getViewers: () => c.lectores.map(usuarioDrive),
    };
  }
  const DriveApp = {
    Access,
    createFolder: (nombre) => { const id = "d-" + crypto.randomUUID().slice(0, 8); const c = { id, nombre, papelera: false, acceso: "PRIVATE", editores: [], lectores: [] }; drive.carpetas.set(id, c); return envolverCarpeta(c); },
    getFolderById: (id) => { const c = drive.carpetas.get(id); if (!c) throw new Error("No existe la carpeta " + id); return envolverCarpeta(c); },
    getFileById: (id) => { const a = drive.archivos.get(id); if (!a) throw new Error("No existe el archivo " + id); return envolverArchivo(a); },
  };

  // ── Utilities ─────────────────────────────────────────────────────
  function blob(datos, mime, nombre) {
    let bytes = typeof datos === "string" ? firmados(Buffer.from(datos, "utf8")) : datos.slice();
    return { getBytes: () => bytes.slice(), getDataAsString: () => aBuffer(bytes).toString("utf8"), getContentType: () => mime || "application/octet-stream", getName: () => nombre, setName(n) { nombre = n; return this; } };
  }
  const Utilities = {
    DigestAlgorithm: { SHA_256: "sha256" }, MacAlgorithm: { HMAC_SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    computeDigest: (alg, v) => firmados(crypto.createHash(alg).update(aBuffer(v)).digest()),
    computeHmacSignature: (alg, valor, clave) => {
      if (!Array.isArray(valor) || !Array.isArray(clave)) throw new Error("computeHmacSignature: en el servidor se usa con Byte[]");
      return firmados(crypto.createHmac(alg, aBuffer(clave)).update(aBuffer(valor)).digest());
    },
    base64Encode: (x) => aBuffer(x).toString("base64"),
    base64Decode: (s) => firmados(Buffer.from(s, "base64")),
    getUuid: () => crypto.randomUUID(),
    newBlob: blob,
    formatDate: (d, tz, fmt) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
      return fmt.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", p.hour).replace("mm", p.minute).replace("ss", p.second);
    },
  };

  // ── Servicios varios ──────────────────────────────────────────────
  const cacheMap = new Map();
  const CacheService = { getScriptCache: () => ({
    get: (k) => { const e = cacheMap.get(k); if (!e || e.exp < FDate.now()) { cacheMap.delete(k); return null; } return e.v; },
    put: (k, v, seg = 600) => { if (String(v).length > 100000) throw new Error("Valor de caché demasiado grande"); cacheMap.set(k, { v: String(v), exp: FDate.now() + seg * 1000 }); },
    remove: (k) => cacheMap.delete(k),
  }) };
  const candado = { tomado: false, veces: 0 };
  const LockService = { getScriptLock: () => ({
    waitLock: () => { if (candado.tomado) throw new Error("Candado ocupado (¿no se liberó?)"); candado.tomado = true; candado.veces++; },
    tryLock: () => { if (candado.tomado) return false; candado.tomado = true; return true; },
    releaseLock: () => { candado.tomado = false; },
  }) };
  const props = new Map();
  const PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k),
  }) };
  const disparadores = [];
  const ScriptApp = {
    WeekDay: { MONDAY: "MONDAY" },
    getProjectTriggers: () => disparadores.map((d) => ({ getHandlerFunction: () => d.fn })),
    newTrigger: (fn) => { const d = { fn }; const b = { timeBased: () => b, onWeekDay: (x) => { d.dia = x; return b; }, atHour: (h) => { d.hora = h; return b; }, create: () => { disparadores.push(d); return d; } }; return b; },
    getService: () => ({ getUrl: () => estado.url }),
  };
  const Session = { getActiveUser: () => ({ getEmail: () => estado.activo }), getEffectiveUser: () => ({ getEmail: () => estado.dueno }), getScriptTimeZone: () => "America/Mexico_City" };

  let libroActivo = new Libro("Control de Gestión");
  const SpreadsheetApp = {
    ProtectionType: { SHEET: "SHEET" },
    getActiveSpreadsheet: () => libroActivo,
    openById: (id) => { const l = libros.get(id); if (!l) throw new Error("No existe la hoja " + id); return l; },
    flush: () => {},
  };

  // ── HtmlService (plantillas <?!= ?>) ──────────────────────────────
  const leerHtml = (n) => fs.readFileSync(path.join(DIR, n + ".html"), "utf8");
  const salida = (html) => { const o = { html, getContent: () => o.html, setTitle: (t) => { o.titulo = t; return o; }, addMetaTag: () => o, setXFrameOptionsMode: () => o }; return o; };
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

  const ctx = vm.createContext({ Date: FDate, Math, JSON, String, Number, Object, Array, RegExp, Error, Boolean, isNaN, parseInt, parseFloat,
    SpreadsheetApp, CacheService, LockService, PropertiesService, DriveApp, ScriptApp, Session, Utilities, HtmlService, ContentService, console: consola });
  const fuentes = ARCHIVOS_GS.map((f) => fs.readFileSync(path.join(DIR, f), "utf8"));
  ARCHIVOS_GS.forEach((f, i) => vm.runInContext(fuentes[i], ctx, { filename: f }));

  const funcionesDeclaradas = [...new Set(fuentes.flatMap((s) => [...s.matchAll(/^function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1])))];

  function sinFechas(x, donde) {
    if (x instanceof RealDate || (x && x.constructor && x.constructor.name === "FDate")) throw new Error("google.script.run no admite Date (" + donde + ")");
    if (x && typeof x === "object") Object.values(x).forEach((v) => sinFechas(v, donde));
  }

  return {
    ctx, estado, reloj, candado, drive, props, disparadores, cacheMap,
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
