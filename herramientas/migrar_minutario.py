#!/usr/bin/env python3
"""
migrar_minutario.py · Pasa el "Minutario 2026" capturado a mano a la base del
sistema de Control de Gestión (Google Sheets + Apps Script).

Uso:
    python3 migrar_minutario.py  Minutario_2026_folios.xlsx  salida/

Genera en salida/:
    Control_de_Gestion.xlsx   la base lista para subir a Google Drive
    base.json                 lo mismo en JSON (lo usan las pruebas)
    resumen-migracion.txt               conteos y avisos

Qué hace (y por qué):
  · Lee las 6 hojas (encabezados en la fila 7, datos desde la 8).
  · Descarta filas vacías y el relleno arrastrado de "Oficio de conocimiento"
    (Asunto "En atención al oficio" + Firma "S.A.L" sin ningún otro dato).
  · Arma un DIRECTORIO de personas a partir de "Dirigido a", "Firma" y
    "Remitente": separa nombre y cargo, y junta las variantes de una misma
    persona (mayúsculas, acentos, dobles espacios, letras de más o de menos).
    Cada unión por parecido queda anotada en la pestaña "Revisar migración".
  · Unifica quién elaboró / recibió ("Valentina J", "VALENTINA J", "valentina").
  · Corrige fechas capturadas como texto. El "7" en lugar de "/" es Shift
    olvidado en teclado español: 18/0672026 → 18/06/2026. Todo lo que se
    corrige o se ve raro queda en "Revisar migración".
  · Oficios salientes: número oficial SAPCI/STPI/NNN/AAAA a partir del
    consecutivo (así los citan en los oficios entrantes).
  · Liga entrantes con el oficio saliente que mencionan ("Respuesta del
    oficio SAPCI/STPI/006/2026" → relacionado con el oficio saliente 006).
  · Nada se inventa: lo que no viene en el Excel queda vacío.
"""
import collections
import datetime as dt
import difflib
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

ANIO = 2026
AHORA = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# ─── Esquema de la base (DEBE coincidir con Servidor.gs → COLS) ─────────────
COLS = {
    "Registros": ["id", "tipo", "anio", "consecutivo", "sufijo", "numero", "asunto",
                  "dirigido_id", "dirigido_a", "firma_id", "firma", "area",
                  "fecha", "fecha_recepcion", "elaboro", "acuse", "carpeta",
                  "observaciones", "estatus", "fecha_limite", "turnado_a",
                  "relacionado_id", "archivo_id", "archivo_nombre",
                  "acuse_archivo_id", "acuse_archivo_nombre", "motivo_cancelacion",
                  "creado_por", "creado_en", "modificado_por", "modificado_en",
                  "version", "origen",
                  # 1.3.0 · columnas nuevas: SIEMPRE al final (igual que en Servidor.gs)
                  "turnado_usuario",
                  # 1.5.0
                  "fecha_atencion"],
    "Directorio": ["id", "nombre", "cargo", "dependencia", "activo", "unido_a",
                   "creado_por", "creado_en", "modificado_en"],
    "Usuarios": ["usuario", "nombre", "rol", "tipos", "activo", "clave", "debe_cambiar",
                 "intentos", "bloqueado_hasta", "sello", "creado_en", "ultimo_acceso",
                 # 1.5.0
                 "informes",
                 # 1.7.0
                 "correo", "totp"],
    "Bitacora": ["fecha", "usuario", "accion", "registro_id", "detalle"],
    "Config": ["clave", "valor", "descripcion"],
}
NUMERICAS = {"Registros": {"anio", "consecutivo", "version"}}

HOJAS = {
    # hoja original → (tipo, mapa columna original → campo)
    "OFICIOS": ("OFS", {
        "Núm. Consecutivo": "consecutivo", "Dirigido a:": "dirigido", "Asunto:": "asunto",
        "Fecha": "fecha", "Firma": "firma", "Revisó/Elaboró": "elaboro", "ACUSE": "acuse",
        "No. de Carpeta": "carpeta", "OBSERVACIONES": "observaciones"}),
    "OFICIOS ENTRANTES": ("OFE", {
        "Núm. Consecutivo": "consecutivo", "Dirigido a:": "dirigido", "No. Oficio": "numero",
        "Asunto:": "asunto", "Fecha de Elaboración": "fecha", "Fecha de Recibido": "fecha_recepcion",
        "Remitente": "firma", "Recibió": "elaboro", "OFICIO": "acuse",
        "No. de Carpeta": "carpeta", "OBSERVACIONES": "observaciones"}),
    "OFICIO DE CONOCIMIENTO": ("OFC", {
        "Núm. Consecutivo": "consecutivo", "Dirigido a:": "dirigido", "Oficio": "numero",
        "Asunto:": "asunto", "Fecha de elaboración": "fecha", "Fecha de recibido": "fecha_recepcion",
        "Firma": "firma", "Elaboró /Revisó": "elaboro", "ACUSE": "acuse",
        "No. de Carpeta": "carpeta", "OBSERVACIONES": "observaciones"}),
    "CIRCULARES": ("CIR", {
        "Núm. Consecutivo": "consecutivo", "Dirigido a:": "dirigido", "Circular No.": "numero",
        "Asunto:": "asunto", "Fecha": "fecha", "Firma": "firma", "Area o Dependencia": "area",
        "OBSERVACIONES": "observaciones"}),
    "TARJETAS INFORMATIVAS": ("TAR", {
        "Núm. Consecutivo": "consecutivo", "Dirigido a:": "dirigido", "Folio": "numero",
        "Asunto:": "asunto", "Fecha de elaboración": "fecha", "Fecha de recepción": "fecha_recepcion",
        "Firma": "firma", "Elaboró /Revisó": "elaboro", "ACUSE": "acuse",
        "No. de Carpeta": "carpeta", "OBSERVACIONES": "observaciones"}),
    "VOLANTE DE TURNO ENTRANTES": ("VOL", {
        "Núm. Consecutivo": "consecutivo", "Dirigido a:": "dirigido", "Asunto:": "asunto",
        "Folio": "numero", "Fecha de elaboración": "fecha", "Fecha de recepción": "fecha_recepcion",
        "Firma": "firma", "Elaboró /Revisó": "elaboro", "ACUSE": "acuse",
        "No. de Carpeta": "carpeta", "OBSERVACIONES": "observaciones"}),
}

revisar = []  # (hoja, fila, qué pasó, original, en la base)


def avisar(hoja, fila, que, original="", nuevo=""):
    revisar.append([hoja, fila if fila else "", que, str(original), str(nuevo)])


# ─── Texto ───────────────────────────────────────────────────────────────────
def limpio(v):
    if v is None:
        return ""
    s = str(v).replace("\r", "").replace("\u00a0", " ")
    s = "\n".join(re.sub(r"[ \t]+", " ", l).strip() for l in s.split("\n"))
    return re.sub(r"\n{2,}", "\n", s).strip()


def sin_acentos(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


TITULOS = r"(lic|licda|lcda|lcdo|lda|mtro|mtra|mtr|maestro|maestra|c|cc|dr|dra|ing|arq|prof|profa|lcp|cp|mvz|psic|dip|tsu|m|en|h|ciudadano|ciudadana)"
CONECTORES = {"de", "del", "la", "las", "los", "y"}


def clave_nombre(nombre):
    s = sin_acentos(nombre).lower()
    s = re.sub(r"[^a-zñ ]", " ", s.replace(".", " "))
    palabras = [p for p in s.split() if p]
    while palabras and re.fullmatch(TITULOS, palabras[0]):
        palabras.pop(0)
    return " ".join(palabras)


MINUSC = {"de", "del", "la", "las", "los", "y", "e", "en", "a", "al", "el", "para", "por"}


def titulo_es(s):
    """'MTRO. DANIEL ESTEBAN RAMIREZ GARCEN' → 'Mtro. Daniel Esteban Ramirez Garcen'."""
    s = re.sub(r"^(lic|licda|lcda|lcdo|lda|mtro|mtra|mtr|dr|dra|ing|arq|prof|profa|dip|c)\.\s*",
               lambda m: m.group(1).capitalize() + ". ", s, flags=re.I)
    if s != s.upper():
        return s
    out = []
    for i, w in enumerate(s.lower().split(" ")):
        out.append(w if (i > 0 and w in MINUSC) else w[:1].upper() + w[1:])
    return " ".join(out)


# Palabras con las que empieza un cargo. Se buscan por prefijo para aguantar
# errores de dedo ("Secrerario", "Subsecretari", "DEIRECTOR", "Tiyular").
CARGO = re.compile(
    r"\b(subsecret|secret|secrer|subdirec|direc|deirec|titul|tiyul|vocal|conduct|coordin|jef[ea]\b|"
    r"j\.?\s?u\.?\s?d\b|encargad|enlace|l[ií]der|asesor|alcald|presiden|contralor|responsable|fiscal|"
    r"comisionad|consejer|diputad|concejal|oficial|analista|gerente|rector|delegad|administrador|"
    r"supervisor|representante|auxiliar|apoderad|jefatura|unidad)\w*",
    re.I,
)
# Destinatarios que no son una persona: "Titular(es) de…", "Oficina particular…"
GENERICO = re.compile(r"^(oficina|titular|titulares|miembros|integrantes|secretar|subsecretar|direcci|"
                      r"coordinaci|unidad|personal|[áa]rea|[áa]reas|todas|todos)", re.I)


def separar(texto):
    """'Lic. Juan Pérez\\nDirector de X' → ('Lic. Juan Pérez', 'Director de X')."""
    t = (texto or "").replace("\r", "").replace("\u00a0", " ")
    plano = re.sub(r"\s+", " ", t).strip(" ,.;-")
    if GENERICO.match(plano):
        return plano, ""
    partes = [re.sub(r"\s+", " ", p).strip(" ,.;-") for p in re.split(r"\n|\s{3,}", t)]
    partes = [p for p in partes if p]
    if not partes:
        return "", ""
    nombre, resto = partes[0], " ".join(partes[1:])
    # El cargo empieza en la primera palabra-cargo que tenga al menos 2 palabras
    # antes ("Comisaria Jefa Licda Paulina Salazar… Subsecretaria de…").
    for m in CARGO.finditer(nombre):
        if len(nombre[: m.start()].split()) >= 2:
            resto = (nombre[m.start():] + " " + resto).strip()
            nombre = nombre[: m.start()].strip(" ,.;-")
            break
    return nombre, re.sub(r"\s+", " ", resto).strip(" ,.;-")


def puntaje_forma(s):
    """Prefiere la forma bien escrita: con minúsculas y con acentos."""
    return (s != s.upper(), sum(1 for c in s if c in "áéíóúÁÉÍÓÚñÑüÜ"), -s.count("  "))


# ─── Fechas ──────────────────────────────────────────────────────────────────
def fecha(v, hoja, fila, campo):
    if v in (None, ""):
        return ""
    if isinstance(v, (dt.datetime, dt.date)):
        d = v.date() if isinstance(v, dt.datetime) else v
    else:
        s = str(v).strip()
        original = s
        s = re.sub(r"^[^0-9]+", "", s).replace("//", "/")
        m = (re.fullmatch(r"(\d{1,2})/(\d{1,2})7(\d{4})", s)          # 18/0672026
             or re.fullmatch(r"(\d{1,2})7(\d{1,2})/(\d{4})", s)        # 29706/2026
             or re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s))
        if not m:
            avisar(hoja, fila, f"{campo}: no es una fecha, se dejó vacía", original, "")
            return ""
        dd, mm, aa = int(m.group(1)), int(m.group(2)), m.group(3)
        aa = 2026 if aa in ("0206", "2062", "2602") else int(aa)
        try:
            d = dt.date(aa, mm, dd)
        except ValueError:
            avisar(hoja, fila, f"{campo}: fecha imposible, se dejó vacía", original, "")
            return ""
        avisar(hoja, fila, f"{campo}: venía como texto, se corrigió", original, d.strftime("%d/%m/%Y"))
    if d.year < 2020:
        nueva = d.replace(year=ANIO)
        avisar(hoja, fila, f"{campo}: año {d.year} imposible, se cambió a {ANIO} (confírmalo)",
               d.strftime("%d/%m/%Y"), nueva.strftime("%d/%m/%Y"))
        d = nueva
    elif d.year < ANIO - 1 or d > dt.date.today() + dt.timedelta(days=60):
        avisar(hoja, fila, f"{campo}: fecha fuera del periodo, revísala", d.strftime("%d/%m/%Y"), d.strftime("%d/%m/%Y"))
    return d.isoformat()


# ─── Lectura ─────────────────────────────────────────────────────────────────
def leer(ruta):
    wb = openpyxl.load_workbook(ruta, data_only=True)
    filas = []
    for hoja, (tipo, mapa) in HOJAS.items():
        ws = wb[hoja]
        enc = {}
        for c in range(1, ws.max_column + 1):
            t = re.sub(r"\s+", " ", str(ws.cell(7, c).value or "")).strip()
            if t in mapa:
                enc[mapa[t]] = c
        faltan = set(mapa.values()) - set(enc)
        assert not faltan, f"{hoja}: no encontré las columnas {faltan}"
        for r in range(8, ws.max_row + 1):
            d = {k: ws.cell(r, c).value for k, c in enc.items()}
            otros = [v for k, v in d.items() if k != "consecutivo" and v not in (None, "")]
            if not otros:
                continue
            if tipo == "OFC" and limpio(d.get("asunto")) == "En atención al oficio" and limpio(d.get("firma")) == "S.A.L" \
                    and not any(d.get(k) not in (None, "") for k in ("dirigido", "numero", "fecha", "fecha_recepcion", "elaboro", "acuse", "carpeta", "observaciones")):
                continue  # relleno arrastrado
            d.update(hoja=hoja, fila=r, tipo=tipo)
            filas.append(d)
    return filas


# ─── Notas escritas donde no van ─────────────────────────────────────────────
NOTA = re.compile(r"^falta\b|falta\s+acuse|folio\s+otorgado|^pendiente|^cancelad", re.I)


def mover_notas(filas):
    """En OFICIOS escribieron "FALTA ACUSE 217" o "Folio otorgado al profesor…"
    en la columna "Dirigido a". Eso no es una persona: va a Observaciones."""
    for f in filas:
        txt = limpio(f.get("dirigido"))
        if txt and NOTA.search(txt):
            nota = re.sub(r"\s+", " ", txt).strip()
            obs = limpio(f.get("observaciones"))
            f["observaciones"] = (obs + "\n" if obs else "") + nota
            f["dirigido"] = None
            avisar(f["hoja"], f["fila"], "Nota escrita en 'Dirigido a': se pasó a Observaciones", nota, "")


# ─── Directorio ──────────────────────────────────────────────────────────────
def armar_directorio(filas):
    apariciones = collections.defaultdict(list)  # clave → [(nombre, cargo, hoja, fila)]
    for f in filas:
        for campo in ("dirigido", "firma"):
            txt = limpio(f.get(campo))
            if not txt:
                continue
            nombre, cargo = separar(txt)
            if f["tipo"] == "CIR" and campo == "firma" and not cargo:
                cargo = re.sub(r"\s+", " ", limpio(f.get("area"))).strip()
            k = clave_nombre(nombre)
            if not k:
                continue
            f[campo + "_clave"] = k
            apariciones[k].append((titulo_es(nombre), titulo_es(cargo) if cargo == cargo.upper() else cargo, f["hoja"], f["fila"]))

    # Unir variantes: por parecido (≥ 0.9) o porque un nombre contiene al otro (≥ 3 palabras)
    claves = sorted(apariciones, key=lambda k: -len(apariciones[k]))
    destino = {}
    for i, k in enumerate(claves):
        if k in destino:
            continue
        destino[k] = k
        for k2 in claves[i + 1:]:
            if k2 in destino:
                continue
            if misma_persona(k, k2):
                destino[k2] = k
    grupos = collections.defaultdict(list)
    for k, d in destino.items():
        grupos[d].append(k)

    directorio, por_clave = [], {}
    for n, (k, miembros) in enumerate(sorted(grupos.items(), key=lambda kv: clave_nombre(kv[0])), start=1):
        todas = [a for m in miembros for a in apariciones[m]]
        nombres = collections.Counter(a[0] for a in todas)
        nombre = max(nombres, key=lambda s: (puntaje_forma(s), nombres[s]))
        cargos = collections.Counter(re.sub(r"\s+", " ", a[1]) for a in todas if a[1])
        cargo = max(cargos, key=lambda s: (cargos[s], puntaje_forma(s))) if cargos else ""
        pid = f"P{n:04d}"
        directorio.append({"id": pid, "nombre": nombre, "cargo": cargo, "dependencia": "", "activo": "SI",
                           "unido_a": "", "creado_por": "migración", "creado_en": AHORA, "modificado_en": AHORA})
        for m in miembros:
            por_clave[m] = (pid, nombre, cargo)
        if len(miembros) > 1:
            variantes = sorted({a[0] for a in todas})
            primera = apariciones[miembros[1]][0]
            avisar(primera[2], primera[3], "Se juntaron como la misma persona (si no lo son, sepáralas en Directorio)",
                   " | ".join(variantes), nombre)
    return directorio, por_clave


def misma_persona(a, b):
    """Conservador: es preferible dejar un duplicado (se une en la app con
    "Unir") que juntar a dos personas distintas."""
    pa = [w for w in a.split() if w not in CONECTORES]
    pb = [w for w in b.split() if w not in CONECTORES]
    if min(len(pa), len(pb)) < 2:
        return False
    if difflib.SequenceMatcher(None, " ".join(pa), " ".join(pb)).ratio() >= 0.9:
        return True
    corto, largo = sorted((pa, pb), key=len)
    if len(corto) < 3 or len(largo) - len(corto) > 1:
        return False
    libres = list(largo)
    for w in corto:  # cada palabra del corto debe estar (casi igual) en el largo
        mejor = max(libres, key=lambda x: difflib.SequenceMatcher(None, w, x).ratio())
        if difflib.SequenceMatcher(None, w, mejor).ratio() < 0.83:
            return False
        libres.remove(mejor)
    return True


def unificar_elaboro(filas):
    def k(s):
        s = clave_nombre(s.replace("/", " / ")) if "/" not in s else sin_acentos(s).lower().strip(" .")
        return s
    formas = collections.defaultdict(collections.Counter)
    for f in filas:
        t = re.sub(r"\s+", " ", limpio(f.get("elaboro"))).strip(" .")
        if t:
            f["_el"] = t
            formas[k(t)][t] += 1
    # "valentina" → "valentina j" si es la única continuación
    claves = list(formas)
    mapa = {c: c for c in claves}
    for c in claves:
        mas_largas = [o for o in claves if o != c and o.startswith(c + " ")]
        if len(mas_largas) == 1:
            mapa[c] = mas_largas[0]
    canon = {}
    for c in claves:
        d = mapa[c]
        todas = formas[d] + (formas[c] if c != d else collections.Counter())
        canon[c] = max(todas, key=lambda s: (puntaje_forma(s), todas[s]))
    cambios = collections.Counter()
    for f in filas:
        if "_el" in f:
            nuevo = canon[k(f["_el"])]
            if nuevo != f["_el"]:
                cambios[(f["_el"], nuevo)] += 1
            f["elaboro_final"] = nuevo
    for (a, b), n in sorted(cambios.items()):
        avisar("(varias)", "", f"Elaboró/Recibió unificado ({n} filas)", a, b)


# ─── Armado de registros ─────────────────────────────────────────────────────
def armar(filas, por_clave):
    registros, usados = [], collections.defaultdict(set)
    sin_consec = []
    for f in filas:
        tipo, hoja, fila = f["tipo"], f["hoja"], f["fila"]
        raw = limpio(f.get("consecutivo"))
        sufijo = ""
        m = re.fullmatch(r"0*(\d+)\s*-?\s*(bis)?", raw, re.I)
        if raw and m:
            consec = int(m.group(1))
            if m.group(2):
                sufijo = "BIS"
        elif raw:
            try:
                consec = int(float(raw))
            except ValueError:
                consec = None
                avisar(hoja, fila, "Consecutivo ilegible", raw, "")
        else:
            consec = None
        if consec is None:
            sin_consec.append(f)
            continue
        if (consec, sufijo) in usados[tipo]:
            avisar(hoja, fila, "Consecutivo repetido: se marcó como BIS", raw, f"{consec} BIS")
            sufijo = "BIS"
        usados[tipo].add((consec, sufijo))
        registros.append(registro(f, consec, sufijo, por_clave))
    for f in sin_consec:
        tipo = f["tipo"]
        consec = max(c for c, _ in usados[tipo]) + 1
        usados[tipo].add((consec, ""))
        avisar(f["hoja"], f["fila"], "No tenía consecutivo: se le dio el siguiente libre", "", consec)
        registros.append(registro(f, consec, "", por_clave))
    return registros


def numero_ofs(consec, sufijo):
    n = f"{consec:03d}" + (f" {sufijo}" if sufijo else "")
    return f"SAPCI/STPI/{n}/{ANIO}"


def registro(f, consec, sufijo, por_clave):
    tipo, hoja, fila = f["tipo"], f["hoja"], f["fila"]
    rid = f"m-{tipo.lower()}-{ANIO}-{consec:03d}" + ("-bis" if sufijo else "")

    def persona(campo):
        k = f.get(campo + "_clave")
        if k and k in por_clave:
            pid, nombre, cargo = por_clave[k]
            return pid, nombre + (("\n" + cargo) if cargo else "")
        return "", limpio(f.get(campo))

    dir_id, dir_txt = persona("dirigido")
    fir_id, fir_txt = persona("firma")
    numero = numero_ofs(consec, sufijo) if tipo == "OFS" else re.sub(r"\s+", " ", limpio(f.get("numero")))
    if isinstance(f.get("numero"), float) and f["numero"].is_integer():
        numero = str(int(f["numero"]))
    acuse = "SI" if limpio(f.get("acuse")) in ("ü", "✓", "✔", "x", "X", "si", "SI", "Sí") else "NO"
    carpeta = f.get("carpeta")
    carpeta = str(int(carpeta)) if isinstance(carpeta, float) and carpeta.is_integer() else limpio(carpeta)
    asunto = limpio(f.get("asunto"))
    obs = limpio(f.get("observaciones"))
    estatus = ""
    if tipo == "OFS" and not asunto and not dir_txt:
        estatus = "Pendiente"
        obs = (obs + "\n" if obs else "") + "Número apartado en el minutario sin datos capturados."
        avisar(hoja, fila, "Número apartado sin datos: quedó como Pendiente", "", numero)
    return {
        "id": rid, "tipo": tipo, "anio": ANIO, "consecutivo": consec, "sufijo": sufijo, "numero": numero,
        "asunto": asunto, "dirigido_id": dir_id, "dirigido_a": dir_txt, "firma_id": fir_id, "firma": fir_txt,
        "area": re.sub(r"\s+", " ", limpio(f.get("area"))),
        "fecha": fecha(f.get("fecha"), hoja, fila, "Fecha"),
        "fecha_recepcion": fecha(f.get("fecha_recepcion"), hoja, fila, "Fecha de recepción"),
        "elaboro": f.get("elaboro_final", ""), "acuse": acuse, "carpeta": carpeta, "observaciones": obs,
        "estatus": estatus, "fecha_limite": "", "turnado_a": "", "relacionado_id": "",
        "archivo_id": "", "archivo_nombre": "", "acuse_archivo_id": "", "acuse_archivo_nombre": "",
        "motivo_cancelacion": "", "creado_por": "migración", "creado_en": AHORA,
        "modificado_por": "", "modificado_en": AHORA, "version": 1,
        "origen": f"Minutario {ANIO} · {hoja} · fila {fila}",
        "turnado_usuario": "",
        "fecha_atencion": "",
    }


def ligar(registros):
    ofs = {(r["consecutivo"], r["sufijo"]): r["id"] for r in registros if r["tipo"] == "OFS"}
    n = 0
    for r in registros:
        if r["tipo"] == "OFS":
            continue
        m = re.search(r"SAPCI/STPI/0*(\d{1,4})/" + str(ANIO), (r["asunto"] + " " + r["observaciones"]).upper())
        if m and (int(m.group(1)), "") in ofs:
            r["relacionado_id"] = ofs[(int(m.group(1)), "")]
            n += 1
    return n


def duplicados(registros):
    vistos = collections.defaultdict(list)
    for r in registros:
        if r["tipo"] != "OFS" and r["numero"]:
            vistos[(r["tipo"], r["numero"].upper())].append(r)
    for (_, num), rs in vistos.items():
        if len(rs) > 1:
            for r in rs[1:]:
                hoja, fila = r["origen"].split(" · ")[1], r["origen"].split("fila ")[1]
                avisar(hoja, int(fila), "Número/folio repetido en la misma libreta (¿capturado dos veces?)", num, f"consecutivo {r['consecutivo']}")


# ─── Config inicial ──────────────────────────────────────────────────────────
CONFIG = [
    ["encabezado_1", "Secretaría de Atención y Participación Ciudadana", "Primera línea del encabezado (pantalla y Excel)"],
    ["encabezado_2", "Subsecretaría de Territorios de Paz e Igualdad", "Segunda línea"],
    ["encabezado_3", "Dirección Ejecutiva de Gabinetes de Paz", "Tercera línea (déjala vacía si no aplica)"],
    ["plantilla_OFS", "SAPCI/STPI/{NNN}/{AAAA}", "Número oficial de los oficios salientes. {NNN} = consecutivo, {AAAA} = año"],
    ["plazo_dias", "", "Días hábiles por omisión para la fecha límite de un entrante (vacío = sin fecha límite)"],
    ["url_web", "", "Dirección pública de la app si se publica fuera de Google (Vercel). Vacío = se usa la de Google"],
    ["esquema", "1", "Versión del esquema de la base (no la cambies)"],
    ["mantenimiento", "NO", "SI = solo los administradores pueden usar el sistema (se cambia en Configuración)"],
    ["mantenimiento_msg", "", "Mensaje que ve la gente mientras hay mantenimiento"],
]


def escribir(salida, registros, directorio):
    salida.mkdir(parents=True, exist_ok=True)
    tablas = {
        "Registros": [[r[c] for c in COLS["Registros"]] for r in registros],
        "Directorio": [[d[c] for c in COLS["Directorio"]] for d in directorio],
        "Usuarios": [],
        "Bitacora": [[AHORA, "migración", "migracion", "",
                      f"Se cargaron {len(registros)} registros y {len(directorio)} personas desde el Minutario {ANIO}."]],
        "Config": CONFIG,
    }
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    cab = Font(bold=True, color="FFFFFF")
    banda = PatternFill("solid", fgColor="8F4889")
    for nombre, filas in tablas.items():
        ws = wb.create_sheet(nombre)
        cols = COLS[nombre]
        ws.append(cols)
        for c in range(1, len(cols) + 1):
            ws.cell(1, c).font = cab
            ws.cell(1, c).fill = banda
        num = NUMERICAS.get(nombre, set())
        for fila in filas:
            ws.append([v if (cols[i] in num and v != "") else ("" if v is None else str(v)) for i, v in enumerate(fila)])
        for i, col in enumerate(cols, start=1):
            if col not in num:
                for r in range(1, len(filas) + 2):
                    ws.cell(r, i).number_format = "@"
            ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = 14 if col not in ("asunto", "dirigido_a", "firma", "observaciones", "detalle", "nombre", "cargo", "valor", "descripcion") else 40
        ws.freeze_panes = "A2"
    ws = wb.create_sheet("Revisar migración")
    ws.append(["Hoja original", "Fila", "Qué pasó", "Valor original", "Quedó en la base"])
    for c in range(1, 6):
        ws.cell(1, c).font = cab
        ws.cell(1, c).fill = banda
    for f in revisar:
        ws.append(f)
    for col, w in zip("ABCDE", (26, 7, 60, 60, 40)):
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "A2"
    wb.save(salida / "Control_de_Gestion.xlsx")
    (salida / "base.json").write_text(json.dumps({k: [COLS[k]] + v for k, v in tablas.items()}, ensure_ascii=False, indent=0), encoding="utf-8")


def main():
    origen, salida = Path(sys.argv[1]), Path(sys.argv[2])
    filas = leer(origen)
    mover_notas(filas)
    directorio, por_clave = armar_directorio(filas)
    unificar_elaboro(filas)
    registros = armar(filas, por_clave)
    registros.sort(key=lambda r: (["OFS", "OFE", "OFC", "CIR", "TAR", "VOL"].index(r["tipo"]), r["consecutivo"], r["sufijo"]))
    ligados = ligar(registros)
    duplicados(registros)
    escribir(salida, registros, directorio)
    por_tipo = collections.Counter(r["tipo"] for r in registros)
    textos_originales = len({limpio(f.get(c)) for f in filas for c in ("dirigido", "firma") if limpio(f.get(c))})
    resumen = [
        f"Registros migrados: {len(registros)}  " + ", ".join(f"{k}={v}" for k, v in por_tipo.items()),
        f"Personas en el directorio: {len(directorio)} (venían {textos_originales} textos distintos)",
        f"Entrantes/otros ligados a un oficio saliente: {ligados}",
        f"Avisos para revisar: {len(revisar)}",
    ]
    for q, n in collections.Counter(re.sub(r"\(\d+ filas\)", "", a[2]).split(":")[-1].strip() for a in revisar).most_common():
        resumen.append(f"   {n:4d}  {q}")
    (salida / "resumen-migracion.txt").write_text("\n".join(resumen) + "\n", encoding="utf-8")
    print("\n".join(resumen))


if __name__ == "__main__":
    main()
