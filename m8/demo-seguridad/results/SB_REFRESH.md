# Anexo de SB — rotación del refresh token en Keycloak

Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Keycloak 26.8.1 (start-dev), realm importado. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0). Emisor: http://127.0.0.1:18600/realms/demo. API, precios, servicio interno y scripts en el anfitrión.

Una sola pasada (sin tiempos; el resultado depende solo de la configuración). Cliente público `demo-cli`, usuaria Alice. R1 es el refresh token del login; R2, el que Keycloak entrega al usar R1.

| «Revoke Refresh Token» del realm | 1) usar R1 (legítimo) | 2) volver a usar R1 (reuso) | 3) usar R2 |
|---|---|---|---|
| apagado (por defecto en Keycloak) | **200** (acepta) | **200** (acepta) | **200** (acepta) |
| encendido (Max reuse = 0) | **200** (acepta) | **400** (Maximum allowed refresh token reuse exceeded) | **400** (Session doesn't have required client) |
| encendido (Max reuse = 0), **control sin reuso** | **200** (acepta) | (no se reusa) | **200** (acepta) |

- **Apagado** (valor por defecto de Keycloak): R1 sigue valiendo después de usarse; la «rotación» no protege de un refresh token robado.
- **Encendido**: Keycloak rechaza el segundo uso de R1, y después del reuso el R2 ya emitido también queda rechazado.
- **Control** (encendido, sin reuso): R2 vale, así que el rechazo de R2 en la fila anterior lo causa el reuso de R1.
- El mensaje con el que Keycloak rechaza R2 («Session doesn't have required client») sugiere que, al detectar el reuso, saca a este cliente de la sesión del usuario, y con eso cae todo refresh token de esa sesión para ese cliente. Es una lectura del mensaje, no de la documentación.
- Medido en Keycloak 26.8.1 con un cliente público y direct grants; no se comprobó con otros flujos ni otras versiones, ni qué pasa con el access token vigente (sigue valiendo hasta su `exp`: es un JWT que la API valida sin consultar a Keycloak).

El realm de la demo (`keycloak/realm-export.json`) lo deja **encendido** (`revokeRefreshToken: true`, `refreshTokenMaxReuse: 0`); este script lo apaga para la primera fila y lo vuelve a encender al terminar.
