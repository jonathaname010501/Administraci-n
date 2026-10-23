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

test("el .xlsx abre en openpyxl con datos, fechas, estilos y filtros", () => {
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
  const r = JSON.parse(execFileSync("python3", ["-I", "-c", py, ruta], { cwd: os.tmpdir() }).toString());
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
