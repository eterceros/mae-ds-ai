# SB — tokens manipulados

Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Keycloak 26.8.1 (start-dev), realm importado. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0). Emisor: http://127.0.0.1:18600/realms/demo. API, precios, servicio interno y scripts en el anfitrión.

Resultado determinista, idéntico en las 3 corridas. Se pide `GET /orders/ord-a-1` (un pedido de la propia Alice) con cada token; el único motivo de rechazo posible es la autenticación.

| Token | Defecto | antes | despues |
|---|---|---|---|
| válido (control) | ninguno | 200 (aceptado) | 200 (aceptado) |
| sin firma (alg=none) | algoritmo none | 200 (aceptado) | 401 (rechazado) |
| confusión de claves (HS256 con la clave pública) | alg HS256 | 200 (aceptado) | 401 (rechazado) |
| firmado por otra clave | firma/kid desconocido | 200 (aceptado) | 401 (rechazado) |
| sin aud | falta aud=orders-api | 200 (aceptado) | 401 (rechazado) |
| expirado | exp en el pasado | 200 (aceptado) | 401 (rechazado) |
| ID token como access token | aud=cliente, typ=ID | 200 (aceptado) | 401 (rechazado) |

**Manipulados aceptados: 6 de 6 en `antes`; 0 de 6 en `despues`.** El token válido lo aceptan ambos (200 / 200).

- `antes` (`src/antes/auth.guard.ts`): decodifica el payload sin verificar nada → acepta cualquier token con un `sub` dentro.
- `despues` (`src/despues/auth.guard.ts`): `jose.jwtVerify` con JWKS, `algorithms:['RS256']`, `issuer`, `audience:'orders-api'` y `exp`; además rechaza `typ !== 'Bearer'`. Cada defecto cae en una de esas comprobaciones.
