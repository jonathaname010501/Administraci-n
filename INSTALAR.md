# Instalar el Control de Gestión

Hay dos partes:

- **Parte A · Google** (obligatoria): la base, el servidor y los escaneos viven en Google.
- **Parte B · GitHub + Vercel** (recomendada): la página se publica en Vercel con una
  dirección propia y se actualiza sola con cada `git push`. Vercel **solo guarda la
  página** (pantallas y estilos), ningún dato.

Al final está la **Parte C**: cómo publicar cambios.

Necesitas una cuenta de Gmail del área y, para la Parte B, GitHub, Vercel y Node.js 20 o más.

---

# Parte A · Google

## A0 · La cuenta dueña

Usa una cuenta **del área**, no el Gmail personal de alguien (por ejemplo
`controlgestion.stpi@gmail.com`). Actívale la **verificación en dos pasos** en
myaccount.google.com → Seguridad. Haz todo lo de Google con esa cuenta; si tienes
varias cuentas abiertas, usa una ventana de incógnito.

## A1 · Subir la base

1. drive.google.com → **Nuevo → Subir archivo** → `base/Control_de_Gestion.xlsx`.
2. Ábrelo. Arriba dirá **.XLSX** → **Archivo → Guardar como Hojas de cálculo de Google**.
3. En la copia nueva, cambia el nombre a **Control de Gestión (base)**.
4. Borra el `.xlsx` de tu Drive.
5. ⚠️ **No compartas la hoja con nadie.**

## A2 · Pegar el código

1. En la hoja: **Extensiones → Apps Script**.
2. Cambia "Proyecto sin título" por **Control de Gestión**.
3. **⚙ Configuración del proyecto** → marca **"Mostrar el archivo de manifiesto
   «appsscript.json» en el editor"**. Regresa al editor (`< >`).
4. Crea los archivos. El editor agrega `.gs` o `.html` solo, así que escribe el
   nombre **sin** extensión:

   | Archivo | Cómo | Contenido |
   |---|---|---|
   | `Servidor` | Renombra `Código` (⋮ → Cambiar nombre) | `apps-script/Servidor.gs` |
   | `Instalacion` | **+ → Script** (o "Secuencia de comandos") | `apps-script/Instalacion.gs` |
   | `Index` | **+ → HTML** | `apps-script/Index.html` |
   | `Estilos` | **+ → HTML** | `apps-script/Estilos.html` |
   | `Excel` | **+ → HTML** | `apps-script/Excel.html` |
   | `App` | **+ → HTML** | `apps-script/App.html` |
   | `appsscript.json` | Ya existe | `apps-script/appsscript.json` |

   En cada uno: borra lo que traiga, pega **todo** y guarda (Ctrl+S).

   > Si no encuentras la opción para crear un script, pega el contenido de
   > `Instalacion.gs` **al final** de `Servidor`. Funciona igual.

   > Con clasp (Parte C) todo esto se hace con un solo comando: `npm run servidor:subir`.

## A3 · Correr `instalar()`

1. En la lista de la izquierda abre **`Instalacion.gs`**. El menú de funciones de
   arriba solo muestra las del archivo abierto.
2. En ese menú elige **`instalar`** → **▶ Ejecutar**.
3. Permisos: **Revisar permisos** → tu cuenta → "Google no verificó esta app" →
   **Configuración avanzada → Ir a Control de Gestión (no seguro) → Permitir**.
   Es normal: la app es tuya y no está publicada en ninguna tienda.
4. En el **Registro de ejecución** copia el **PRIMER ADMINISTRADOR** (usuario y
   contraseña temporal). No se vuelve a mostrar.
5. Revisa que termine en **✔ Todo en orden**.

## A4 · Publicar el servidor (aplicación web)

1. **Implementar → Nueva implementación** → ⚙ → **Aplicación web**.
2. Descripción `Versión 1` · **Ejecutar como: Yo** · **Quién tiene acceso: Cualquier usuario**.
3. **Implementar** → copia la **URL de la aplicación web** (termina en `/exec`).

Esa URL ya funciona como app. Si haces la Parte B, va a quedar como **API**: la
página de Vercel le habla a esa dirección.

> **¿Por qué "Cualquier usuario"?** La puerta la cuida la app con su propio
> usuario y contraseña. Con cuentas Gmail, Google no le dice a la app quién entra,
> y la página de Vercel necesita poder llamarla.

## A5 · Primer ingreso

1. Abre la URL `/exec` → entra con `admin` y la contraseña temporal → crea la tuya.
2. **Usuarios → Editar** en `admin` → pon tu nombre.

(Si vas a hacer la Parte B, puedes dar de alta a la gente después, ya en Vercel.)

---

# Parte B · GitHub + Vercel

## B1 · Repositorio privado en GitHub

1. En github.com → **New repository** → nombre `control-gestion` → **Private** → Create.
2. En tu computadora, dentro de la carpeta `control-gestion` (la del zip):

   ```bash
   git init
   git add .
   git status
   ```

   Revisa que en la lista **no** aparezcan `base/`, `capturas/` ni ningún `.xlsx`.
   El archivo `.gitignore` los deja fuera a propósito, porque son datos reales.

   ```bash
   git commit -m "Control de Gestión"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/control-gestion.git
   git push -u origin main
   ```

## B2 · Vercel

1. vercel.com → **Add New → Project** → importa `control-gestion`.
2. **Framework Preset: Other**. No cambies Build ni Output: los toma de `vercel.json`.
3. **Environment Variables** → agrega:
   - Nombre: `CG_API_URL`
   - Valor: la URL `/exec` del paso A4 (`https://script.google.com/macros/s/AKfy…/exec`)
4. **Deploy**. Si la variable falta o está mal, el build se detiene y te dice por qué.
5. Abre la dirección que te da Vercel (por ejemplo `https://control-gestion.vercel.app`)
   y entra con tu usuario.

Si quieres un dominio propio: Vercel → Settings → Domains.

## B3 · Una sola entrada

1. En la app (ya en Vercel) → **Configuración → Dirección pública de la app** → pega la
   dirección de Vercel → **Guardar**.
2. Desde ese momento, si alguien abre la URL de Google `/exec`, solo verá un enlace a
   Vercel. La API sigue funcionando.
3. Ahora sí: **Usuarios → Nuevo usuario** para cada persona, y comparte la
   **dirección de Vercel**.

## B4 · Revisar seguridad y migración

- En el editor de Apps Script corre **`revisarSeguridad`**. Debe decir que todo está privado.
- En la hoja, revisa la pestaña **"Revisar migración"** (86 avisos). Corrige en
  **Directorio** lo que haga falta y luego borra la pestaña.

---

# Parte C · Publicar cambios

| Si cambias… | Qué haces |
|---|---|
| Pantallas o estilos (`App.html`, `Estilos.html`, `Excel.html`, `Index.html`) | `git push`. Vercel publica solo en 1 minuto. |
| El servidor (`Servidor.gs`, `Instalacion.gs`) | clasp (abajo) o pegarlo a mano en el editor, y luego publicar una versión nueva **en la misma implementación**. |

Conviene que el proyecto de Apps Script también tenga las pantallas al día; con clasp
se sube todo junto.

## C1 · Configurar clasp (una sola vez)

clasp es la herramienta oficial de Google para subir código a Apps Script desde tu computadora.

1. `npm install -g @google/clasp`
2. Activa la API: https://script.google.com/home/usersettings → **API de Google Apps Script: Activado**.
3. `clasp login` → entra con la **cuenta dueña**.
4. En el editor de Apps Script: **⚙ Configuración del proyecto → ID de la secuencia de
   comandos** → cópialo.
5. En la carpeta del proyecto, copia `.clasp.json.ejemplo` como `.clasp.json` y pega
   el ID. Este archivo no se sube a GitHub.
6. `npm run servidor:implementaciones` → copia el ID de la implementación de la
   aplicación web, la que dice `Versión 1`, **no** la `@HEAD`.

## C2 · Cada vez que cambies el servidor

```bash
npm test                                   # que todo pase
npm run servidor:subir                     # sube los archivos de apps-script/
clasp update-deployment ID_DE_IMPLEMENTACION -d "Descripción del cambio"
```

La URL `/exec` **no cambia**, así que no hay que tocar Vercel.

> ⚠️ `clasp push` reemplaza **todos** los archivos del proyecto en línea con los de
> tu carpeta `apps-script/`. Eso está bien: así no quedan copias viejas (por ejemplo
> un `Servidor.gs.gs` que se haya creado a mano).

> 🔒 `clasp login` guarda una llave en tu computadora (`.clasprc.json`, en tu
> carpeta de usuario) que da acceso al Drive de la cuenta dueña. No la compartas ni
> la subas a GitHub. Por eso el servidor **no** se publica automáticamente desde
> GitHub: esa llave tendría que vivir en GitHub.

## C3 · Sin clasp (a mano)

1. Pega los archivos cambiados en el editor y guarda.
2. **Implementar → Gestionar implementaciones → ✏** → Versión: **Nueva versión** → **Implementar**.

⚠️ No uses "Nueva implementación": crea **otra URL** y habría que cambiar `CG_API_URL` en Vercel.

---

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| En Vercel: "No hubo conexión con el servidor" | Revisa `CG_API_URL` (Vercel → Settings → Environment Variables) y que la implementación diga **Cualquier usuario**. Después de cambiar la variable: Deployments → ⋯ → **Redeploy**. |
| "El sistema no está instalado" | Corre `instalar()` (A3). |
| En el menú de funciones no aparece `instalar` | Abre primero `Instalacion.gs` en la lista de la izquierda. |
| "Las columnas de la pestaña … no son las esperadas" | Alguien movió columnas en la hoja: **Archivo → Historial de versiones** y restaura. |
| Se olvidó la contraseña del administrador | Editor → `restablecerAdministrador` → copia la nueva del registro. |
| Una persona quedó bloqueada | Usuarios → Editar → Desbloquear (o espera 15 min). |
| ¿Algo quedó compartido? | Editor → `revisarSeguridad`. |
| La primera acción del día tarda unos segundos | Normal en Apps Script cuando nadie la ha usado en un rato. |

## Probar en tu computadora (opcional)

```bash
npm test                     # 31 pruebas (24 necesitan base/base.json del zip)
npm run local                # la app con la base migrada en http://localhost:4321
```
