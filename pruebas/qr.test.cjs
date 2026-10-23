// El código QR de AppQR.html (hecho sin librerías) se lee con un lector real.
// Necesita Python 3 con OpenCV (pip install opencv-python-headless); si no está, se salta.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const PY = ["python3", "python", "py"].find((p) => spawnSync(p, ["-c", "import cv2"], { encoding: "utf8" }).status === 0);

function cargarQR() {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps-script", "AppQR.html"), "utf8").replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");
  const ctx = vm.createContext({ TextEncoder, Math, Array, Error, Infinity });
  vm.runInContext(src + "\nthis.QR = QR;", ctx);
  return ctx.QR;
}

/** La matriz como imagen PGM (la lee OpenCV sin más librerías), 8 px por módulo y 4 de margen. */
function pgm(m, archivo) {
  const esc = 8, borde = 4, n = (m.length + borde * 2) * esc;
  const px = Buffer.alloc(n * n, 255);
  m.forEach((fila, y) => fila.forEach((osc, x) => {
    if (!osc) return;
    for (let dy = 0; dy < esc; dy++) for (let dx = 0; dx < esc; dx++) px[((y + borde) * esc + dy) * n + (x + borde) * esc + dx] = 0;
  }));
  fs.writeFileSync(archivo, Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), px]));
}

test("QR: tamaños correctos y patrones fijos en su lugar", () => {
  const QR = cargarQR();
  const m1 = QR.matriz("HOLA");
  assert.equal(m1.length, 21, "versión 1");
  // las tres esquinas con su patrón de búsqueda
  for (const [x, y] of [[0, 0], [m1.length - 7, 0], [0, m1.length - 7]]) {
    assert.equal(m1[y][x], true); assert.equal(m1[y + 1][x + 1], false); assert.equal(m1[y + 3][x + 3], true);
  }
  const largo = QR.matriz("otpauth://totp/Control%20de%20Gesti%C3%B3n%3Aun.usuario.largo?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Control%20de%20Gesti%C3%B3n");
  assert.ok(largo.length >= 45 && largo.length <= 57, "versión 7 a 10: " + largo.length);
  assert.throws(() => QR.matriz("x".repeat(500)), /demasiado largo/);
});

test("QR: lo lee un lector real (OpenCV)", PY ? {} : { skip: "sin Python con OpenCV (pip install opencv-python-headless)" }, () => {
  const QR = cargarQR();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qr-"));
  const textos = ["HOLA", "https://control-gestion.vercel.app",
    "otpauth://totp/Control%20de%20Gesti%C3%B3n%3Aadmin?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Control%20de%20Gesti%C3%B3n",
    "otpauth://totp/Control%20de%20Gesti%C3%B3n%3Avalentina.jimenez.lopez?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Control%20de%20Gesti%C3%B3n",
    "Ñandú · acentos áéíóú · " + "x".repeat(120)];
  const archivos = textos.map((t, i) => { const f = path.join(dir, i + ".pgm"); pgm(QR.matriz(t), f); return f; });
  const r = spawnSync(PY, ["-I", "-c", "import sys,cv2,json\nd=cv2.QRCodeDetector()\nprint(json.dumps([d.detectAndDecode(cv2.imread(f, cv2.IMREAD_GRAYSCALE))[0] for f in sys.argv[1:]]))", ...archivos], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), textos);
  fs.rmSync(dir, { recursive: true, force: true });
});
