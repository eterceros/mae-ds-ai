# Seguridad de APIs (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 12

> **Es una demostración del docente.** No hay nada que entregar. Se publica para repasarla y reproducirla después de la clase. Es **material defensivo**: todos los "ataques" (tokens fabricados, BOLA, SSRF) se hacen contra esta misma demo local; no apuntan a ningún sistema ajeno. No necesita cuentas ni claves de ningún servicio real: Keycloak corre en local en modo `start-dev` con un realm de juguete.

## Qué es

Una API mínima de pedidos (`/orders/{id}`) en NestJS, protegida con OAuth 2 / OIDC usando **Keycloak 26.8.1** local, en versión ingenua (`antes/`) y corregida (`despues/`), con cinco cosas que suelen salir mal medidas con conteos exactos:

- **SA. BOLA** (OWASP API1): estar autenticado no es estar autorizado. Alice, con su token válido, lee y modifica los pedidos de Bob. Corregido: el recurso tiene que ser de quien lo pide, comparando con el `sub` del token (no con el nombre de usuario).
- **SB. Tokens manipulados** (OWASP API2): seis tokens con un defecto cada uno (sin firma, confusión de claves, firmado por otra clave, sin `aud`, expirado, un ID token usado como access token). Corregido: `jose` con JWKS, algoritmo fijo, `iss`, `aud` y `exp`. Anexo: reuso de un refresh token con «Revoke Refresh Token» apagado y encendido.
- **SC. Límite por identidad**: dos usuarios tras la misma IP. Con el límite por IP, uno bloquea al otro; por `sub` del token, no.
- **SD. SSRF** (OWASP API7): un endpoint que descarga una URL del usuario llega a un servicio interno. Corregido: validar esquema y destino (bloquear loopback, `0.0.0.0` y `::`, privadas, metadatos y reservadas).
- **SE. Entre servicios**: `api` llama a `precios` sin autenticarse. Corregido: client credentials; `precios` rechaza las llamadas sin un token válido dirigido a él.

Además, un fragmento de **Spring Security 7** como resource server ([`spring/`](spring/), no se ejecuta ni se mide) y una carpeta [`ia/`](ia/) para la demo de `/security-review` (SF).

## Las piezas

| Pieza | Dónde | Notas |
|---|---|---|
| Keycloak 26.8.1 | `127.0.0.1:18600` | `start-dev`, realm `demo` importado de [`keycloak/realm-export.json`](keycloak/realm-export.json); consola admin `admin`/`admin` |
| API NestJS (`antes`/`despues`) | `127.0.0.1:18610` | `MODE=antes\|despues`; compilada a `dist/` (NestJS usa decoradores, que el *type stripping* de Node no transforma) |
| Servicio `precios` | `127.0.0.1:18620` | [`src/sim/precios.ts`](src/sim/precios.ts); `MODE=antes` acepta todo, `MODE=despues` valida `aud=precios-api` |
| Servicio interno simulado | `127.0.0.1:18630` | [`src/sim/internal.ts`](src/sim/internal.ts); el "secreto" que la SSRF intenta filtrar |
| Scripts de medición | proceso | [`scripts/`](scripts/); lanzan la API/servicios, fabrican los tokens y cuentan |

Todo escucha solo en `127.0.0.1` y en el rango 18600-18649. Nombre de proyecto Compose: `s12-sec`.

### El realm

| Cliente | Tipo | Para qué |
|---|---|---|
| `spa-demo` | público, **PKCE S256**, authorization code | el del dibujo del flujo (no se recorre con navegador en los scripts) |
| `demo-cli` | público, direct access grants | los scripts piden tokens reales de Alice y Bob sin navegador |
| `api` | confidencial, service accounts | client credentials para `api → precios` (`aud=precios-api`) |
| `demo-noaud` | público, direct grants, sin audience mapper | SB: emite un token válido **sin** `aud=orders-api` |
| `demo-short` | público, direct grants, token de 1 s | SB: emite un token válido que caduca enseguida |

`spa-demo` registra **una sola** `redirect_uri` exacta (`http://127.0.0.1:18610/callback`), sin comodines.

Usuarios: **alice** (`alice123`) y **bob** (`bob123`), ambos con el rol `customer`. Sus `id` están fijados en el realm (Alice `00000000-0000-4000-8000-0000000a11ce`, Bob `00000000-0000-4000-8000-000000000b0b`), así que el `sub` de sus tokens es el mismo en cada importación. Los pedidos (`ord-a-*` de Alice, `ord-b-*` de Bob) están en [`src/lib/orders.ts`](src/lib/orders.ts) y guardan como dueño ese `sub`.

**Rotación del refresh token.** Keycloak trae **apagada** la opción «Revoke Refresh Token»: con ella apagada, un refresh token ya usado sigue valiendo. El realm de la demo la **enciende** (`revokeRefreshToken: true`, `refreshTokenMaxReuse: 0`). Medido ([anexo de SB](results/SB_REFRESH.md)): apagada, el segundo uso de R1 da 200; encendida, da 400 y además el R2 que se había emitido deja de valer (400), mientras que sin reuso R2 sí vale. Que Keycloak invalide así toda la «familia» es lo que se midió en 26.8.1 con este cliente, no una garantía documentada que hayamos verificado.

## El código: antes y después

| Carpeta | Qué hay |
|---|---|
| [`src/antes/`](src/antes/) | guard que decodifica el JWT sin verificar; controlador que no comprueba el dueño; límite por IP; `fetch` de cualquier URL; cliente de `precios` sin token |
| [`src/despues/`](src/despues/) | guard con `jose` + JWKS + algoritmo fijo + `iss`/`aud`/`exp`; comprobación de dueño (404); límite por `sub`; validación de la URL; client credentials. Cada corrección lleva `// CORRECCIÓN: …` |

[`DIFERENCIAS.md`](DIFERENCIAS.md) cruza problema → línea en `antes/` → cambio en `despues/` → cifra medida.

## Requisitos

- Docker Desktop con Compose (probado con motor 29.9.2 y Compose 5.6.0).
- Node.js 24 o superior (probado con 24.19.0).

## Cómo correrlo

```
docker compose up -d --wait        # Keycloak con el realm importado (~30 s la primera vez)
npm install
npm run build                      # compila la API NestJS a dist/
npm run all                        # corre SA-SE y deja los resultados en results/
docker compose down -v             # borra el contenedor y el realm en memoria
```

Cada escenario por separado: `npm run sa`, `npm run sb`, `npm run sb-refresh`, `npm run sc`, `npm run sd`, `npm run se`. Con `SMOKE=1` (y, p. ej., `RUNS=1`) escriben en `results/raw/` sin pisar los resultados de referencia.

A mano, levantando la API y pidiendo un token:

```
# terminal 1: la API en modo inseguro (o MODE=despues)
MODE=antes npm run api

# terminal 2: un token real de Alice y una petición a un pedido de Bob
B=http://127.0.0.1:18600/realms/demo/protocol/openid-connect
AT=$(curl -s -X POST $B/token -d grant_type=password -d client_id=demo-cli \
      -d username=alice -d password=alice123 | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -i -H "authorization: Bearer $AT" http://127.0.0.1:18610/orders/ord-b-1
```

En `antes` eso devuelve **200** con el pedido de Bob (BOLA); en `despues`, **404**. En Git Bash, antepongan `MSYS_NO_PATHCONV=1` a los `docker compose`.

## Resultados de referencia

Medidos el 26 de octubre de 2026 (Intel Core i9-12900H, 64 GB, Windows 11, Docker Desktop con WSL2, motor 29.9.2; Keycloak 26.8.1, Node 24.19.0), conteos exactos:

- **SA (BOLA):** Alice lee **5/5** y modifica **5/5** pedidos de Bob en `antes`; **0/5 y 0/5** en `despues` (404), y sigue viendo lo suyo.
- **SB (tokens):** **6/6** tokens manipulados aceptados en `antes`; **0/6** en `despues`; el válido, 200 en ambos. Anexo (refresh token): reuso de R1 aceptado (200) con la revocación apagada; rechazado (400) con ella encendida, y R2 rechazado también (400).
- **SC (límite):** Bob recibe **10/10** `429` por culpa de Alice con el límite por IP; **0/10** con el límite por `sub`.
- **SD (SSRF):** el secreto interno se filtra por **4** de 8 destinos internos en `antes` (IP de loopback, `localhost`, `0.0.0.0` y `[::ffff:127.0.0.1]`; 0 bloqueos); en `despues`, **0** filtrados y **8/8** destinos internos bloqueados, sin bloquear el público. En esta máquina (Windows) `[::]` no llega porque el servicio interno escucha solo en IPv4; en Linux o macOS el resultado de `antes` puede variar.
- **SE (entre servicios):** `precios/antes` acepta las 3 llamadas; `precios/despues` solo el token de servicio (sin token y token de usuario: 401).

Ver [`results/ESCENARIOS.md`](results/ESCENARIOS.md): resumen, mecanismo de cada cifra y «Qué no se midió».
