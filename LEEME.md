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
| Excel para entregar | **Exportación** (solo administradores): una libreta o todas, de una fecha a otra, con encabezado institucional, fechas reales, filtros y la fila de títulos fija. |

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

## Varios destinatarios (oficios salientes)

En **Nuevo oficio saliente** está el interruptor **«Varios destinatarios»**: se eligen
las personas del directorio (quedan como fichas, cada una con su ✕) y se escriben una
sola vez el asunto, la firma, la fecha y quién elaboró.

- Antes de guardar se ve la lista exacta: *«Se crearán 28 oficios: del
  SAPCI/STPI/417/2026 al SAPCI/STPI/444/2026»*, con el número que le toca a cada persona.
- Los números salen **seguidos** aunque otra persona esté guardando al mismo tiempo:
  el servidor los asigna todos dentro de un solo candado y los escribe de una vez.
- Si alguien registra un oficio mientras confirmas, el sistema **no guarda** y te
  muestra los números nuevos para que vuelvas a confirmar.
- Hasta **100** destinatarios por vez. Cada oficio queda en la Bitácora, más un resumen.
- Los escaneos y acuses se suben después, en cada oficio.

## Mis asuntos (turnar a personas del sistema)

En **Seguimiento** de cualquier registro hay dos campos:

- **Turnar a una persona del sistema**: solo aparecen usuarios **activos** que tienen
  acceso a esa libreta. Si el registro no tenía estatus, se pone «Pendiente».
- **Turnado a** (texto libre): para áreas o personas externas, como antes.

Quien recibe el turno lo ve en la tarjeta **«Mis asuntos»** del portal (por atender,
vencidos y lo que vence hoy) y en su pantalla, separado en *Vencidos*, *Vencen hoy*,
*Por atender* y *Atendidos*. En cada libreta hay además el filtro **«Turnados a mí»**.
Cada turno, cambio o retiro queda en la Bitácora y en el historial del registro.

Nadie ve asuntos de libretas que no tiene, aunque se los hayan turnado: si a alguien
le quitan una libreta, sus turnos de esa libreta dejan de aparecerle.

## Buscador general

Arriba de las tarjetas del portal hay una caja **«Buscar en todas mis libretas»**: busca
a la vez en número, número oficial, asunto, personas (dirigido a, firma o remitente),
observaciones, turnado a, área, elaboró y carpeta, **en todos los años**. No importan
acentos ni mayúsculas. Muestra hasta 50 resultados (los más recientes), agrupados por
libreta; cada uno abre su detalle. Si hay más, «Ver en la libreta» abre la libreta con
la búsqueda ya escrita. Solo busca en las libretas que tiene cada quien.

## Duplicar

En el detalle de un registro, **«Duplicar»** abre el formulario de alta con los mismos
datos (asunto, personas, área, elaboró, carpeta, observaciones, turnado a). **No** copia:
número, archivos, estatus, cancelación, historial, acuse, relación ni fechas (el nuevo
lleva las suyas). En la Bitácora queda «(copia de 145/2026)».

## Fotos con la cámara del celular

En **Documento** y **Acuse** (en el detalle y al dar de alta) hay, además de «Subir», un
botón **«Tomar foto»** que abre la cámara trasera del celular (en computadora abre el
selector de imágenes). La foto se reduce **en el teléfono** antes de subirla: lado mayor
de 2000 px y JPEG al 80 % (una foto de 8 MB queda en ~0.5 MB). Si alguien sube una
imagen de más de 10 MB con «Subir», también se reduce en vez de rechazarse.

No hizo falta cambiar `vercel.json`: «Tomar foto» usa el selector de archivos del
teléfono (`capture`), no la cámara del navegador, así que `Permissions-Policy: camera=()`
y la CSP siguen igual de estrictas.

## Modo mantenimiento

En **Configuración → Modo mantenimiento** el administrador lo prende con un mensaje.
Mientras está prendido:

- Solo los administradores pueden entrar y trabajar.
- La pantalla de entrada muestra el mensaje a todos.
- A quien ya estaba dentro, la página lo saca con el aviso: en cuanto hace algo, o
  sola en unos minutos (la página pregunta cada 5 min y al volver a la pestaña; esa
  pregunta **no** alarga la sesión).
- Prenderlo, apagarlo o cambiar el mensaje queda en la Bitácora.

## Cambiar varios a la vez

En cada libreta, **«Seleccionar»** pone una casilla en cada renglón (y una arriba para
todos los que se ven). Con los elegidos, la barra de arriba deja cambiar de una vez:
**Estatus**, **Acuse** (u «Original» en entrantes), **Turnar** a una persona del sistema
o **Fecha límite**. Sirve, por ejemplo, para marcar con acuse los 40 oficios que
regresaron firmados.

- Hasta **500** por vez. Antes de guardar dice cuántos va a cambiar.
- Los cancelados no se pueden elegir; para cancelar hay que escribir el motivo de cada
  uno, desde su detalle.
- El servidor revisa cada registro (libreta, permiso, que no esté cancelado): los que no
  puede tocar los salta y dice cuáles y por qué. Los que ya tenían ese valor no se tocan.
- Cada cambio queda en la Bitácora y en el historial del registro, igual que si se
  hiciera uno por uno.

## Ver los escaneos sin descargarlos

**«Abrir»** en Documento o Acuse ya no descarga el archivo: lo muestra en una ventana
encima del registro, con **«Descargar»** y, en los PDF, **«Abrir en otra pestaña»**.
Las imágenes se ven en cualquier equipo; los PDF se ven dentro de la ventana en
computadora (en Vercel). En el celular, el visor de PDF no funciona dentro de una página,
así que ahí se abren en otra pestaña o se descargan. Cada vez que se abre un escaneo
queda en la Bitácora, como antes.

## Borrador del oficio en Word

Para no escribir otra vez lo que ya se capturó: en **Configuración → Borrador del oficio
en Word** se pone el enlace de un documento de Google Docs con el formato del oficio, y
donde va cada dato se escribe un marcador:

| Marcador | Sale |
|---|---|
| `{{NUMERO}}` | SAPCI/STPI/417/2026 |
| `{{FECHA_LARGA}}` / `{{FECHA}}` | 21 de octubre de 2026 / 21/10/2026 |
| `{{DESTINATARIO}}`, `{{CARGO_DESTINATARIO}}` | la persona y su cargo (del directorio) |
| `{{ASUNTO}}`, `{{OBSERVACIONES}}`, `{{CARPETA}}` | lo capturado |
| `{{FIRMA}}`, `{{CARGO_FIRMA}}`, `{{ELABORO}}` | quién firma, su cargo y quién elaboró |
| `{{CONSECUTIVO}}`, `{{ANIO}}` | 417, 2026 |

En cada oficio saliente aparece **«Borrador en Word»**: descarga un .docx con los datos
puestos, para terminarlo y firmarlo como siempre. La copia de trabajo se borra sola.
Por seguridad, la plantilla tiene que estar en la carpeta **«Control de Gestión ·
Plantillas (NO COMPARTIR)»** que crea `instalar()`: así nadie puede usar el botón para
leer otro documento de la cuenta dueña.

## Días inhábiles y «sin acuse» desde

En **Configuración**:

- **Días inhábiles**: las fechas que no cuentan (además de sábados y domingos) para la
  fecha límite que se propone, para «vence pronto» y para el tiempo de respuesta de
  Informes. Los botones **«Agregar los de ley de 2026»** y **«De 2027»** ponen los días
  de descanso obligatorio de la Ley Federal del Trabajo más jueves y viernes santo; hay
  que revisarlos contra el acuerdo de días inhábiles que publica la Gaceta Oficial de la
  CDMX cada año (vacaciones, días adicionales) y agregar o quitar lo que haga falta.
- **«Sin acuse» cuenta desde**: con una fecha (por ejemplo, el día en que empezaron a
  usar el sistema), el aviso de «sin acuse» del portal y de la libreta solo cuenta lo de
  esa fecha en adelante. Lo migrado del Excel que nunca tuvo acuse deja de inflar el
  número. El indicador lleva un `*` y su explicación al pasar el mouse.
- **Plazo de respuesta**: si está vacío, el portal le recuerda al administrador que lo
  ponga (sin plazo no hay fecha límite y «Vencidos» siempre dice 0).

## Avisos por correo

Se prenden en **Configuración → Avisos por correo** (vienen apagados):

- **Al turnar** un asunto a alguien (uno por uno, con varios destinatarios o en lote),
  le llega un correo con el número, la libreta, la fecha límite y el enlace a la app.
- **Todos los días hábiles a las 8 am**, a cada quien con correo, un resumen de lo suyo
  vencido, lo que vence hoy y lo que vence en los próximos dos días hábiles; a los
  administradores, además, cuántos asuntos vencidos no están turnados a nadie del
  sistema. Si no hay nada, no se manda.
- El correo de cada quien lo pone el administrador en **Usuarios → Editar** o la propia
  persona en **Mi cuenta**. Sin correo, no recibe nada.
- **«Incluir el asunto»** viene apagado: sin él, el correo no lleva datos del oficio,
  solo el número. Es lo más seguro si los correos van a cuentas personales.
- Salen de la cuenta dueña con `MailApp` (unos 100 al día en una cuenta gratuita; el
  sistema manda uno por persona y deja de mandar si se acaba la cuota).
- Si alguien que no es administrador consulta muchísimo en un día (300 registros
  abiertos, 300 búsquedas, 100 escaneos o 12 listas de años anteriores), queda una
  alerta en la Bitácora y les llega un correo a los administradores.

## Verificación en dos pasos y «Mi cuenta»

Arriba en el portal, **«Mi cuenta»**: cambiar la contraseña, activar o quitar la
verificación en dos pasos, poner el correo para avisos y olvidar este equipo.

- **Dos pasos**: después de la contraseña se pide el código de 6 dígitos de una app de
  autenticación (Google Authenticator, Microsoft Authenticator…). Para activarla se
  escanea un código QR (se dibuja en la página, sin servicios externos) o se escribe la
  clave, y se confirma con un código y la contraseña. La clave secreta se guarda
  cifrada en la hoja.
- En **Configuración → Verificación en dos pasos** se puede hacer **obligatoria para
  administradores**: quien no la tenga solo puede activarla antes de seguir.
- Si alguien pierde el teléfono: **Usuarios → Editar → «Quitar su verificación en dos
  pasos»**, y la vuelve a activar al entrar.
- **Equipo de confianza**: al entrar con «Recordar mi usuario en este equipo», ese
  navegador queda como de confianza por 180 días. Si alguien intenta adivinar tu
  contraseña y bloquea tu cuenta, desde tu equipo sí puedes entrar (con tu contraseña,
  claro). Si en ese equipo se equivocan muchas veces, deja de contar.

## Si la sesión se termina con algo abierto

Si la sesión se vence (3 horas sin uso, o cambiaron tus permisos) mientras tienes un
formulario o una ventana a medias, ya no se pierde lo escrito: aparece **«Tu sesión
terminó»** encima, se escribe la contraseña (y el código, si tienes dos pasos) y lo que
ibas a guardar se guarda solo. «Salir sin guardar» sí descarta todo.

## Volante de recepción (imprimible)

En el detalle de todo lo que se **recibe** (entrantes, conocimiento, circulares,
tarjetas y volantes) está **«Imprimir volante»**: una hoja **media carta** (14 × 21.6 cm)
con el encabezado institucional y el logo, número de control y número del oficio,
fecha y hora de recepción, remitente, dirigido a, asunto, turnado a, fecha límite,
quién recibió y observaciones, y espacios para **firma** y **sello**. Primero se ve una
vista previa y luego «Imprimir» abre el cuadro de impresión del navegador.

- La hora sale sola si el registro se capturó en el sistema el mismo día que se
  recibió; si no, queda la raya para escribirla a mano (igual con lo que falte).
- Funciona dentro de Google y en Vercel; en la impresora conviene «Tamaño real» o
  «100 %». No necesita el servidor nuevo: se arma en la página.

## Informes

Tarjeta y pantalla **«Informes»** para los administradores y para quien el
administrador marque en **Usuarios → Editar → «Puede ver Informes»** (columna nueva
`informes` en la pestaña *Usuarios*). Cada quien ve solo sus libretas.

- **Filtros** arriba: periodo (este año, últimos 12 meses, este mes, año pasado u otro)
  y libretas.
- **Indicadores**: registros del periodo, respondidos con oficio, tiempo promedio de
  respuesta y porcentaje atendido a tiempo.
- **Registros por mes** (todas las libretas elegidas) y **una gráfica chica por
  libreta**, cada una con su color y su escala. Al pasar el mouse o tocar una columna
  aparece el detalle; debajo hay «Ver los datos en tabla».
- **Principales remitentes** (lo que se recibe) y **destinatarios** (oficios salientes),
  los 10 primeros; las personas del directorio se cuentan por ficha, aunque se hayan
  escrito distinto.
- **Tiempo de respuesta**: del día en que se recibió algo al oficio saliente que lo
  contestó con «Responder con oficio», en **días hábiles** (lunes a viernes, sin los
  días inhábiles de Configuración). Promedio, mediana, el más tardado y cuántos en cada rango.
- **Atendido a tiempo**: de los asuntos cuya fecha límite cae en el periodo, cuántos
  pasaron a «Atendido» o «Concluido» a más tardar ese día, cuántos fuera de plazo y
  cuántos siguen abiertos con la fecha vencida. Los que aún están en plazo no cuentan.
- **Excel** con Resumen, Por mes, Remitentes, Destinatarios, Tiempo de respuesta (cada
  caso) y A tiempo (cada asunto, con de dónde salió su fecha). Queda en la Bitácora.
- No cuenta registros cancelados. La fecha de cada registro es la de recepción (o la
  del documento si no tiene).

**¿De dónde sale la fecha de atención?** Desde la 1.5.0 hay una columna nueva al final
de *Registros*, `fecha_atencion`, que el servidor llena solo el día en que un registro
**pasa** a Atendido o Concluido (y la borra si se reabre). Se eligió una columna y no
solo la Bitácora porque es exacta, rápida y no depende de leer miles de movimientos.
Para lo que se atendió **antes** de esta versión se usa, en este orden: el último cambio
a Atendido/Concluido que quedó en la Bitácora; si no hay, la fecha del oficio que lo
respondió; si nació ya atendido en la app, el día en que se capturó. Si no hay ninguno,
se reporta aparte como «sin fecha de atención» y no entra al porcentaje.

Las gráficas son SVG hechas a mano (sin librerías) y se dibujan al ancho real de la
pantalla, así que se leen igual en el celular. Los colores de estado (verde, ámbar,
rojo) se revisaron para que se distingan con daltonismo y siempre llevan ícono,
nombre y número.

## Respaldo descargable

En **Configuración → Respaldo completo**, el administrador descarga un Excel con una hoja
por pestaña: Registros, Directorio, Usuarios (**sin** contraseñas ni sellos de sesión),
Bitácora y Configuración. Tampoco lleva los IDs internos de Drive (los escaneos están en
la carpeta «Archivos»). Queda en la Bitácora.

Es adicional a lo automático (ver «Respaldos automáticos» en Seguridad): una copia de la
hoja **cada día** y la copia de cada escaneo en «Respaldos/Archivos (espejo)».

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
| Abrir escaneos | ✔ | ✔ | ✔ |
| Exportación a Excel (todas o una libreta, de fecha a fecha) | ✔ | — | — |
| Registrar y editar | ✔ | ✔ | — |
| Varios destinatarios y turnar a una persona del sistema | ✔ | ✔ | — |
| Ver «Mis asuntos» (lo que le turnaron) | ✔ | ✔ | ✔ |
| Buscador general (en sus libretas) | ✔ | ✔ | ✔ |
| Duplicar un registro, tomar foto con el celular | ✔ | ✔ | — |
| Cambiar varios a la vez, borrador del oficio en Word | ✔ | ✔ | — |
| Mi cuenta: contraseña, dos pasos, correo para avisos | ✔ | ✔ | ✔ |
| Modo mantenimiento, respaldo completo en Excel | ✔ | — | — |
| Imprimir volante de recepción | ✔ | ✔ | ✔ |
| Informes (gráficas y Excel de sus libretas) | ✔ | si se le da permiso | si se le da permiso |
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
- Solo muestra dentro de la página los escaneos que ella misma trajo (`blob:`), nunca
  otra página.
- No se puede meter dentro de otra página (contra engaños de "clic aquí").
- No manda la dirección de origen a otros sitios.

**Lo que el sistema cuida:**

- **Nadie entra sin usuario y contraseña**, y si se activa, sin el **código de dos
  pasos**. Las contraseñas se guardan cifradas (PBKDF2-SHA256 con sal y una «pimienta»
  que no está en la hoja, sino en las propiedades del proyecto: quien copie la hoja no
  puede probar contraseñas). Las vueltas del cifrado se ajustan solas a lo que aguanta
  Google y las contraseñas se vuelven a cifrar al entrar.
- **Contraseñas**: 10 caracteres o más, con letras y números, sin el usuario ni el nombre,
  y nada fácil de adivinar («Gestion2026», «CDMX», meses, «qwerty»…). A quien tenga una
  que ya no cumple, se le pide cambiarla al entrar.
- **Intentos fallidos**: cinco seguidos bloquean la cuenta 15 minutos; si se repite, 1 hora
  y luego 4 horas. Además, si todo el sistema junta 30 fallas en un minuto, se frena la
  entrada un momento (los intentos buenos no cuentan). Desde un **equipo de confianza**
  el dueño de la cuenta sí puede entrar aunque esté bloqueada.
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
  en la papelera de Drive, y si ya había pasado un respaldo diario, su copia sigue en
  el espejo.
- **Respaldos automáticos**: cada día a las 6 am, una **copia de la hoja** en «Respaldos»
  (las 14 más recientes y una por semana de las 12 semanas anteriores) y la copia de los
  **escaneos nuevos** en «Respaldos/Archivos (espejo)». Si el dueño pone una carpeta de
  **otra cuenta** en `respaldo_externo` (INSTALAR.md), todo se copia también ahí: así un
  problema con la cuenta dueña no se lleva los respaldos. `revisarRespaldos()` abre la
  copia más reciente y revisa que esté completa (la «prueba de restauración»).
- **Consultas inusuales**: si alguien abre, busca o descarga muchísimo en un día, queda
  una alerta en la Bitácora y se avisa por correo a los administradores.
- **Bitácora**: quién entró, quién capturó, editó (con el antes y el después),
  descargó, exportó o cambió permisos. Desde la app no se puede borrar.

**Lo que depende de ustedes:**

- **La cuenta dueña es la llave maestra.** Quien entre a esa cuenta ve todo. Usa una
  cuenta del área con verificación en dos pasos, y que la conozcan pocas personas.
- **Los administradores, con dos pasos.** Actívenla en «Mi cuenta» y luego háganla
  obligatoria en Configuración.
- **No compartas la hoja ni las carpetas** "para que alguien la vea": dale un usuario de Consulta.
- Quien pueda **editar el proyecto de Apps Script** puede leer todo. No agregues editores.
- La URL de la app es pública (es la pantalla de entrada). Lo que protege es la
  contraseña de cada quien: que no se compartan cuentas.
- Lo que alguien descarga (Excel, escaneos) ya sale del sistema. La bitácora dice
  quién y cuándo, pero no lo puede impedir.
- Los oficios traen datos personales. Trátenlo como cualquier archivo oficial.

## Límites (sobran para este volumen)

- Unos **750 registros al año**. Google Sheets admite 10 millones de celdas; cada
  registro usa 35. Hay espacio para décadas.
- Escaneos: hasta **10 MB** cada uno. El Drive gratuito tiene 15 GB, compartidos con
  el Gmail de esa cuenta: unos 40,000 escaneos de 300 KB.
- Apps Script: cada llamada al servidor tarda de 1 a 2 segundos y la primera del día,
  unos segundos más. Por eso la app evita esperas (ver «Velocidad»). Aguanta a todo
  el equipo trabajando al mismo tiempo.

## Velocidad

Cada vuelta a Google tarda de 1 a 2 segundos y eso no se puede cambiar, así que la
app hace las menos vueltas posibles y no hace esperar cuando ya tiene los datos:

- **Al entrar**, la misma respuesta trae el portal. Mientras la persona ve el portal,
  se traen en segundo plano las listas del año de sus libretas, Pendientes y (si le
  turnaron algo) Mis asuntos. Al abrirlas ya se ven; si alguien más capturó algo,
  aparece un segundo después.
- **Al abrir un oficio**, el panel sale al instante con lo que ya se ve en la lista;
  archivos e historial llegan después. Editar, Duplicar e Imprimir se activan al llegar todo.
- **Al guardar**, cancelar o subir un archivo, la respuesta ya trae el panel completo
  y la lista se actualiza sin pedirla otra vez.
- **En el servidor**, la hoja se abre una sola vez por llamada y el historial de un
  oficio busca solo sus renglones en la bitácora (no la lee completa, que crece todos
  los días).
- Lo que se guarda en memoria es **solo de esa pestaña** y se borra al salir o al
  cambiar de usuario. Nada se guarda en el disco del equipo.

Con un retraso simulado de 1.5 s por llamada (`CG_RETRASO_MS=1500 npm run local`):

| Paso | 1.5.0 | 1.6.0 |
|---|---|---|
| Entrar hasta ver el portal | 3.4 s | 1.9 s |
| Abrir una libreta | 1.9 s | 0.1 s |
| Abrir un oficio | 2.0 s | 0.1 s (completo en 1.9 s) |
| Guardar cambios y ver el oficio | 3.6 s | 2.2 s |
| Abrir Pendientes | 1.9 s | 0.2 s |
| Volver a una libreta | 1.9 s | 0.2 s |
| Recargar la página con la sesión abierta | 3.4 s | 2.1 s |

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
  Servidor.gs       api(): permisos, registros, archivos, directorio, usuarios, caché, candado
  Seguridad.gs      entrar, contraseñas, bloqueos, equipo de confianza, dos pasos, consultas inusuales
  Avisos.gs         correos de turno y resumen diario (avisosDiarios)
  Respaldos.gs      respaldoDiario(), espejo de escaneos, carpeta externa, revisarRespaldos()
  Plantillas.gs     borrador del oficio en Word a partir de Google Docs
  Instalacion.gs    instalar(), restablecerAdministrador(), revisarSeguridad()
  Index.html        cuerpo de la página (Google quita los comentarios HTML: no usarlos como marcadores)
  Estilos.html      identidad CDMX (morado, guinda, dorado; Cabin y Roboto)
  App.html          núcleo de la página: utilidades, llamar(), ventanas, avisos
  App*.html         el resto, por pantallas: AppEntrada, AppQR, AppPortal, AppLibreta,
                    AppDetalle, AppFormulario, AppInformes, AppAdmin, AppArranque
  Excel.html        genera el .xlsx en el navegador (sin librerías externas)
  appsscript.json   zona horaria y configuración de la app web
base/             La base inicial (Excel) y el resumen de la migración  (NO va a GitHub)
herramientas/     migrar_minutario.py · armar-web.mjs (arma dist/ para Vercel)
                  publicar.mjs (npm run publicar: pruebas, clasp, implementación y git)
                  empaquetar.mjs (npm run empaquetar: .zip sin datos para compartir)
vercel.json       Cómo publica Vercel y los encabezados de seguridad
.github/          Las pruebas corren solas en GitHub en cada push
.clasp.json.ejemplo  Para subir el servidor con clasp (ver INSTALAR.md, Parte C)
pruebas/          Simulador de Apps Script en Node + pruebas + recorrido en navegador
capturas/         Pantallas de la prueba en navegador  (NO va a GitHub)
```

**Las partes de la página (`App*.html`)** se juntan en un solo programa: `doGet` las
pega en el orden de `FRAGMENTOS_APP` (Servidor.gs) dentro de una sola función, y
`armar-web.mjs` hace lo mismo para Vercel con la misma lista. Comparten variables
como si fueran un solo archivo. Para agregar una parte nueva, créala y ponla en
`FRAGMENTOS_APP`.

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
   de migración, y corre `instalar()` para que la agregue a la hoja. (Si se olvida,
   `tabla_()` agrega sola los encabezados que falten al final y lo anota en la
   Bitácora, para que la app no se detenga; pero `instalar()` sigue siendo el paso
   oficial.) `npm run publicar` avisa cuando una versión trae columnas nuevas.
5. Lo nuevo de la página revisa con `tiene('accion')` que el servidor publicado ya
   tenga esa acción (`inicio` devuelve la lista). Así, si la página se actualiza antes
   que el servidor, lo nuevo no aparece en vez de tronar.
6. Al editar, un campo nuevo que una página vieja no manda (`undefined`) se conserva:
   nunca se borra un dato porque la página no lo conocía.
7. Toda escritura a la hoja va **dentro del candado** (`enCandado_`), incluida la
   Bitácora; lo lento (crear o mandar a la papelera un archivo de Drive, mandar
   correos) va **fuera**. Al soltar el candado se avisa a la caché que hubo cambios.
8. Apps Script carga los `.gs` en el orden del proyecto, que no conviene dar por
   hecho: el código suelto (fuera de una función) no puede usar funciones de otro
   archivo (las pruebas cargan los archivos en los dos órdenes). En `ACCIONES_`, las de otros
   archivos van envueltas: `fn: function (yo, d) { return cambiarClave_(yo, d); }`.
9. Las funciones que corre un disparador (`respaldoDiario`, `avisosDiarios`) son
   públicas: revisan que las llame su disparador o el dueño, y que no se repitan el
   mismo día.

**Pruebas** (necesitas Node 20 o más; Python 3 con openpyxl para la del Excel y con
opencv-python-headless para la del código QR; sin ellos esas pruebas se saltan):

```bash
npm test               # 108 pruebas: seguridad, dos pasos, contraseñas, candado y caché, permisos, consecutivos, lote, avisos, respaldos, plantilla, informes, QR, publicar, empaquetar, Excel…
npm run e2e            # recorrido en Chromium de lo nuevo (Vercel con su CSP y Apps Script); capturas en capturas/1.7.0/
npm run empaquetar     # .zip del código sin base/, capturas/ ni credenciales, junto a la carpeta del proyecto
npm run local          # la app en http://localhost:4321 con la base migrada
                       #   CG_RETRASO_MS=1500 → cada llamada tarda como en Google
                       #   CG_SIMULAR_150=1   → servidor sin lo nuevo (la página debe seguir funcionando)
npm run web            # arma dist/ (necesita CG_API_URL)
npm run publicar -- "mensaje"   # publica servidor y página (INSTALAR.md, Parte C)
```

El simulador (`pruebas/simulador.cjs`) imita Sheets, Drive, caché, candado y
criptografía de Apps Script, y se porta "pesimista" donde importa: convierte en
fórmula lo que empieza con `=`, cambia "001" por 1 si la celda no es de texto,
truena si se escribe fuera de la hoja y si algo se guarda en la caché por más de 6 h. Así salieron dos errores reales antes de
llegar a Google: una hoja nueva solo trae 26 columnas, y la base necesita 33.
