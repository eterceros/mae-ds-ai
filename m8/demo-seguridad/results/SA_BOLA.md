# SA — BOLA (acceso a objetos de otro usuario)

Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Keycloak 26.8.1 (start-dev), realm importado. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0). Emisor: http://127.0.0.1:18600/realms/demo. API, precios, servicio interno y scripts en el anfitrión.

Alice usa su token válido (cliente `demo-cli`) para pedir y modificar los 5 pedidos de Bob (`ord-b-1..5`). 3 corridas; el resultado es determinista. Control: Alice sí puede ver su propio pedido (`ord-a-1`). El dueño de cada pedido es el `sub` del usuario (su id en Keycloak, fijado en el realm importado: Alice `00000000-0000-4000-8000-0000000a11ce`, Bob `00000000-0000-4000-8000-000000000b0b`); el script comprueba que el token de Alice lleve ese `sub`.

| Versión | Pedidos de Bob leídos por Alice | Pedidos de Bob modificados por Alice | Alice ve lo suyo |
|---|---|---|---|
| **antes** (sin comprobar dueño) | 5 de 5 | 5 de 5 | sí |
| **despues** (`o.owner === principal.sub`, 404) | 0 de 5 | 0 de 5 | sí |

- **antes**: 5, 5, 5 leídos y 5, 5, 5 modificados (de 5) por corrida.
- **despues**: 0, 0, 0 leídos y 0, 0, 0 modificados (de 5) por corrida.

La corrección está en `src/despues/orders.controller.ts` (`// CORRECCIÓN:` en `get` y `patch`): se comprueba que el dueño del pedido sea el `sub` del token (no `preferred_username`, que no es único ni estable) y, si no, se responde **404** (no 403) para no revelar que existe.
