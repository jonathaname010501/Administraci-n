# Control de Gestión

Sistema para registrar los oficios que salen y que llegan a la Subsecretaría,
en lugar del Excel "Minutario" capturado a mano.

- **Servidor y datos en Google:** Apps Script hace de servidor. La base es una hoja
  de Google Sheets y los escaneos van a una carpeta privada de Drive.
- **Página en Vercel:** la gente entra por una dirección propia con usuario y
  contraseña. Vercel solo sirve la página; los datos nunca pasan por ahí ni se
  guardan ahí. La misma app también funciona directo desde la URL de Google.

Para instalarlo: **[INSTALAR.md](INSTALAR.md)**.

## Qué resuelve del Excel anterior

| En el Excel | En el sistema |
|---|---|
| Consecutivo a mano: "001" y "0411", números apartados vacíos, repetidos | Se asigna solo al guardar, sin huecos ni repetidos, aunque dos personas guarden al mismo tiempo. El número oficial `SAPCI/STPI/417/2026` también sale solo. |
| La misma persona escrita de muchas formas (205 textos para ~127 personas en "Dirigido a") | **Directorio**: se elige a la persona de una lista. Si no está, se agrega una vez (avisa si ya hay alguien con nombre parecido). |
| "Valentina J", "VALENTINA J", "valentina"… | Lista de sugerencias para que se escriba igual siempre. |
| Fechas como texto (`18/0672026`, `SIN DATO`) | Calendario; no acepta fechas imposibles. |
| Palomita "ü" en Wingdings para el acuse | Casilla, y se puede **subir el acuse escaneado** (al subirlo se marca solo). |
| Seguimiento escrito en Observaciones ("SE RECIBE RESPUESTA…") | Estatus (Pendiente, En trámite, Atendido, Concluido), **fecha límite** con aviso de vencido, "turnado a", y **Responder con oficio** que liga el entrante con el saliente y lo marca como Atendido. |
| Seis hojas con columnas en distinto orden | Un solo formato por libreta, con las mismas columnas que ya usaban. |
| Cualquiera puede borrar o mover filas | Nada se borra: se **cancela** con motivo y el número no se reutiliza. Todo queda en la **Bitácora**. |
| Se comparte el archivo completo | La hoja no se comparte: cada quien ve **solo sus libretas** según su rol. |
| Excel para entregar | Botón **Excel** (una libreta o todas) con encabezado institucional, fechas reales, filtros y la fila de títulos fija. |

## Cómo se ve

Igual que Gabinetes:

- **Al entrar hay un portal** con saludo y tarjetas de color. Cada tarjeta muestra
  sus números del año, lo que está por atender, lo vencido y los oficios sin acuse.
- **Cada libreta abre su propia pantalla** con "← Inicio", su color y sus indicadores.
  Al tocar un indicador ("Por atender", "Vencidos", "Sin acuse", "De este mes") se
  filtra la lista.
- **Pendientes, Directorio y Administración** (Usuarios, Bitácora, Configuración)
  también tienen su tarjeta y su pantalla.
- **En Vercel funciona el botón Atrás** del navegador, y cada pantalla tiene su
  dirección (por ejemplo `#/oficios-entrantes`).

## Las libretas

Las mismas seis hojas del minutario, con sus columnas:

- **Oficios salientes** (antes "OFICIOS"): número automático `SAPCI/STPI/NNN/AAAA`.
- **Oficios entrantes**
- **Oficios de conocimiento**
- **Circulares**
- **Tarjetas informativas**
- **Volantes de turno**

Además, todas tienen **Seguimiento** (estatus, fecha límite, turnado a, relacionado
con) y **Archivos** (documento escaneado y acuse: PDF, JPG o PNG hasta 10 MB).

## Roles

| | Administrador | Captura | Consulta |
|---|:-:|:-:|:-:|
| Ver y buscar en sus libretas | ✔ | ✔ | ✔ |
| Abrir escaneos y descargar Excel | ✔ | ✔ | ✔ |
| Registrar y editar | ✔ | ✔ | — |
| Subir o quitar escaneos | ✔ | ✔ | — |
| Agregar personas al directorio | ✔ | ✔ | — |
| Cancelar un registro | ✔ | — | — |
| Unir fichas duplicadas del directorio | ✔ | — | — |
| Usuarios, Bitácora, Configuración | ✔ | — | — |

Captura y Consulta solo ven las libretas que el administrador les marque.

## Seguridad: qué protege y qué no

**Dónde están los datos:** en el Drive de la cuenta dueña, y en ningún otro lado.
Son una hoja de cálculo y dos carpetas ("Archivos" y "Respaldos"). Vercel solo sirve
los archivos de la página. GitHub solo tiene el código: `.gitignore` deja fuera la
base y las capturas. La app no carga código de terceros; lo único externo son las
tipografías de Google Fonts.

**La página en Vercel** se publica con una política de seguridad estricta (CSP en
`vercel.json`):

- Solo ejecuta los archivos propios y solo puede hablar con Apps Script.
- No se puede meter dentro de otra página (contra engaños de "clic aquí").
- No manda la dirección de origen a otros sitios.

**Lo que el sistema cuida:**

- **Nadie entra sin usuario y contraseña.** Las contraseñas se guardan cifradas con
  PBKDF2-SHA256 y sal, nunca en claro. Cinco intentos fallidos bloquean la cuenta 15 minutos.
- **La sesión se cierra sola** a las 3 horas sin uso, y también al cambiar la
  contraseña o los permisos. Si desactivas a alguien, pierde el acceso al instante.
- **Cada petición se revisa en el servidor**: rol, libreta y sesión. Lo que se ve en
  pantalla no decide nada; aunque alguien manipule el navegador, el servidor no le
  da lo que no le toca.
- **La hoja y las carpetas no se comparten.** La app corre con la cuenta dueña y
  entrega a cada quien solo lo suyo. `revisarSeguridad()` avisa si alguien las compartió.
- **Texto peligroso no se ejecuta**: un asunto que empiece con `=` no se convierte en
  fórmula en la hoja, y un texto con `<script>` se ve como texto en la app.
- **Archivos**: solo PDF, JPG y PNG, y se revisa el contenido real del archivo,
  no nada más la extensión.
- **Dos personas editando lo mismo**: si alguien guardó antes, el segundo recibe un
  aviso en vez de borrarle los cambios al primero.
- **Nada se borra**: se cancela con motivo. Los escaneos que se quitan quedan 30 días
  en la papelera de Drive. Cada lunes se hace una **copia de la base** (se guardan las 8 últimas).
- **Bitácora**: quién entró, quién capturó, editó (con el antes y el después),
  descargó, exportó o cambió permisos. Desde la app no se puede borrar.

**Lo que depende de ustedes:**

- **La cuenta dueña es la llave maestra.** Quien entre a esa cuenta ve todo. Usa una
  cuenta del área con verificación en dos pasos, y que la conozcan pocas personas.
- **No compartas la hoja ni las carpetas** "para que alguien la vea": dale un usuario de Consulta.
- Quien pueda **editar el proyecto de Apps Script** puede leer todo. No agregues editores.
- La URL de la app es pública (es la pantalla de entrada). Lo que protege es la
  contraseña de cada quien: que no se compartan cuentas.
- Lo que alguien descarga (Excel, escaneos) ya sale del sistema. La bitácora dice
  quién y cuándo, pero no lo puede impedir.
- Los oficios traen datos personales. Trátenlo como cualquier archivo oficial.

## Límites (sobran para este volumen)

- Unos **750 registros al año**. Google Sheets admite 10 millones de celdas; cada
  registro usa 33. Hay espacio para décadas.
- Escaneos: hasta **10 MB** cada uno. El Drive gratuito tiene 15 GB, compartidos con
  el Gmail de esa cuenta: unos 40,000 escaneos de 300 KB.
- Apps Script: cada acción tarda de 1 a 2 segundos y la primera carga del día, unos
  segundos más. Aguanta a todo el equipo trabajando al mismo tiempo.

## Qué se migró del Minutario 2026

- **732 registros reales**: 416 oficios salientes, 146 entrantes, 43 de conocimiento,
  77 circulares, 34 tarjetas y 16 volantes.
- Se descartaron **789 filas de relleno** de "Oficio de conocimiento" (consecutivos
  5045 a 5832, que solo decían "En atención al oficio" / "S.A.L").
- **359 formas distintas de escribir nombres** quedaron en **143 fichas** del directorio.
- **51 entrantes** quedaron ligados al oficio saliente que contestan (cuando el texto
  decía "en atención al oficio SAPCI/STPI/006/2026").
- Los números 411 a 415 (apartados sin datos) y los "FALTA ACUSE" quedaron como
  **Pendiente**, para completarlos.
- Todo lo que se corrigió o juntó está en la pestaña **"Revisar migración"**.
- El script que lo hizo está en `herramientas/migrar_minutario.py`. Sirve para repetir
  la migración si les pasan otra versión del Excel.

## Para quien le dé mantenimiento

```
apps-script/      El código de la app (lo que va al editor de Apps Script)
  Servidor.gs       api(): sesión, permisos, registros, archivos, directorio, usuarios
  Instalacion.gs    instalar(), restablecerAdministrador(), revisarSeguridad(), respaldoSemanal()
  Index.html        cuerpo de la página (Google quita los comentarios HTML: no usarlos como marcadores)
  Estilos.html      identidad CDMX (morado, guinda, dorado; Cabin y Roboto)
  App.html          la aplicación (sin librerías externas)
  Excel.html        genera el .xlsx en el navegador (sin librerías externas)
  appsscript.json   zona horaria y configuración de la app web
base/             La base inicial (Excel) y el resumen de la migración  (NO va a GitHub)
herramientas/     migrar_minutario.py · armar-web.mjs (arma dist/ para Vercel)
vercel.json       Cómo publica Vercel y los encabezados de seguridad
.clasp.json.ejemplo  Para subir el servidor con clasp (ver INSTALAR.md, Parte C)
pruebas/          Simulador de Apps Script en Node + pruebas
capturas/         Pantallas de la prueba en navegador  (NO va a GitHub)
```

La página de Vercel se arma con los **mismos** archivos de `apps-script/`, así que
hay una sola copia de la app. Para hablar con el servidor, `llamar()` usa
`google.script.run` cuando corre dentro de Google y `fetch` a la URL `/exec` cuando
corre en Vercel (`doPost` en Servidor.gs). Las dos rutas pasan por la misma `api()`.

**Reglas para no abrir huecos de seguridad al modificar:**

1. Toda función del servidor que no deba llamarse desde el navegador **termina en
   guion bajo** (`tabla_`, `hashClave_`…). Apps Script no deja que el navegador llame
   esas. Hay una prueba que falla si aparece una función pública nueva.
2. Todo lo que lee o escribe datos pasa por `api()`, y cada acción declara el rol
   mínimo en `ACCIONES_`.
3. En `App.html`, la interfaz se arma con `h()`, que pone el texto como texto. No
   uses `innerHTML` con datos.
4. Si agregas una columna, agrégala **al final** en `COLS` (Servidor.gs) y en el script
   de migración, y corre `instalar()` para que la agregue a la hoja.

**Pruebas** (necesitas Node 20 o más; Python 3 con openpyxl para la del Excel):

```bash
npm test               # 34 pruebas: seguridad, permisos, consecutivos, archivos, Excel, armado web…
npm run local          # la app en http://localhost:4321 con la base migrada
npm run web            # arma dist/ (necesita CG_API_URL)
```

El simulador (`pruebas/simulador.cjs`) imita Sheets, Drive, caché, candado y
criptografía de Apps Script, y se porta "pesimista" donde importa: convierte en
fórmula lo que empieza con `=`, cambia "001" por 1 si la celda no es de texto, y
truena si se escribe fuera de la hoja. Así salieron dos errores reales antes de
llegar a Google: una hoja nueva solo trae 26 columnas, y la base necesita 33.
