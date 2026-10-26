# SF — Qué encontró la IA (se completa en vivo)

Revisión de `/security-review` sobre la rama `revision` del repositorio temporal `%TEMP%\s12-ia-revision`, que arma [`preparar-revision.mjs`](preparar-revision.mjs) con el código de `src/antes/` sin comentarios. Rellenar en clase.

Fecha: ____  ·  Versión de Claude Code / modelo: ____  ·  Duración de la revisión: ____

| Fallo (el que medimos) | Archivo en el repositorio temporal | ¿Lo encontró la IA? | Dónde / nota de la IA | Nuestra cifra (results/) |
|---|---|---|---|---|
| SA — BOLA (no comprueba el dueño) | `src/orders.controller.ts` | | | Alice lee 5/5 y modifica 5/5 pedidos de Bob |
| SB — JWT sin verificar (firma/alg/iss/aud/exp) | `src/auth.guard.ts` | | | 6/6 tokens manipulados aceptados |
| SC — límite por IP en vez de por identidad | `src/ratelimit.guard.ts` | | | Bob 10/10 bloqueado por culpa de Alice |
| SD — SSRF (descarga cualquier URL) | `src/orders.controller.ts` (`POST /fetch`) | | | secreto interno filtrado por 4 de 8 destinos internos |
| SE — api llama a precios sin autenticarse | `src/precios.client.ts` | | | precios acepta sin token |

## Falsos positivos / cosas que señaló de más

| Lo que señaló la IA | ¿Es un fallo real? | Comentario |
|---|---|---|
| | | |

## Lo que NO encontró

-

## Conclusión (una línea)

La IA encontró ____ de 5 fallos medidos; _____.
