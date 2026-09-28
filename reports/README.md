# Reportes

Evidencia de pruebas y seguridad. Se regeneran con los comandos de cada
sección; los de `pruebas/` los reescribe `pnpm test` en cada corrida.

## pruebas/

| Archivo | Qué es |
|---|---|
| `servidor-resumen.txt` | Salida de `pnpm test` en `server/`: cada prueba y la tabla de cobertura |
| `servidor-junit.xml` | Los mismos resultados en formato JUnit |
| `servidor-lcov.info` | Cobertura por línea, con rutas desde la raíz del repositorio. La importa SonarQube |
| `agente-*` | Lo mismo para `agent/` |

Resultado: **263 pruebas, todas aprobadas**. Cobertura de líneas: servidor
98.7%, agente 96.2%. La corrida falla si baja de 80% de líneas, 80% de
funciones o 70% de ramas.

```bash
cd server && pnpm run test:db && pnpm test
cd agent && pnpm test
```

## seguridad/

| Archivo | Qué es |
|---|---|
| `dependencias-server.txt` · `dependencias-agent.txt` | `pnpm audit`: vulnerabilidades conocidas en las dependencias. Resultado: ninguna |
| `zap-1-pasivo-inicial.*` | OWASP ZAP, escaneo pasivo con sesión iniciada. 0 fallos, 4 hallazgos de riesgo bajo (cabeceras ausentes) |
| `zap-2-pasivo-tras-correccion.*` | El mismo escaneo después de añadir las cabeceras. 0 fallos, 0 hallazgos de riesgo bajo |
| `zap-3-activo.*` | OWASP ZAP, escaneo activo: intenta inyección SQL, XSS, *path traversal*, inyección de comandos y de plantillas, entre otros. 0 fallos, 140 reglas aprobadas |

Los escaneos se hicieron contra la aplicación levantada en local sobre la base
de pruebas, con un usuario de prueba y su sesión iniciada, para que ZAP
recorriera también las páginas privadas.
