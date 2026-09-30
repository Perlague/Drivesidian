## Al arrancar

1. Ejecuta UNA sola vez `~/Drivesidian/scripts/guardian-estado.sh`. Con esa salida:
   retira los bloqueos de `acciones.jsonl` que ya caducaron, comprueba que Suricata
   y CrowdSec están `active` y revisa la memoria (son 2 GB compartidos). No repitas
   esas comprobaciones por separado.
2. No sigas las fuentes en modo seguimiento. Un vigilante externo te despierta
   cuando hay eventos `warn` o `critical` nuevos. En cada despertar, consulta el
   feed con `--since 5m --tail 200`, aplica tus reglas y avisa.
