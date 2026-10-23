// Ayudas compartidas por las pruebas nuevas (1.3.0 en adelante).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { crearEntorno } = require("./simulador.cjs");

// base/base.json son los datos reales migrados: NO se suben a GitHub (.gitignore).
const RUTA_BASE = path.join(__dirname, "..", "base", "base.json");
const HAY_BASE = fs.existsSync(RUTA_BASE);
const BASE = HAY_BASE ? JSON.parse(fs.readFileSync(RUTA_BASE, "utf8")) : null;
const testBase = HAY_BASE ? test : (n, f) => test(n, { skip: "sin base/base.json (los datos reales no se suben a GitHub)" }, f);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");

/** Entorno instalado (con la base migrada si existe) y el admin con contraseña definitiva. */
function preparar({ conBase = true } = {}) {
  const e = crearEntorno();
  if (conBase && BASE) e.cargarBase(BASE);
  const salida = e.comoDueno("instalar");
  const m = salida.match(/Usuario: (\S+)\s+Contraseña temporal: (\S+)/);
  assert.ok(m, "instalar() debe mostrar el primer administrador:\n" + salida);
  e.comoAnonimo();
  const r1 = e.api(null, "entrar", { usuario: m[1], clave: m[2] });
  const r2 = e.api(r1.datos.token, "cambiarClave", { actual: m[2], nueva: "Jacaranda2026x" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  e.admin = r2.datos.token;
  e.salidaInstalar = salida;
  return e;
}

/** Da de alta un usuario y devuelve su token (ya con contraseña definitiva). */
function alta(e, usuario, rol, tipos, extra = {}) {
  const r = e.api(e.admin, "guardarUsuario", { nuevo: true, usuario, nombre: "Persona " + usuario, rol, tipos, ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  const r1 = e.api(null, "entrar", { usuario, clave: r.datos.temporal });
  const r2 = e.api(r1.datos.token, "cambiarClave", { actual: r.datos.temporal, nueva: "Ahuehuete2026x" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  return r2.datos.token;
}

function entrar(e, usuario, clave = "Ahuehuete2026x") {
  const r = e.api(null, "entrar", { usuario, clave });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.datos.token;
}

const nuevoOficio = (extra = {}) => ({ tipo: "OFS", asunto: "Solicitud de apoyo logístico", fecha: "2026-10-21",
  dirigido_id: "", dirigido_a: "Mtro. Daniel Esteban Ramírez Garcén\nDirector General", firma_id: "",
  firma: "Lic. José Antonio Jiménez Islas\nSubsecretario", elaboro: "Valentina J", acuse: "NO", ...extra });

const filasDe = (e, hoja) => e.hoja(hoja).getLastRow();

module.exports = { test, assert, crearEntorno, preparar, alta, entrar, nuevoOficio, filasDe, testBase, HAY_BASE, BASE, PDF };
