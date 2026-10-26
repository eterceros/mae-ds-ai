# SC — límite por identidad (IP vs sub)

Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Keycloak 26.8.1 (start-dev), realm importado. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0). Emisor: http://127.0.0.1:18600/realms/demo. API, precios, servicio interno y scripts en el anfitrión.

Alice agota su cupo (20 peticiones a `GET /ping`) y después Bob hace 10, todos desde la misma IP (127.0.0.1). Determinista en las 3 corridas.

| Versión | Alice OK | Bob OK | Bob bloqueado (429) |
|---|---|---|---|
| **antes** (clave = IP) | 20/20 | 0/10 | **10/10** |
| **despues** (clave = sub del token) | 20/20 | 10/10 | **0/10** |

Con la clave por IP, Alice consume el cupo compartido y Bob recibe 10 de 10 `429` sin haber hecho nada: un usuario legítimo bloquea a otro. Con la clave por `sub`, cada uno tiene su propio cupo y Bob no se ve afectado (0/10).

Corrección en `src/despues/ratelimit.guard.ts` (`// CORRECCIÓN:`): la clave es `principal.sub`, no `req.ip`. El algoritmo de ventana fija no cambia (es de S05/S06).
