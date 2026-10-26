# SE — autenticación entre servicios (api -> precios)

Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Keycloak 26.8.1 (start-dev), realm importado. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0). Emisor: http://127.0.0.1:18600/realms/demo. API, precios, servicio interno y scripts en el anfitrión.

## Borde de precios: qué acepta según el token

| Llamada a precios | precios **antes** (sin comprobar) | precios **despues** (valida aud=precios-api) |
|---|---|---|
| sin token | 200 (aceptado) | 401 (rechazado) |
| token de usuario (aud=orders-api) | 200 (aceptado) | 401 (rechazado) |
| token de servicio (client credentials, aud=precios-api) | 200 (aceptado) | 200 (aceptado) |

precios/despues rechaza el token del usuario aunque sea válido: no va dirigido a precios (su `aud` es `orders-api`). Solo acepta el token de servicio del cliente `api`.

## Extremo a extremo (api -> precios/despues)

| Versión de api | api responde | precios respondió |
|---|---|---|
| **antes** (no manda token a precios) | 200 | 401 (rechazado) |
| **despues** (client credentials) | 200 | 200 (aceptado) |

Corrección en `src/despues/precios.client.ts`: api pide su propio token con `grant_type=client_credentials` (cliente confidencial `api`, `aud=precios-api`) y lo manda en `Authorization`. No propaga el token del usuario (que no va dirigido a precios).
