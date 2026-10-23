// Prueba del generador de Excel (Excel.html) en Node: el archivo debe abrirse
// con openpyxl (Python) y con LibreOffice, con fechas reales y texto intacto.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");

// Python con openpyxl: en Windows suele llamarse "python" o "py", no "python3".
// Si no hay, la parte de openpyxl se salta (no truena: así «npm run publicar» funciona igual).
function buscarPython() {
  for (const [cmd, pre] of [["python3", []], ["python", []], ["py", ["-3"]]]) {
    try {
      execFileSync(cmd, [...pre, "-I", "-c", "import openpyxl"], { stdio: "ignore", timeout: 20000, cwd: os.tmpdir() });
      return { cmd, pre };
    } catch (e) { /* siguiente */ }
  }
  return null;
}
const PY = buscarPython();

function cargarExcel() {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Excel.html"), "utf8").replace(/<\/?script>/g, "");
  const ctx = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Date, Math, String, Number, Object, Array, isNaN });
  vm.runInContext(src + ";this.ExcelCG = ExcelCG;", ctx);
  return ctx.ExcelCG;
}

test("crc32 correcto", () => {
  const X = cargarExcel();
  if (zlib.crc32) assert.equal(X._crc32(Buffer.from("hola mundo")), zlib.crc32(Buffer.from("hola mundo")));
  assert.equal(X._serial("2026-01-12"), 46034);
});

test("el .xlsx abre en openpyxl con datos, fechas, estilos y filtros", PY ? {} : { skip: "sin Python 3 con openpyxl (pip install openpyxl)" }, () => {
  const X = cargarExcel();
  const bytes = X.libro([
    { nombre: "Oficios salientes", titulos: ["Secretaría de Atención y Participación Ciudadana", "Control de Gestión · Oficios salientes 2026"],
      encabezados: ["Núm.", "No. de oficio", "Dirigido a", "Asunto", "Fecha", "Acuse"], anchos: [8, 22, 34, 50, 12, 8],
      tipos: ["numero", "texto", "texto", "texto", "fecha", "centro"],
      filas: [[1, "SAPCI/STPI/001/2026", "Lic. Juan <Pérez> & Cía\nDirector", 'Asunto con "comillas" y acentos áéí ñ', "2026-01-12", "Sí"],
        [2, "SAPCI/STPI/002/2026", "Otra", "=1+1 no es fórmula", "", ""]], pie: "Generado por prueba" },
    { nombre: "Hoja/con:raros?", titulos: ["x"], encabezados: ["a"], anchos: [10], filas: [] },
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xl-"));
  const ruta = path.join(dir, "prueba.xlsx");
  fs.writeFileSync(ruta, bytes);
  const py = `
import openpyxl, sys, json
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.worksheets[0]
out = {"hojas": wb.sheetnames, "A1": ws["A1"].value, "C5": ws["C5"].value, "D6": ws["D6"].value, "D6t": ws["D6"].data_type,
       "E5": str(ws["E5"].value), "E5fmt": ws["E5"].number_format, "A5": ws["A5"].value, "filtro": ws.auto_filter.ref,
       "fijo": ws.freeze_panes, "banda": ws["A4"].fill.fgColor.rgb, "merge": [str(m) for m in ws.merged_cells.ranges]}
print(json.dumps(out, ensure_ascii=False))`;
  const r = JSON.parse(execFileSync(PY.cmd, [...PY.pre, "-I", "-c", py, ruta], { cwd: os.tmpdir(), env: { ...process.env, PYTHONIOENCODING: "utf-8" } }).toString());
  assert.deepEqual(r.hojas, ["Oficios salientes", "Hoja con raros"]);
  assert.equal(r.A1, "Secretaría de Atención y Participación Ciudadana");
  assert.equal(r.C5, "Lic. Juan <Pérez> & Cía\nDirector");
  assert.equal(r.D6, "=1+1 no es fórmula");
  assert.equal(r.D6t, "s", "texto, no fórmula");
  assert.equal(r.E5, "2026-01-12 00:00:00");
  assert.equal(r.E5fmt, "dd/mm/yyyy");
  assert.equal(r.A5, 1);
  assert.equal(r.filtro, "A4:F6");
  assert.equal(r.fijo, "A5");
  assert.equal(r.banda, "FF8F4889");
  assert.ok(r.merge.includes("A1:F1"));
  // LibreOffice lo abre y lo convierte sin quejarse (si está instalado)
  try {
    execFileSync("soffice", ["--headless", "--convert-to", "csv", "--outdir", dir, ruta], { stdio: "ignore", timeout: 60000 });
    const csv = fs.readFileSync(path.join(dir, "prueba.csv"), "utf8");
    assert.match(csv, /SAPCI\/STPI\/001\/2026/);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
});

test("respaldo: varias hojas con acentos; una fecha que no es fecha se conserva como texto", PY ? {} : { skip: "sin Python 3 con openpyxl" }, () => {
  const X = cargarExcel();
  const bytes = X.libro([
    { nombre: "Registros", titulos: ["Respaldo"], encabezados: ["id", "fecha", "anio"], anchos: [10, 12, 8], tipos: ["texto", "fecha", "numero"],
      filas: [["r1", "2026-10-22", 2026], ["r2", "SIN DATO", 2026], ["r3", "", 2026]] },
    { nombre: "Bitácora", titulos: ["x"], encabezados: ["detalle"], anchos: [40], filas: [["=HYPERLINK(\"x\")"]] },
    { nombre: "Configuración", titulos: ["x"], encabezados: ["clave"], anchos: [20], filas: [["mantenimiento"]] },
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xl-"));
  const ruta = path.join(dir, "respaldo.xlsx");
  fs.writeFileSync(ruta, bytes);
  const py = `
import openpyxl, sys, json
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.worksheets[0]
print(json.dumps({"hojas": wb.sheetnames, "B4": str(ws["B4"].value), "B5": ws["B5"].value, "B6": ws["B6"].value,
  "C4": ws["C4"].value, "bit": wb.worksheets[1]["A4"].value, "bitt": wb.worksheets[1]["A4"].data_type}, ensure_ascii=False))`;
  const r = JSON.parse(execFileSync(PY.cmd, [...PY.pre, "-I", "-c", py, ruta], { cwd: os.tmpdir(), env: { ...process.env, PYTHONIOENCODING: "utf-8" } }).toString());
  assert.deepEqual(r.hojas, ["Registros", "Bitácora", "Configuración"]);
  assert.equal(r.B4, "2026-10-22 00:00:00");
  assert.equal(r.B5, "SIN DATO", "no se pierde el texto");
  assert.equal(r.B6, null);
  assert.equal(r.C4, 2026);
  assert.equal(r.bit, '=HYPERLINK("x")');
  assert.equal(r.bitt, "s", "texto, no fórmula");
});
