# Cambios

Cada versión dice qué hay que hacer al publicarla. Si usas `npm run publicar`, el
comando hace casi todo y te avisa lo que falta (ver INSTALAR.md, Parte C).

## 1.7.0 · Dos pasos, cambios en lote, avisos, respaldos diarios y correcciones

**Al publicar: hay DOS columnas nuevas y permisos nuevos → corre `instalar()` una vez**
(después de subir el código y antes de «Nueva versión»; `npm run publicar` lo pide):

- *Usuarios* → `correo` y `totp` (al final, después de `informes`).
- Google pide **autorizar otra vez**: mandar correos (avisos), Google Docs (borrador del
  oficio), conectarse a servicios externos (convertir el borrador a Word) y ejecutarse
  sin ti (respaldo diario y avisos). Acepta con la cuenta dueña.
- `instalar()` además crea la carpeta «Plantillas», los secretos de las contraseñas,
  mide el cifrado, cambia el disparador de los lunes por el **respaldo diario** (6 am)
  y agrega el de **avisos** (8 am). Llena `fecha_atencion` donde falte.
- Son archivos nuevos: `Seguridad.gs`, `Avisos.gs`, `Respaldos.gs`, `Plantillas.gs` y la
  página partida en `App*.html` (ver la tabla de INSTALAR.md, A2). Con `clasp push`
  (o `npm run publicar`) se suben solos; a mano hay que crearlos.
- La página nueva funciona con el servidor 1.6.0 (lo nuevo no aparece hasta publicarlo).

Después de publicar, recomendado (INSTALAR.md, A5 a A7): activar **dos pasos** en «Mi
cuenta», poner **plazo** y **días inhábiles**, la fecha de **«sin acuse» desde**, y la
carpeta de **respaldo externo**.

**Lo nuevo**

- **Verificación en dos pasos** (código de 6 dígitos de Google Authenticator o similar),
  con código QR dibujado en la página. Opción de hacerla obligatoria para administradores.
  Un administrador se la puede quitar a quien pierda el teléfono.
- **«Mi cuenta»**: contraseña, dos pasos, correo para avisos y «olvidar este equipo».
- **Cambiar varios a la vez** en cada libreta: estatus, acuse, turnar o fecha límite,
  hasta 500 registros, cada cambio en la Bitácora.
- **Ver escaneos sin descargarlos**: imagen o PDF en una ventana, con «Descargar».
- **Borrador del oficio en Word** desde una plantilla de Google Docs.
- **Días inhábiles** (con botón para los de ley y Semana Santa de cada año): no cuentan
  para la fecha límite, «vence pronto» ni el tiempo de respuesta de Informes.
- **«Sin acuse» cuenta desde** una fecha: lo migrado ya no infla el indicador.
- **Avisos por correo** (apagados de inicio): al turnar y un resumen diario a las 8 am.
  Sin el asunto, salvo que se pida.
- **Respaldos**: copia diaria (14 diarias + 12 semanales), copia de cada escaneo en
  «Archivos (espejo)», carpeta externa opcional (`respaldo_externo`) y
  `revisarRespaldos()` para probar que la copia sirve.
- **Recomendaciones en el portal** al administrador: poner plazo y activar dos pasos.
- **Si la sesión se vence con algo abierto**, se pide la contraseña encima y lo que se
  estaba guardando se guarda solo (antes se perdía lo escrito).

**Seguridad**

- Contraseñas: PBKDF2 con «pimienta» guardada fuera de la hoja y repeticiones medidas
  en el servidor (hasta 60 000); se vuelven a cifrar al entrar. Las de la 1.6.0 siguen
  sirviendo.
- Reglas nuevas: 10 caracteres o más, letras y números, sin usuario ni nombre y sin
  palabras obvias (gestión, CDMX, meses, qwerty…). Quien tenga una que no cumple la
  cambia al entrar. La contraseña temporal ahora es de 12 caracteres.
- Bloqueo progresivo (15 min, 1 h, 4 h). El freno general cuenta solo intentos fallidos
  (30 por minuto), así que un ataque ya no deja fuera a todos; desde un **equipo de
  confianza** (180 días) el dueño de la cuenta entra aunque esté bloqueada.
- Alertas de **consultas inusuales** a la Bitácora y por correo a los administradores.
- `avisosDiarios` y `respaldoDiario` (públicas porque las llama un disparador) solo
  hacen algo si las llama su disparador o el dueño, y una vez al día.
- La plantilla del oficio solo se acepta desde su carpeta privada.
- CSP: `frame-src blob:` y `object-src blob:` para ver PDF dentro de la página; nada externo.

**Correcciones**

- **Bitácora dentro del candado**: dos movimientos al mismo tiempo ya no pueden
  escribirse en el mismo renglón. Si el candado no se consigue, se anota con `appendRow`.
- **Subir y quitar escaneos**: el archivo se crea en Drive y se manda a la papelera
  **fuera** del candado (antes un escaneo grande detenía a todos); si falla, no queda
  basura en Drive.
- **Caché de lecturas** (comprimida, con versión): las listas y búsquedas ya no leen
  toda la hoja en cada vuelta. La caché se invalida en cada escritura y se apaga con la
  propiedad `CACHE_REGISTROS=NO`.
- Bitácora del administrador: se lee desde el final por bloques (no completa); avisa
  cuando no revisó todo.
- La página espera un tiempo máximo a cada llamada (antes podía quedarse «cargando»
  para siempre si se caía la red) y lo dice.
- Ventanas y panel (teclado y lectores de pantalla): el foco entra a la ventana, el Tab
  no se sale, al cerrar regresa al botón que la abrió y el título se anuncia.
- Contraste (WCAG AA): café y magenta un poco más oscuros, sin texto translúcido sobre
  color, chips e indicadores con fondo oscuro.
- A lo más tres avisos a la vez en pantalla.
- El código del servidor y de la página quedó en archivos por tema (antes, `App.html`
  de 2 700 líneas y `Servidor.gs` con todo).

**Para quien le da mantenimiento**

- `npm run empaquetar`: .zip del código sin datos ni credenciales.
- `npm run e2e`: recorrido en Chromium (Vercel con su CSP y Apps Script); capturas en
  `capturas/1.7.0/`.
- GitHub Actions corre `npm test` en cada push (`.github/workflows/pruebas.yml`).
- 108 pruebas (antes 69), incluido el QR leído con OpenCV y la carga de los `.gs` en
  los dos órdenes.

## 1.6.0 · Exportación solo para administradores, paleta del manual y velocidad

**Al publicar: no hay columnas nuevas.** Si en Google todavía está una versión anterior
a la 1.5.0, corre `instalar()` una vez (agrega `turnado_usuario`, `fecha_atencion` e
`informes`; se puede correr las veces que sea).

Cambian: `Servidor.gs`, `Instalacion.gs`, `App.html`, `Estilos.html` (y en la página:
`herramientas/armar-web.mjs`).

- **Exportación** (tarjeta y pantalla, solo administradores): todas las libretas o una,
  de una fecha a otra (Este mes, Mes pasado, Este año, Año pasado, Todo o fechas a mano),
  con vista previa de cuántos registros salen. Cuenta la fecha de recibido; si no hay,
  la del documento. El Excel trae además «Responsable en el sistema» y «Fecha de atención».
- **El servidor ya no deja exportar a Captura ni a Consulta** (`exportar` pide rol
  admin), aunque llamen a la acción directo. Se quitó el botón «Excel» de cada libreta
  y el «Excel de todas» del portal. El Excel de **Informes** sigue igual: lo tiene quien
  tenga permiso de Informes.
- **Paleta exacta del Manual de Identidad CDMX 2024-2030** en tarjetas, pantallas,
  buscador y gráficas de Informes (café `#ac6d14`, magenta `#d72f89`, rojo `#e5074c`…).
- **Velocidad** (ver LEEME, «Velocidad»):
  - `entrar` ya trae el portal (una vuelta menos al entrar).
  - Después de entrar, en segundo plano: las listas del año de todas las libretas en una
    sola vuelta (`listarTodo`), Pendientes y, si hay algo turnado, Mis asuntos. Al
    abrirlas ya se ven; si alguien más capturó algo, aparece un segundo después.
  - El panel de un oficio abre al instante con lo que ya se ve en la lista; archivos
    e historial llegan después (Editar, Duplicar e Imprimir se activan al llegar todo).
  - Guardar, cancelar, subir o quitar archivo regresan el panel completo (`detalle`):
    ya no se pide otra vez.
  - En el servidor la hoja se abre **una vez por petición**, y el historial de un oficio
    busca solo sus renglones en la bitácora (antes la leía completa en cada consulta,
    y la bitácora crece todos los días). La Bitácora del administrador se lee una vez,
    no dos.
  - Lo guardado en memoria es solo de esa pestaña, nunca en disco, y se borra al salir
    o al cambiar de usuario.
- La página nueva funciona con un servidor 1.5.0 (sin precarga ni Exportación hasta que
  se publique el servidor; el administrador ve el aviso de versiones).

## 1.5.0 · Volante imprimible e Informes

**Al publicar: hay DOS columnas nuevas → corre `instalar()` una vez** (después de pegar o
subir el código y antes de «Nueva versión»):

- *Registros* → `fecha_atencion` (al final, después de `turnado_usuario`): el día en que
  el registro pasó a Atendido o Concluido. La llena el servidor.
- *Usuarios* → `informes` (al final, después de `ultimo_acceso`): `SI` = puede ver Informes.

Qué trae:

- **Imprimir volante** en el detalle de lo recibido: media carta con encabezado y logo,
  números, fecha y hora de recepción, remitente, asunto, turnado a, fecha límite, recibió,
  observaciones y espacios para firma y sello (`@media print` + `window.print()`).
- **Informes** (tarjeta y pantalla): filtros de periodo y libreta; registros por mes y por
  libreta; principales remitentes y destinatarios; tiempo promedio de respuesta
  (entrante → oficio saliente con «Responder»); porcentaje atendido a tiempo contra la
  fecha límite; Excel con el detalle. Gráficas SVG hechas a mano.
- **Permiso de Informes** en Usuarios (los administradores siempre lo tienen). Cambiarlo
  cierra la sesión de esa persona, como cualquier cambio de permisos.
- `api()` admite permisos por acción además del rol (`permiso` en `ACCIONES_`).

Después de una revisión de seguridad independiente:

- Al cerrar sesión la página olvida todo lo de esa persona (informes, búsqueda, lista,
  filtros), para que en una computadora compartida el siguiente no vea nada del anterior.
- `npm run publicar` ahora solo deja subir código y documentación: cualquier archivo
  nuevo que no lo sea (PDF, foto, Excel, `.json`, carpetas desconocidas…) lo detiene.
- «Varios destinatarios»: el servidor exige los números confirmados (`desde`); sin la
  vista previa no guarda nada.
- El servidor manda a la hoja lo escrito (`flush`) antes de soltar el candado, como
  recomienda Google, para que el siguiente lea siempre el último consecutivo.
- La reparación automática de columnas solo actúa si esas columnas están vacías en
  toda la hoja (no adopta notas escritas a mano).
- Si a un administrador lo bajan de rol, no se queda con «Informes» marcado sin que
  alguien lo elija.

## 1.4.0 · Duplicar, fotos, buscador general, mantenimiento y respaldo

**Al publicar: no hay columnas nuevas** (no hace falta `instalar()`; si lo corres, solo
agrega a *Config* las filas `mantenimiento` y `mantenimiento_msg`, que de todos modos se
crean solas la primera vez que se prende el mantenimiento).

- **Duplicar** en el detalle: abre el alta con los datos copiados (sin número, archivos,
  estatus, cancelación, historial, acuse, relación ni fechas). La Bitácora dice de cuál
  es copia.
- **Tomar foto** en Documento y Acuse: cámara trasera del celular; se reduce en el
  navegador (2000 px, JPEG 80 %) antes de subir. Imágenes de más de 10 MB con «Subir»
  también se reducen. Sin cambios en la CSP ni en Permissions-Policy.
- **Buscador general** en el portal: todas mis libretas y todos los años, sin acentos
  ni mayúsculas, hasta 50 resultados agrupados por libreta.
- **Modo mantenimiento** (Configuración): solo entran los administradores; la pantalla
  de entrada muestra el mensaje; las sesiones abiertas salen con el aviso (código
  `MANTENIMIENTO`); queda en la Bitácora.
- **Respaldo completo** en Excel (Configuración, solo admin): Registros, Directorio,
  Usuarios sin clave ni sello, Bitácora y Config. Queda en la Bitácora.
- La página pregunta cada 5 min si la sesión sigue viva (`ping`); esa pregunta no
  alarga la sesión, así que al pasar 3 h sin uso la página regresa sola a la entrada.
- Excel: una fecha que no tiene forma AAAA-MM-DD se conserva como texto (antes quedaba vacía).

## 1.3.0 · Varios destinatarios, Mis asuntos y publicar con un comando

**Al publicar: hay una columna nueva → corre `instalar()` una vez** (después de pegar
o subir el código y antes de «Nueva versión»).

- **Columna nueva** al final de la pestaña *Registros*: `turnado_usuario` (a qué
  usuario del sistema se le turnó el asunto). Las columnas anteriores no se mueven.
- **Varios destinatarios** en *Nuevo oficio saliente*: el mismo oficio para hasta 100
  personas, con números seguidos asignados dentro de un solo candado, confirmación
  previa con el rango exacto y bitácora por oficio más un resumen.
- **Mis asuntos**: turnar a un usuario activo con acceso a la libreta (en
  *Seguimiento*), tarjeta y pantalla propias, filtro «Turnados a mí» en cada libreta,
  aviso en el portal y bitácora del turno.
- **`npm run publicar -- "mensaje"`**: pruebas, versiones, `clasp push`, nueva versión
  de la implementación, revisión de datos y `git push`, deteniéndose con explicación
  si algo falla. Funciona en Windows.
- La página nueva funciona con un servidor anterior: lo nuevo simplemente no aparece
  hasta que se publica el servidor (y el administrador ve el aviso de versiones).
- Una página anterior que edite un registro **no borra** el turno.
- Red de seguridad: si se publica el código sin correr `instalar()`, la app agrega
  sola el encabezado de la columna nueva y lo anota en la Bitácora.
- En celular los campos usan letra de 16 px y los botones son más altos.
- `npm test`: la prueba de Excel ya no falla en Windows si Python se llama `python` o
  `py` (y se salta si no hay openpyxl).
