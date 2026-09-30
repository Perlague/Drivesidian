#!/usr/bin/env python3
"""
Recopila la evidencia MEDIDA de una prueba de Guardian y la imprime como JSON,
lista para pegar en «Corridas reales» de la presentación.

Se corre en la EC2, después de lanzar un escenario con guardian-pruebas.sh (que
imprime el comando exacto con las horas de ese escenario):

  ./scripts/guardian-resultados.py --escenario A --desde 2026-09-30T02:00:00Z \
      --hasta 2026-09-30T02:00:05Z --esperar 45

Qué junta:
  · Eventos de seguridad de la ventana: hora, tipo y severidad. NUNCA el
    contenido (User-Agent, detalles): es texto que controla el atacante.
  · Cuándo despertó el vigilante y lo que respondió Guardian (watch.log).
  · Las acciones que registró (acciones.jsonl) y el estado de ufw.
  · Tres tiempos: detección, vigilante y respuesta.

Por defecto tapa correos e IPs. --sin-censura los deja tal cual.
No modifica nada del sistema: solo lee.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time

HOME = os.path.expanduser("~")
DIR = os.environ.get("GUARDIAN_STATE_DIR", os.path.join(HOME, "security-audits"))
REPO = os.environ.get("GUARDIAN_REPO", os.path.join(HOME, "Drivesidian"))
MARGEN_RESPUESTA = 120  # segundos después de «hasta» en que aún se acepta un despertar/acción (--margen)


def iso(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(dt.timezone.utc)


def a_iso(d):
    return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def censurar(texto, activo):
    if not activo or not isinstance(texto, str):
        return texto
    texto = re.sub(r"([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+", r"\1***@***", texto)
    texto = re.sub(r"\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b", r"\1.\2.x.x", texto)
    return texto


def correr(cmd, cwd=None):
    try:
        return subprocess.run(cmd, shell=True, cwd=(cwd if cwd and os.path.isdir(cwd) else None), capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return ""


def leer_eventos(desde, hasta, cens):
    cmd = os.environ.get("GUARDIAN_FEED_CMD") or (
        f"docker compose logs --no-log-prefix --since {a_iso(desde - dt.timedelta(seconds=10))} "
        f"--until {a_iso(hasta + dt.timedelta(seconds=10))} server 2>/dev/null"
    )
    eventos = []
    for linea in correr(cmd, cwd=REPO).splitlines():
        if "drivesidian.security" not in linea:
            continue
        try:
            e = json.loads(linea[linea.index("{"):])
            t = iso(e["occurred_at"])
        except Exception:
            continue
        if desde - dt.timedelta(seconds=10) <= t <= hasta + dt.timedelta(seconds=10):
            eventos.append({"t": a_iso(t), "type": e.get("type"), "severity": e.get("severity")})
    eventos.sort(key=lambda x: x["t"])
    return eventos


def leer_vigilante(desde, hasta):
    """Despertares del vigilante y la respuesta de Guardian tras cada uno."""
    ruta = os.path.join(DIR, "watch.log")
    if not os.path.exists(ruta):
        return []
    limite = hasta + dt.timedelta(seconds=MARGEN_RESPUESTA)
    bloques, actual = [], None
    marca = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ) (.*)$")
    for linea in open(ruta, encoding="utf-8", errors="replace").read().splitlines():
        m = marca.match(linea)
        if m and "despertando a Guardian" in m.group(2):
            actual = {"t": m.group(1), "detalle": m.group(2), "respuesta": []}
            bloques.append(actual)
        elif m:
            actual = None  # otra línea con marca de tiempo (p. ej. un error): corta el bloque
        elif actual is not None:
            actual["respuesta"].append(linea)
    return [b for b in bloques if desde <= iso(b["t"]) <= limite]


def leer_acciones(desde, hasta, cens):
    ruta = os.path.join(DIR, "acciones.jsonl")
    if not os.path.exists(ruta):
        return []
    limite = hasta + dt.timedelta(seconds=MARGEN_RESPUESTA)
    acciones = []
    for linea in open(ruta, encoding="utf-8", errors="replace"):
        try:
            a = json.loads(linea)
            t = iso(a["ts"])
        except Exception:
            continue
        if desde - dt.timedelta(seconds=5) <= t <= limite:
            acciones.append({k: censurar(a.get(k), cens) for k in ("ts", "accion", "objetivo", "motivo", "caduca", "revertido")})
    return acciones


def estado_ufw():
    salida = os.environ.get("GUARDIAN_UFW_CMD")
    if salida is not None:
        primera = correr(salida).splitlines()
        return {"estado": (primera[0] if primera else None), "reglas_deny": None}
    numerado = correr("sudo -n ufw status numbered 2>/dev/null")
    if not numerado.strip():
        return {"estado": None, "reglas_deny": None}
    primera = numerado.splitlines()[0]
    return {"estado": primera, "reglas_deny": sum(1 for l in numerado.splitlines() if "DENY" in l.upper())}


def main():
    global MARGEN_RESPUESTA
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--escenario", required=True, choices=list("ABCDE"))
    ap.add_argument("--desde", required=True, help="inicio del ataque, UTC (ISO 8601)")
    ap.add_argument("--hasta", help="fin del ataque, UTC (por omisión, ahora)")
    ap.add_argument("--esperar", type=int, default=0, help="segundos a esperar la respuesta de Guardian antes de leer")
    ap.add_argument("--margen", type=int, default=MARGEN_RESPUESTA, help="segundos tras --hasta en que se acepta un despertar o una acción")
    ap.add_argument("--sin-censura", action="store_true")
    ap.add_argument("--nota", default="")
    a = ap.parse_args()

    MARGEN_RESPUESTA = a.margen
    desde = iso(a.desde)
    hasta = iso(a.hasta) if a.hasta else dt.datetime.now(dt.timezone.utc)
    cens = not a.sin_censura
    if a.esperar > 0:
        print(f"Esperando {a.esperar} s a que Guardian responda…", file=sys.stderr)
        time.sleep(a.esperar)

    eventos = leer_eventos(desde, hasta, cens)
    despertares = leer_vigilante(desde, hasta)
    acciones = leer_acciones(desde, hasta, cens)

    graves = [e for e in eventos if e["severity"] in ("critical", "warn")]
    crit = [e for e in graves if e["severity"] == "critical"]
    disparador = (crit or graves or [None])[0]

    def seg(a_, b_):
        return round((iso(b_) - iso(a_)).total_seconds(), 1) if a_ and b_ else None

    t_ev = disparador["t"] if disparador else None
    primer_despertar = next((d["t"] for d in despertares if t_ev is None or iso(d["t"]) >= iso(t_ev)), None)
    primera_accion = acciones[0]["ts"] if acciones else None
    tipos = {}
    for e in eventos:
        clave = f'{e["type"]} ({e["severity"]})'
        tipos[clave] = tipos.get(clave, 0) + 1

    respuesta = "\n".join(
        censurar("\n".join(d["respuesta"]).strip(), cens) for d in despertares if d["respuesta"]
    )[:4000]

    corrida = {
        "v": 1,
        "escenario": a.escenario,
        "desde": a_iso(desde),
        "hasta": a_iso(hasta),
        "generado": a_iso(dt.datetime.now(dt.timezone.utc)),
        "censurado": cens,
        "nota": a.nota,
        "eventos": eventos,
        "tipos": tipos,
        "disparador": disparador,
        "despertares": [d["t"] for d in despertares],
        "respuesta": respuesta,
        "acciones": acciones,
        "ufw": estado_ufw(),
        "metricas": {
            "deteccion_s": seg(a_iso(desde), t_ev),
            "vigilante_s": seg(t_ev, primer_despertar),
            "respuesta_s": seg(t_ev, primera_accion),
        },
    }

    os.makedirs(os.path.join(DIR, "corridas"), exist_ok=True)
    archivo = os.path.join(DIR, "corridas", f'{a.escenario}-{a_iso(desde).replace(":", "")}.json')
    with open(archivo, "w", encoding="utf-8") as f:
        json.dump(corrida, f, ensure_ascii=False, indent=2)

    m = corrida["metricas"]
    print(f"Escenario {a.escenario}: {len(eventos)} eventos ({len(graves)} warn/critical), "
          f"{len(despertares)} despertar(es), {len(acciones)} acción(es). "
          f"Detección {m['deteccion_s']} s · vigilante {m['vigilante_s']} s · respuesta {m['respuesta_s']} s.", file=sys.stderr)
    print(f"Guardado en {archivo}", file=sys.stderr)
    if not despertares:
        print("AVISO: el vigilante no despertó a Guardian en esa ventana (¿hay warn/critical? "
              "¿está corriendo el timer? ./scripts/guardian-watch-install.sh estado).", file=sys.stderr)
    print("===CORRIDA-JSON===")
    print(json.dumps(corrida, ensure_ascii=False, separators=(",", ":")))
    print("===FIN===")


if __name__ == "__main__":
    main()
