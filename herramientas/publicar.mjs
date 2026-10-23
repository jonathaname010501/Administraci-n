// ════════════════════════════════════════════════════════════════════════
//  publicar.mjs · Publica un cambio con UN solo comando (Windows, Mac, Linux)
//
//    npm run publicar -- "Qué cambió"
//
//  Hace, en este orden, y se detiene en el primer paso que falle:
//    1. Corre las pruebas (npm test).
//    2. Revisa que VERSION (Servidor.gs) y VERSION_APP (App.html) coincidan.
//    3. Sube el código a Apps Script:            clasp push --force
//       (si la versión trae columnas nuevas, te pide correr instalar())
//    4. Publica la versión nueva en la MISMA implementación (la URL /exec
//       no cambia):                               clasp update-deployment <ID> -d "…"
//    5. Revisa que git no vaya a subir datos reales (base/, capturas/, .xlsx…).
//    6. git add, commit y push (Vercel publica la página solo).
//
//  El ID de la implementación se guarda en .publicar.json (NO va a GitHub).
//  Nada de esto usa la terminal de Windows por dentro: todo se llama con
//  Node directamente, así funciona igual en cmd, PowerShell o Git Bash.
// ════════════════════════════════════════════════════════════════════════
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import vm from "node:vm";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVO_ID = join(RAIZ, ".publicar.json");
const EN_WINDOWS = process.platform === "win32";
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n, s) => (COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
const titulo = (s) => console.log("\n" + c("1;35", s));
const bien = (s) => console.log(c("32", "  ✔ ") + s);
const nota = (s) => console.log(c("2", "    " + s));
const aviso = (s) => console.log(c("33", "  ⚠ ") + s);

/** Se detiene, explica qué pasó y qué hacer, y sale con error. */
function alto(que, pasos = [], extra = "") {
  console.log("\n" + c("1;31", "✘ " + que));
  if (extra) console.log(extra);
  if (pasos.length) {
    console.log("\nQué hacer:");
    pasos.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  }
  console.log("");
  process.exit(1);
}

function correr(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { cwd: RAIZ, stdio: o.ver ? "inherit" : "pipe", encoding: "utf8", shell: false, env: o.env || process.env });
  return { ok: r.status === 0, status: r.status, salida: (r.stdout || "") + (r.stderr || ""), error: r.error };
}
const git = (args, o) => correr("git", args, o);

function preguntar(texto) {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(String(r || "").trim()); }));
}

/* ─────────────────────────── utilidades del proyecto ─────────────────────────── */

const leer = (rel) => readFileSync(join(RAIZ, rel), "utf8");

function versiones() {
  const srv = (leer("apps-script/Servidor.gs").match(/var VERSION = '([^']+)'/) || [])[1];
  const app = (leer("apps-script/App.html").match(/var VERSION_APP = '([^']+)'/) || [])[1];
  return { srv, app };
}

/** COLS de un Servidor.gs (texto) → { Registros: [...], ... } */
function columnasDe(texto) {
  const m = String(texto || "").match(/var COLS = (\{[\s\S]*?\n\});/);
  if (!m) return null;
  try { return vm.runInNewContext("(" + m[1] + ")", {}, { timeout: 1000 }); } catch (e) { return null; }
}

function leerConfig() {
  if (!existsSync(ARCHIVO_ID)) return {};
  try { return JSON.parse(readFileSync(ARCHIVO_ID, "utf8")); } catch (e) {
    alto(".publicar.json está dañado.", ["Bórralo y vuelve a correr el comando: te pedirá el ID de nuevo."]);
  }
}
function guardarConfig(cfg) { writeFileSync(ARCHIVO_ID, JSON.stringify(cfg, null, 2) + "\n"); }
const ID_VALIDO = (s) => /^AKfyc[A-Za-z0-9_-]{20,}$/.test(String(s || ""));

/** Dónde está clasp. Se corre con Node directo (sin la terminal de Windows). */
function buscarClasp() {
  if (process.env.CG_CLASP) return process.env.CG_CLASP;   // solo para las pruebas automáticas
  const desde = (base) => {
    const pj = join(base, "@google", "clasp", "package.json");
    if (!existsSync(pj)) return null;
    const p = JSON.parse(readFileSync(pj, "utf8"));
    const bin = typeof p.bin === "string" ? p.bin : (p.bin && p.bin.clasp);
    return bin ? join(base, "@google", "clasp", bin) : null;
  };
  const local = desde(join(RAIZ, "node_modules"));
  if (local) return local;
  // npm en Windows es npm.cmd: necesita la terminal, pero aquí no va nada que escriba el usuario.
  const r = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: EN_WINDOWS });
  const raiz = String(r.stdout || "").trim();
  return raiz ? desde(raiz) : null;
}
const clasp = (ruta, args, o = {}) => correr(process.execPath, [ruta, ...args], o);

/** Lo que dice .gitignore que NO se sube, y lo que no debe subirse nunca. */
const PROHIBIDOS = [
  [/^base\//, "la base con datos reales (base/)"],
  [/^capturas\//, "capturas de pantalla con datos (capturas/)"],
  [/\.xlsx$/i, "archivos de Excel (.xlsx)"],
  [/\.csv$/i, "archivos .csv"],
  [/(^|\/)\.clasprc\.json$/, "la llave de clasp (.clasprc.json)"],
  [/(^|\/)\.clasp\.json$/, ".clasp.json"],
  [/(^|\/)\.publicar\.json$/, ".publicar.json"],
  [/(^|\/)\.env(\.|$)/, "archivos .env"],
];
const REGLAS_GITIGNORE = ["base/", "capturas/", "*.xlsx", ".clasp.json", ".clasprc.json", ".publicar.json"];

// Lo ÚNICO que se sube a GitHub: el código y la documentación. Cualquier otro
// archivo nuevo (un escaneo, una foto, un Excel, un .json exportado…) detiene
// la publicación aunque .gitignore no lo cubra.
const PERMITIDOS = [/^apps-script\//, /^herramientas\//, /^pruebas\//, /^web\//, /^[^/]+\.md$/i,
  /^package(-lock)?\.json$/, /^vercel\.json$/, /^\.gitignore$/, /^\.gitattributes$/, /^\.clasp\.json\.ejemplo$/, /^\.claspignore$/];
const EXT_DATOS = /\.(pdf|xlsx?|xlsm|ods|csv|tsv|docx?|odt|rtf|zip|rar|7z|json|jpe?g|png|gif|webp|heic|heif|tiff?|bmp|txt|eml|msg)$/i;
const EXCEPCIONES = [/^web\/[^/]+\.(png|svg)$/i, /^package(-lock)?\.json$/, /^vercel\.json$/, /^apps-script\/appsscript\.json$/];

function esDato(f) {
  const p = PROHIBIDOS.find(([re]) => re.test(f));
  if (p) return p[1];
  if (EXT_DATOS.test(f) && !EXCEPCIONES.some((re) => re.test(f))) return "archivo de datos (" + f.split(".").pop().toLowerCase() + ")";
  return null;
}

/** Lista de git, con rutas relativas a la carpeta del proyecto (aunque el repositorio esté más arriba). */
const lista = (args) => git(args).salida.split("\0").filter(Boolean).map((f) => f.replace(/\\/g, "/"));

function revisarGit() {
  const gi = existsSync(join(RAIZ, ".gitignore")) ? leer(".gitignore").split(/\r?\n/).map((l) => l.trim()) : [];
  const faltan = REGLAS_GITIGNORE.filter((r) => !gi.includes(r));
  if (faltan.length) {
    alto("A .gitignore le faltan reglas que protegen los datos: " + faltan.join(", "),
      ["Abre .gitignore y agrega esas líneas (cada una en su renglón).", "Vuelve a correr npm run publicar."]);
  }
  const ya = lista(["ls-files", "-z", "--", "."]).map((f) => [f, esDato(f)]).filter((x) => x[1]);
  if (ya.length) {
    const quitar = [...new Set(ya.map(([f]) => (/^(base|capturas)\//.test(f) ? f.split("/")[0] + "/" : '"' + f + '"')))];
    alto("Hay archivos con datos que YA están en git (se subieron antes):",
      ["Sácalos de git sin borrarlos de tu computadora:  git rm -r --cached " + quitar.join(" "),
        "Haz commit de eso y vuelve a correr npm run publicar.",
        "Si ya llegaron a GitHub, avísale al administrador del repositorio: quedan en el historial."],
      ya.map(([f, p]) => "    · " + f + "  (" + p + ")").join("\n"));
  }
  // Lo que se subiría: archivos nuevos (no ignorados), modificados y ya preparados
  const porSubir = [...new Set([].concat(
    lista(["ls-files", "-z", "--others", "--exclude-standard", "--", "."]),
    lista(["ls-files", "-z", "--modified", "--", "."]),
    lista(["diff", "--cached", "--name-only", "-z", "--relative", "--diff-filter=ACMR"])))];
  const malos = porSubir.map((f) => [f, esDato(f) || (PERMITIDOS.some((re) => re.test(f)) ? null : "no es código ni documentación")]).filter((x) => x[1]);
  if (malos.length) {
    alto("git iba a subir archivos que no son código:",
      ["Si son datos (escaneos, fotos, Excel, exportaciones): sácalos de la carpeta del proyecto o agrégalos a .gitignore.",
        "Si sí deben subirse, avísale a quien le da mantenimiento para agregarlos a la lista de herramientas/publicar.mjs.",
        "Vuelve a correr npm run publicar."],
      malos.map(([f, p]) => "    · " + f + "  (" + p + ")").join("\n"));
  }
  return porSubir.length;
}

/* ─────────────────────────────────── principal ─────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const yaInstalar = args.includes("--ya-corri-instalar");
  const mensaje = args.filter((a) => !a.startsWith("--")).join(" ").trim();

  console.log(c("1", "\nControl de Gestión · Publicar"));
  if (!mensaje) {
    alto("Falta el mensaje que describe el cambio.", ['Escríbelo entre comillas:  npm run publicar -- "Agregué varios destinatarios"']);
  }
  if (mensaje.length > 200) alto("El mensaje es muy largo (máximo 200 letras).", ["Escribe uno más corto."]);
  if (Number(process.versions.node.split(".")[0]) < 20) alto("Se necesita Node.js 20 o más nuevo (tienes " + process.version + ").", ["Instala la versión LTS desde nodejs.org."]);

  /* ── Antes de tocar nada: que esté todo lo necesario ── */
  titulo("Revisando que todo esté listo…");
  const claspJson = join(RAIZ, ".clasp.json");
  if (!existsSync(claspJson)) {
    alto("Falta .clasp.json (dice a qué proyecto de Apps Script subir el código).",
      ["Copia .clasp.json.ejemplo con el nombre .clasp.json.", "Pega el ID de la secuencia de comandos (Apps Script → ⚙ Configuración del proyecto).", "Ver INSTALAR.md, Parte C."]);
  }
  let cj;
  try { cj = JSON.parse(readFileSync(claspJson, "utf8")); } catch (e) { alto(".clasp.json no se puede leer (¿le falta una coma o comillas?).", ["Compáralo con .clasp.json.ejemplo."]); }
  if (!cj.scriptId || /PEGA_AQUI/.test(cj.scriptId)) alto(".clasp.json todavía no tiene el ID del proyecto.", ["Apps Script → ⚙ Configuración del proyecto → ID de la secuencia de comandos → cópialo y pégalo en .clasp.json."]);
  if (cj.rootDir !== "apps-script") alto('.clasp.json debe decir "rootDir": "apps-script".', ["Compáralo con .clasp.json.ejemplo."]);
  bien(".clasp.json");

  const rutaClasp = buscarClasp();
  if (!rutaClasp) alto("No encontré clasp.", ["Instálalo una vez:  npm install -g @google/clasp", "Luego:  clasp login   (con la cuenta dueña)"]);
  const verClasp = clasp(rutaClasp, ["--version"]);
  const mayor = Number((verClasp.salida.match(/(\d+)\.\d+\.\d+/) || [])[1] || 0);
  if (!verClasp.ok || mayor < 3) alto("clasp es muy viejo o no responde (" + (verClasp.salida.trim() || "sin respuesta") + ").", ["Actualízalo:  npm install -g @google/clasp@latest"]);
  if (!process.env.CG_CLASP && !existsSync(join(homedir(), ".clasprc.json"))) {
    alto("clasp no tiene sesión iniciada.", ["Corre:  clasp login", "Entra con la cuenta dueña de la hoja (la del área).", "Vuelve a correr npm run publicar."]);
  }
  bien("clasp " + verClasp.salida.trim());

  const cfg = leerConfig();
  if (!ID_VALIDO(cfg.deploymentId)) {
    aviso("Falta el ID de la implementación (se guarda una sola vez en .publicar.json).");
    console.log("\n  Estas son las implementaciones de tu proyecto:\n");
    const lista = clasp(rutaClasp, ["list-deployments"]);
    console.log(lista.salida.split(/\r?\n/).map((l) => "    " + l).join("\n"));
    console.log("\n  Copia el ID de la que publicaste como aplicación web (la que dice «Versión…»),");
    console.log("  NO el que dice @HEAD. Empieza con AKfyc.\n");
    const pegado = await preguntar("  Pega aquí el ID y presiona Enter: ");
    if (!pegado) {
      alto("No se publicó nada: falta el ID de la implementación.",
        ["Corre:  npm run servidor:implementaciones", "Copia el ID que NO dice @HEAD.", 'Crea el archivo .publicar.json con:  { "deploymentId": "AKfyc…" }', "Vuelve a correr npm run publicar."]);
    }
    if (!ID_VALIDO(pegado)) alto("Eso no parece un ID de implementación (debe empezar con AKfyc y no tener espacios).", ["Vuelve a correr el comando y pega solo el ID."]);
    cfg.deploymentId = pegado;
    guardarConfig(cfg);
    bien("ID guardado en .publicar.json (no se sube a GitHub)");
  } else {
    bien("Implementación " + cfg.deploymentId.slice(0, 12) + "…");
  }

  if (!git(["--version"]).ok) alto("No encontré git.", ["Instálalo desde git-scm.com y vuelve a abrir la terminal."]);
  if (!git(["rev-parse", "--is-inside-work-tree"]).ok) alto("Esta carpeta todavía no es un repositorio de git.", ["Sigue INSTALAR.md, Parte B1 (git init, remote, primer push)."]);
  if (!git(["remote", "get-url", "origin"]).ok) alto("El repositorio no tiene «origin» (la dirección de GitHub).", ["git remote add origin https://github.com/TU-USUARIO/control-gestion.git"]);
  revisarGit();
  bien("git listo y sin datos reales por subir");

  /* ── 1. Pruebas ── */
  titulo("1/6 · Pruebas");
  const pj = JSON.parse(leer("package.json"));
  const prueba = String((pj.scripts || {}).test || "");
  const partes = prueba.split(/\s+/).filter(Boolean);
  if (partes[0] !== "node") alto('El script "test" de package.json debe empezar con "node".', ['Debe ser algo como:  "test": "node --test pruebas/…"']);
  const rp = correr(process.execPath, partes.slice(1), { ver: true, env: { ...process.env, CG_PUBLICANDO: "1" } });
  if (!rp.ok) alto("Las pruebas fallaron. No se publicó nada.", ["Lee arriba cuál prueba dice «not ok» y por qué.", "Corrige y vuelve a correr npm run publicar."]);
  bien("Todas las pruebas pasaron");

  /* ── 2. Versiones ── */
  titulo("2/6 · Versiones");
  const v = versiones();
  if (!v.srv || !v.app) alto("No encontré VERSION en Servidor.gs o VERSION_APP en App.html.", ["Revisa que sigan escritas así:  var VERSION = '1.3.0';  y  var VERSION_APP = '1.3.0';"]);
  if (v.srv !== v.app) alto(`No coinciden: Servidor.gs dice ${v.srv} y App.html dice ${v.app}. No se publicó nada.`, ["Pon el mismo número en las dos (var VERSION y var VERSION_APP)."]);
  bien("Servidor y página: versión " + v.srv);

  // ¿Columnas nuevas? Se compara con lo último que se publicó con este comando
  // (o, la primera vez, con el último commit de git).
  const ahora = columnasDe(leer("apps-script/Servidor.gs"));
  let antes = cfg.columnas || null;
  if (!antes) {
    const h = git(["show", "HEAD:apps-script/Servidor.gs"]);
    if (h.ok) antes = columnasDe(h.salida);
  }
  const nuevas = [];
  if (ahora && antes) {
    Object.keys(ahora).forEach((hoja) => (ahora[hoja] || []).forEach((col) => { if (!(antes[hoja] || []).includes(col)) nuevas.push(hoja + "." + col); }));
  }

  /* ── 3. clasp push ── */
  titulo("3/6 · Subir el código a Apps Script (clasp push --force)");
  const rpush = clasp(rutaClasp, ["push", "--force"], { ver: true });
  if (!rpush.ok) {
    alto("clasp push falló. La app publicada sigue igual que antes.",
      ["Si dice que no tienes permiso o la sesión expiró:  clasp login  (con la cuenta dueña).",
        "Si habla de la API de Apps Script: actívala en https://script.google.com/home/usersettings",
        "Si dice que no encuentra el proyecto: revisa el ID en .clasp.json.",
        "Vuelve a correr npm run publicar."]);
  }
  bien("Código subido (todavía no lo ve nadie: falta el paso 4)");

  if (nuevas.length) {
    console.log("\n" + c("1;33", "  ⚠ Esta versión agrega columnas a la hoja: " + nuevas.join(", ")));
    console.log("    Antes de publicarla, corre instalar() UNA vez:");
    console.log("      a) Abre la hoja → Extensiones → Apps Script.");
    console.log("      b) A la izquierda abre Instalacion.gs; arriba elige «instalar» y presiona ▶ Ejecutar.");
    console.log("      c) Espera a que el registro diga «✔ Todo en orden».");
    if (!yaInstalar) {
      const r = await preguntar("\n    ¿Ya corriste instalar() y dijo «Todo en orden»? (s/n): ");
      if (!/^s/i.test(r || "")) {
        alto("Se detuvo antes de publicar: falta correr instalar().",
          ["Corre instalar() como dice arriba (la app que usa la gente sigue igual, no pasa nada).",
            "Después vuelve a correr:  npm run publicar -- \"" + mensaje.replace(/"/g, "'") + "\"",
            "(Si no hay quien conteste la pregunta, agrega --ya-corri-instalar al final.)"]);
      }
    }
    bien("instalar() confirmado");
  }

  /* ── 4. Nueva versión en la misma implementación ── */
  titulo("4/6 · Publicar la versión nueva (misma URL /exec)");
  const rdep = clasp(rutaClasp, ["update-deployment", cfg.deploymentId, "-d", mensaje], { ver: true });
  if (!rdep.ok) {
    alto("No se pudo publicar la implementación. La app sigue con la versión anterior.",
      ["Revisa el ID en .publicar.json:  npm run servidor:implementaciones  (usa el que NO dice @HEAD).",
        "Si la sesión expiró:  clasp login",
        "Vuelve a correr npm run publicar (el paso 3 se repite sin problema)."]);
  }
  if (ahora) { cfg.columnas = ahora; cfg.ultimaVersion = v.srv; cfg.ultimaPublicacion = new Date().toISOString(); guardarConfig(cfg); }
  bien("Servidor publicado: versión " + v.srv + " · «" + mensaje + "»");

  /* ── 5. Revisar git ── */
  titulo("5/6 · Revisar qué se va a subir a GitHub");
  const cambios = revisarGit();
  bien(cambios ? cambios + " archivo(s) por subir, ninguno con datos reales" : "No hay archivos nuevos o cambiados");

  /* ── 6. git ── */
  titulo("6/6 · Guardar en GitHub (Vercel publica la página solo)");
  // Solo la carpeta del proyecto (y ya revisada en el paso 5)
  if (!git(["add", "-A", "--", "."], { ver: true }).ok) alto("git add falló.", ["Lee el mensaje de arriba.", "Vuelve a correr npm run publicar."]);
  const hayAlgo = !git(["diff", "--cached", "--quiet"]).ok;
  if (hayAlgo) {
    if (!git(["commit", "-m", mensaje], { ver: true }).ok) {
      alto("git commit falló. El servidor YA quedó publicado; solo falta GitHub.",
        ["Si pide tu nombre y correo: git config --global user.name \"Tu Nombre\"  y  git config --global user.email tu@correo",
          'Después:  git commit -m "' + mensaje.replace(/"/g, "'") + '"  y  git push']);
    }
  } else {
    nota("No había cambios nuevos para commit; solo se sube lo pendiente.");
  }
  const rama = git(["rev-parse", "--abbrev-ref", "HEAD"]).salida.trim() || "main";
  const tieneRemota = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).ok;
  const rpush2 = git(tieneRemota ? ["push"] : ["push", "-u", "origin", rama], { ver: true });
  if (!rpush2.ok) {
    alto("git push falló. El servidor YA quedó publicado; solo falta subir a GitHub.",
      ["Si dice «rejected» o «fetch first»:  git pull   y luego  git push",
        "Si pide usuario o contraseña: entra con tu cuenta de GitHub (o tu token).",
        "La página en Vercel se actualiza cuando el push funcione."]);
  }
  bien("Subido a GitHub (" + rama + ")");

  console.log("\n" + c("1;32", "✔ Listo. Versión " + v.srv + " publicada."));
  console.log("  · Servidor (Apps Script): ya está en la misma URL /exec.");
  console.log("  · Página (Vercel): se actualiza sola en 1 o 2 minutos.");
  if (nuevas.length) console.log("  · Columnas nuevas: " + nuevas.join(", ") + " (instalar() confirmado).");
  console.log("");
}

main().catch((e) => alto("Algo inesperado falló: " + (e && e.message ? e.message : e), ["Copia este mensaje y pídele ayuda a quien le da mantenimiento al sistema."]));
