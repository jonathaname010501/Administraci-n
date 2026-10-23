# Cambios

Cada versión dice qué hay que hacer al publicarla. Si usas `npm run publicar`, el
comando hace casi todo y te avisa lo que falta (ver INSTALAR.md, Parte C).

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
