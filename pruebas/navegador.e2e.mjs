// ════════════════════════════════════════════════════════════════════════
//  navegador.e2e.mjs · Recorrido en un navegador real (Playwright) de lo
//  nuevo en 1.7.0, con la CSP de Vercel y también como Apps Script.
//
//    npm run e2e
//
//  Necesita base/base.json (datos reales: no está en GitHub) y Playwright
//  (npm i -D playwright  y  npx playwright install chromium).
//  Deja las capturas y el resultado en capturas/1.7.0/ (tampoco van a GitHub).
// ════════════════════════════════════════════════════════════════════════
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = join(RAIZ, "capturas", "1.7.0");
const P_SRV = 4391, P_WEB = 4392;
const require = createRequire(import.meta.url);

let playwright;
try { playwright = require("playwright"); } catch {
  console.error("Falta Playwright:  npm i -D playwright  y luego  npx playwright install chromium");
  process.exit(1);
}
if (!existsSync(join(RAIZ, "base", "base.json"))) { console.error("Falta base/base.json (los datos migrados)."); process.exit(1); }
mkdirSync(SALIDA, { recursive: true });

/* ── servidores locales ── */
const hijos = [];
function arrancar(args, listo) {
  return new Promise((ok, mal) => {
    const p = spawn(process.execPath, args, { cwd: RAIZ, env: { ...process.env } });
    hijos.push(p);
    let txt = "";
    const t = setTimeout(() => mal(new Error("No arrancó: " + args.join(" ") + "\n" + txt)), 30000);
    p.stdout.on("data", (d) => { txt += d; if (listo.test(txt)) { clearTimeout(t); ok(txt); } });
    p.stderr.on("data", (d) => { txt += d; });
    p.on("exit", (c) => { if (c) { clearTimeout(t); mal(new Error(args.join(" ") + " salió con " + c + "\n" + txt)); } });
  });
}
const armado = spawnSync(process.execPath, ["herramientas/armar-web.mjs"], { cwd: RAIZ, encoding: "utf8",
  env: { ...process.env, CG_PERMITIR_LOCAL: "1", CG_API_URL: `http://localhost:${P_SRV}/exec` } });
if (armado.status !== 0) { console.error(armado.stdout + armado.stderr); process.exit(1); }
await arrancar(["pruebas/servidor-local.cjs", String(P_SRV)], /admin: /);
await arrancar(["pruebas/web-local.cjs", String(P_WEB), `http://localhost:${P_SRV}`], /dist\/ en/);
const admin = await (await fetch(`http://localhost:${P_SRV}/__admin`)).json();

/* ── código de la app de autenticación (RFC 6238), sin repetir intervalos ── */
let ultimoPaso = 0;
function base32(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const c of s.replace(/[\s=]/g, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
function totp(secreto, paso) {
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(paso));
  const hm = createHmac("sha1", base32(secreto)).update(m).digest(), o = hm[19] & 15;
  return String(((hm.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
async function codigoNuevo(secreto) {
  // El servidor acepta el intervalo actual ±1 y nunca uno ya usado.
  let ahora = Math.floor(Date.now() / 30000);
  let paso = Math.max(ahora, ultimoPaso + 1);
  while (paso > ahora + 1) { await new Promise((r) => setTimeout(r, 1000)); ahora = Math.floor(Date.now() / 30000); }
  ultimoPaso = paso;
  return totp(secreto, paso);
}

/* ── recorrido ── */
const resultado = [];
let fallas = 0;
async function paso(nombre, f) {
  try { const extra = await f(); resultado.push("✔ " + nombre + (extra ? ": " + extra : "")); console.log("✔ " + nombre + (extra ? ": " + extra : "")); }
  catch (e) { fallas++; resultado.push("✘ " + nombre + ": " + e.message.split("\n")[0]); console.log("✘ " + nombre + "\n  " + e.message); throw e; }
}
function esperar(c, m) { if (!c) throw new Error(m); }

const navegador = await playwright.chromium.launch();
const errores = [];
function vigilar(pagina, donde) {
  pagina.on("pageerror", (e) => errores.push(donde + " · error de JavaScript: " + e.message));
  pagina.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errores.push(donde + " · CSP: " + m.text()); });
}
const foto = async (p, n, o = {}) => { await p.waitForTimeout(350); return p.screenshot({ path: join(SALIDA, n), ...o }); };   // sin animaciones a medias
const NUEVA = "Jacaranda2026x";
let secreto = "";

try {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 860 }, locale: "es-MX", acceptDownloads: true });
  const p = await ctx.newPage();
  vigilar(p, "Vercel");
  await p.goto(`http://localhost:${P_WEB}/`);

  await paso("Contraseña nueva: las reglas se ven mientras se escribe y una fácil no pasa", async () => {
    await p.getByPlaceholder("nombre.apellido").fill(admin.usuario);
    await p.locator("input[type=password]").first().fill(admin.clave);
    await p.getByRole("button", { name: "Entrar" }).click();
    await p.getByText("Crea tu contraseña").waitFor();
    const [nueva, repite] = [p.getByPlaceholder("Por ejemplo, una frase corta con números"), p.getByPlaceholder("Escríbela otra vez")];
    await nueva.fill("Gestion2026"); await repite.fill("Gestion2026");
    const fallan = await p.locator("ul.reglas li:not(.ok)").allInnerTexts();
    esperar(fallan.some((t) => /fácil de adivinar/.test(t)), "debía marcar «fácil de adivinar»: " + fallan);
    await foto(p, "01-reglas-clave.png");
    await p.getByRole("button", { name: "Guardar contraseña" }).click();
    await p.getByText(/Le falta: que no sea fácil/).waitFor();
    await nueva.fill(NUEVA); await repite.fill(NUEVA);
    await p.getByRole("button", { name: "Guardar contraseña" }).click();
    await p.locator(".ptarjeta").first().waitFor();
    return fallan.length + " reglas sin cumplir con «Gestion2026»";
  });

  await paso("Portal del administrador: recomienda poner plazo y activar dos pasos", async () => {
    await p.getByText("Los entrantes no tienen plazo de respuesta.").waitFor();
    await p.getByText("Protege tu cuenta de administrador.").waitFor();
    await foto(p, "02-portal-recomendaciones.png");
  });

  await paso("Activar la verificación en dos pasos con el código QR", async () => {
    await p.locator(".alerta--accion", { hasText: "Protege tu cuenta" }).getByRole("button", { name: "Activar" }).click();
    await p.locator(".dospasos__qr svg").waitFor();
    secreto = (await p.locator(".dospasos__clave code").innerText()).replace(/\s/g, "");
    esperar(/^[A-Z2-7]{32}$/.test(secreto), "clave rara: " + secreto);
    await p.locator(".dospasos__qr svg").screenshot({ path: join(SALIDA, "qr.png") });
    await foto(p, "03-activar-dos-pasos.png");
    // ¿Lo lee un lector real? (si hay Python con OpenCV)
    const py = ["python3", "python"].find((x) => spawnSync(x, ["-c", "import cv2"]).status === 0);
    let leido = "sin OpenCV";
    if (py) {
      const r = spawnSync(py, ["-I", "-c", "import sys,cv2\nimg=cv2.imread(sys.argv[1]);img=cv2.resize(img,None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST)\nprint(cv2.QRCodeDetector().detectAndDecode(img)[0])", join(SALIDA, "qr.png")], { encoding: "utf8" });
      leido = r.stdout.trim();
      esperar(leido.startsWith("otpauth://totp/") && leido.includes("secret=" + secreto), "OpenCV leyó: " + leido);
    }
    rmSync(join(SALIDA, "qr.png"), { force: true });   // era solo para leerlo
    await p.getByLabel("Código que muestra la app").fill(await codigoNuevo(secreto));
    await p.locator(".dospasos input[type=password]").fill(NUEVA);
    await p.getByRole("button", { name: "Activar" }).last().click();
    await p.getByText("Protege tu cuenta de administrador.").waitFor({ state: "detached" });
    return py ? "OpenCV leyó el QR de la pantalla" : leido;
  });

  await paso("Mi cuenta: estado de dos pasos, correo y equipo; el foco no se sale de la ventana", async () => {
    await p.locator(".pcab__cuenta").click();
    const modal = p.locator(".modal").last();
    await modal.getByText("✓ Activada").waitFor();
    for (let i = 0; i < 12; i++) await p.keyboard.press("Tab");
    const dentro = await p.evaluate(() => !!document.activeElement.closest(".modal"));
    esperar(dentro, "el Tab sacó el foco de la ventana");
    await modal.getByPlaceholder("nombre@dominio.mx").fill("persona@ejemplo.mx");
    await modal.getByRole("button", { name: "Guardar" }).click();
    await p.getByText("Correo guardado.").waitFor();
    await foto(p, "04-mi-cuenta.png");
    await p.keyboard.press("Escape");
    await modal.waitFor({ state: "detached" });
    const foco = await p.evaluate(() => document.activeElement && document.activeElement.className);
    esperar(/pcab__cuenta/.test(foco), "el foco debía volver a «Mi cuenta»: " + foco);
  });

  await paso("Configuración: plazo, días inhábiles de ley, «sin acuse» desde y dos pasos obligatorio", async () => {
    await p.locator(".alerta--accion", { hasText: "plazo" }).getByRole("button", { name: "Configurar" }).click();
    await p.getByLabel("Días inhábiles", { exact: true }).waitFor();
    await p.getByLabel(/Plazo de respuesta/).fill("10");
    await p.getByRole("button", { name: /Agregar los de ley de 2026/ }).click();
    await p.getByLabel("«Sin acuse» cuenta desde").fill("2026-01-01");
    await p.getByLabel("Obligatoria para administradores").check();
    await p.getByRole("button", { name: "Guardar" }).first().click();
    await p.getByText("Configuración guardada.").waitFor();
    const dias = await p.getByLabel("Días inhábiles", { exact: true }).inputValue();
    esperar(dias.includes("2026-04-02") && dias.includes("2026-04-03") && dias.includes("2026-12-25") && dias.includes("2026-11-16"), "faltan festivos: " + dias);
    await foto(p, "05-configuracion.png", { fullPage: true });
    return dias.split("\n").length + " días (Jueves y Viernes Santo 2 y 3 de abril)";
  });

  await paso("Salir y entrar con código, recordando este equipo", async () => {
    await p.locator(".mcab__volver").click();
    await p.getByRole("button", { name: "Cerrar sesión" }).click();
    await p.getByRole("button", { name: "Entrar" }).waitFor();
    await p.getByPlaceholder("nombre.apellido").fill(admin.usuario);
    await p.locator("input[type=password]").first().fill(NUEVA);
    await p.getByLabel("Recordar mi usuario en este equipo").check();
    await p.getByRole("button", { name: "Entrar" }).click();
    await p.getByText("Tu contraseña es correcta. Falta un paso.").waitFor();
    await foto(p, "06-codigo.png");
    await p.getByLabel("Código de 6 dígitos").fill(await codigoNuevo(secreto));
    await p.getByRole("button", { name: "Verificar" }).click();
    await p.locator(".ptarjeta").first().waitFor();
    const equipo = JSON.parse(await p.evaluate(() => localStorage.getItem("cg_equipo") || "{}"));
    esperar(equipo.u === admin.usuario && /^[\w=-]+\.[\w-]{43}=?$/.test(equipo.t || ""), "no guardó el equipo de confianza: " + JSON.stringify(equipo));
  });

  await paso("Libreta: elegir varios y marcar el acuse de una vez", async () => {
    await p.locator(".ptarjeta", { hasText: "Oficios salientes" }).click();
    await p.getByRole("button", { name: "Seleccionar" }).click();
    const casillas = p.locator("tbody .sel__c");
    for (let i = 0; i < 3; i++) await casillas.nth(i).check();
    await p.getByText("3 elegidos").waitFor();
    await foto(p, "07-seleccion.png");
    await p.locator(".lote").getByRole("button", { name: "Acuse" }).click();
    await p.locator(".modal select").selectOption("SI");
    await p.getByRole("button", { name: "Cambiar 3" }).click();
    const listo = p.locator(".aviso", { hasText: /Listo:/ }).last();
    await listo.waitFor();
    const txt = await listo.innerText();
    esperar(/Listo: \d+ registros? cambiado/.test(txt), "aviso: " + txt);
    await foto(p, "08-lote-listo.png");
    return txt.split("\n")[0];
  });

  await paso("Si la sesión se vence con una ventana abierta, se pide la contraseña y el cambio se guarda solo", async () => {
    await p.locator("tbody .sel__c").nth(3).check();
    await p.locator(".lote").getByRole("button", { name: "Estatus" }).click();
    let falsa = true;
    await p.route(`http://localhost:${P_SRV}/exec`, (ruta) => {
      const cuerpo = ruta.request().postData() || "";
      if (falsa && cuerpo.includes('"accion":"guardarLote"')) {
        falsa = false;
        return ruta.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ ok: false, codigo: "SESION", error: "Tu sesión terminó por inactividad." }) });
      }
      return ruta.continue();
    });
    await p.getByRole("button", { name: "Cambiar 1" }).click();
    const re = p.locator(".modal", { hasText: "Tu sesión terminó" });
    await re.waitFor();
    esperar(await p.locator(".modal", { hasText: "Cambiar el estatus" }).count() === 1, "la ventana del cambio se cerró");
    await re.locator("input[type=password]").fill(NUEVA);
    await re.getByRole("button", { name: "Volver a entrar" }).click();
    await re.getByLabel("Código de 6 dígitos").waitFor();
    await foto(p, "09-reautenticar.png");
    await re.getByLabel("Código de 6 dígitos").fill(await codigoNuevo(secreto));
    await re.getByRole("button", { name: "Volver a entrar" }).click();
    await p.getByText(/Listo: 1 registro cambiado/).waitFor();
    await p.unroute(`http://localhost:${P_SRV}/exec`);
    await p.locator(".lote").getByRole("button", { name: "Terminar" }).click();
    await p.locator(".lote").waitFor({ state: "detached" });
  });

  await paso("Ver el escaneo sin salir: PDF en un marco (CSP con blob:) e imagen", async () => {
    await p.locator("tbody tr").first().click();
    const panel = p.locator(".panel");
    await panel.waitFor();
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    await panel.locator("input[type=file][accept^='.pdf']").first().setInputFiles({ name: "oficio-prueba.pdf", mimeType: "application/pdf", buffer: pdf });
    await p.getByText("Archivo guardado.").waitFor();
    await panel.getByRole("button", { name: "Abrir" }).first().click();
    const prev = p.locator(".modal", { has: p.locator(".previa") });
    await prev.locator(".previa__pdf").waitFor();
    esperar(/^blob:/.test(await prev.locator(".previa__pdf").getAttribute("src")), "el marco no usa blob:");
    await p.waitForTimeout(600);
    await foto(p, "10-ver-pdf.png");
    await prev.getByRole("button", { name: "Descargar" }).waitFor();
    await p.keyboard.press("Escape");
    await prev.waitFor({ state: "detached" });
    const png = Buffer.from(readFileSync(join(RAIZ, "web", "icono-192.png")));
    await panel.locator("input[type=file][accept^='.pdf']").nth(1).setInputFiles({ name: "acuse.png", mimeType: "image/png", buffer: png });
    await p.getByText("Archivo guardado.").last().waitFor();
    await panel.getByRole("button", { name: "Abrir" }).nth(1).click();
    await p.locator(".previa__img").waitFor();
    const ancho = await p.locator(".previa__img").evaluate((i) => i.naturalWidth);
    esperar(ancho === 192, "la imagen no cargó (ancho " + ancho + ")");
    await foto(p, "11-ver-imagen.png");
    await p.keyboard.press("Escape");
  });

  await paso("Usuarios: correo, etiqueta «Dos pasos» y opción para quitarla", async () => {
    await p.keyboard.press("Escape");
    await p.locator(".mcab__volver").click();
    await p.locator(".ptarjeta", { hasText: "Usuarios" }).click();
    const fila = p.locator("tr, .item", { hasText: admin.usuario }).first();
    await fila.getByText("Dos pasos").waitFor();
    await fila.getByRole("button", { name: /Editar/ }).click();
    await p.getByLabel(/Quitar su verificación en dos pasos/).waitFor();
    esperar(await p.getByLabel(/Correo para avisos/).inputValue() === "persona@ejemplo.mx", "no trae el correo");
    await foto(p, "12-usuario.png");
    await p.getByRole("button", { name: "Cancelar" }).click();
  });

  await paso("Celular: portal y «Mi cuenta» caben en la pantalla", async () => {
    const cel = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "es-MX" });
    const c = await cel.newPage();
    vigilar(c, "celular");
    await c.goto(`http://localhost:${P_WEB}/`);
    await c.getByPlaceholder("nombre.apellido").fill(admin.usuario);
    await c.locator("input[type=password]").first().fill(NUEVA);
    await c.getByRole("button", { name: "Entrar" }).click();
    await c.getByLabel("Código de 6 dígitos").fill(await codigoNuevo(secreto));
    await c.getByRole("button", { name: "Verificar" }).click();
    await c.locator(".ptarjeta").first().waitFor();
    const desborde = await c.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    esperar(desborde <= 0, "la página se sale " + desborde + " px a lo ancho");
    await foto(c, "13-celular-portal.png");
    await c.locator(".pcab__cuenta").click();
    await c.locator(".modal").getByText("✓ Activada").waitFor();
    await foto(c, "14-celular-mi-cuenta.png");
    await cel.close();
  });

  await paso("Como Apps Script (/exec de Google): entra con código y abre el portal", async () => {
    const gas = await navegador.newContext({ viewport: { width: 1280, height: 860 }, locale: "es-MX" });
    const g = await gas.newPage();
    vigilar(g, "Apps Script");
    await g.goto(`http://localhost:${P_SRV}/`);
    await g.getByPlaceholder("nombre.apellido").fill(admin.usuario);
    await g.locator("input[type=password]").first().fill(NUEVA);
    await g.getByRole("button", { name: "Entrar" }).click();
    await g.getByLabel("Código de 6 dígitos").fill(await codigoNuevo(secreto));
    await g.getByRole("button", { name: "Verificar" }).click();
    await g.locator(".ptarjeta").first().waitFor();
    const n = await g.locator(".ptarjeta").count();
    await foto(g, "15-apps-script-portal.png");
    await gas.close();
    return n + " tarjetas";
  });

  await paso("Sin errores de JavaScript ni bloqueos de la CSP", async () => {
    esperar(!errores.length, errores.join("\n"));
  });
} catch (e) {
  if (!fallas) { fallas++; resultado.push("✘ " + e.message.split("\n")[0]); console.log(e); }
} finally {
  writeFileSync(join(SALIDA, "resultado.txt"), resultado.join("\n") + "\n");
  await navegador.close();
  hijos.forEach((h) => h.kill());
}
console.log(fallas ? "\n✘ El recorrido falló." : "\n✔ Recorrido completo. Capturas en capturas/1.7.0/");
process.exit(fallas ? 1 : 0);
