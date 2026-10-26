# Antes y después: qué se corrigió y cuánto se midió

El código está separado en dos carpetas para leer lado a lado la mala práctica y su corrección:

- [`src/antes/`](src/antes/): autenticación rota (decodifica el JWT sin verificar), sin comprobar el dueño del recurso (BOLA), límite por IP, descarga cualquier URL (SSRF) y llama a `precios` sin autenticarse.
- [`src/despues/`](src/despues/): validación del JWT con JWKS, algoritmo fijo, `iss`, `aud` y `exp`; comprobación de dueño; límite por `sub`; validación de la URL de destino; y client credentials hacia `precios`. Cada corrección está marcada en el código con `// CORRECCIÓN: …` y su porqué.
- [`src/sim/`](src/sim/): el servicio `precios` (con validación o sin ella) y un servicio interno simulado para SSRF.

Las líneas son las de los archivos actuales. Las cifras son las de [`results/`](results/) (conteos exactos; donde hay repeticiones, 3 corridas deterministas).

## SA. BOLA — acceso a objetos de otro usuario (OWASP API1:2023)

| Problema | Línea en `antes/` | Cambio en `despues/` | Cifra medida |
|---|---|---|---|
| El controlador devuelve el pedido sin mirar de quién es | [`antes/orders.controller.ts:16-18`](src/antes/orders.controller.ts) (`get`) | [`despues/orders.controller.ts:22`](src/despues/orders.controller.ts): `if (!o || o.owner !== req.principal.sub) 404` | Alice lee **5 de 5** pedidos de Bob en `antes`; **0 de 5** en `despues` ([SA](results/SA_BOLA.md)) |
| Lo mismo al modificar | [`antes/orders.controller.ts:24-25`](src/antes/orders.controller.ts) (`patch`) | [`despues/orders.controller.ts:30`](src/despues/orders.controller.ts): misma comprobación antes de `setItem` | Alice modifica **5 de 5** en `antes`; **0 de 5** en `despues` |
| 403 revela que el recurso existe (enumeración) | — | [`despues/orders.controller.ts:22,30`](src/despues/orders.controller.ts): se responde **404**, no 403 | la respuesta es idéntica exista o no el pedido de otro; no medido como cifra |
| El dueño se identifica por un dato que puede cambiar | — | [`src/lib/orders.ts`](src/lib/orders.ts) guarda como `owner` el `sub` (id del usuario, fijado en [`realm-export.json`](keycloak/realm-export.json)) y el controlador compara con `principal.sub`, no con `preferred_username` (OIDC Core §5.7: no es único ni estable) | mismas cifras que con el nombre de usuario (5/5 → 0/5); el cambio no se ve en la cifra sino en lo que pasa si alguien renombra su usuario (no medido) |

## SB. Tokens manipulados — autenticación rota (OWASP API2:2023)

| Problema | Línea en `antes/` | Cambio en `despues/` | Cifra medida |
|---|---|---|---|
| Se decodifica el JWT sin verificar NADA | [`antes/auth.guard.ts:17`](src/antes/auth.guard.ts) (`JSON.parse` del payload) | [`despues/auth.guard.ts:21`](src/despues/auth.guard.ts): `jose.jwtVerify(token, JWKS, …)` | **6 de 6** manipulados aceptados en `antes`; **0 de 6** en `despues` ([SB](results/SB_TOKENS.md)) |
| Se confía en el `alg` del token (alg=none, confusión de claves) | — (no mira la cabecera) | [`despues/auth.guard.ts:24`](src/despues/auth.guard.ts): `algorithms: ['RS256']` | el de alg=none y el de confusión HS256: 200 en `antes`, **401** en `despues` |
| No se comprueba quién firmó | — | [`despues/auth.guard.ts:10`](src/despues/auth.guard.ts): `createRemoteJWKSet` (firma contra el JWKS del emisor) | el firmado por otra clave: 200 en `antes`, **401** en `despues` |
| No se comprueba `iss` ni `aud` | — | [`despues/auth.guard.ts:25-26`](src/despues/auth.guard.ts): `issuer`, `audience: 'orders-api'` | el "sin aud": 200 en `antes`, **401** en `despues` |
| No se comprueba `exp` | — | `jwtVerify` valida `exp` (con 5 s de `clockTolerance`) | el expirado: 200 en `antes`, **401** en `despues` |
| Se acepta un ID token como access token | — | [`despues/auth.guard.ts:34`](src/despues/auth.guard.ts): rechaza `typ !== 'Bearer'` (y el `aud` del ID token ya es el cliente) | el ID token: 200 en `antes`, **401** en `despues` |

### Configuración del realm (no es código de `antes`/`despues`)

| Problema | Por defecto | En [`realm-export.json`](keycloak/realm-export.json) | Cifra medida |
|---|---|---|---|
| Un refresh token ya usado sigue valiendo | Keycloak trae **apagado** «Revoke Refresh Token» | `revokeRefreshToken: true`, `refreshTokenMaxReuse: 0` | apagado: el reuso de R1 da **200**; encendido: **400**, y el R2 legítimo emitido antes del reuso también **400** (control sin reuso: 200) ([anexo de SB](results/SB_REFRESH.md)) |
| `redirect_uri` con comodín (el código puede ir a otra ruta del mismo origen) | — | `spa-demo` registra una sola URI exacta: `http://127.0.0.1:18610/callback` | no medido (el flujo con navegador no se recorre) |

## SC. Límite por identidad

| Problema | Línea en `antes/` | Cambio en `despues/` | Cifra medida |
|---|---|---|---|
| El límite se cuenta por IP: dos usuarios tras la misma IP comparten cupo | [`antes/ratelimit.guard.ts:15`](src/antes/ratelimit.guard.ts): `key = req.ip` | [`despues/ratelimit.guard.ts:16`](src/despues/ratelimit.guard.ts): `key = req.principal.sub` | Bob recibe **10 de 10** `429` por culpa de Alice en `antes`; **0 de 10** en `despues` ([SC](results/SC_RATELIMIT.md)) |

El algoritmo de ventana fija es el mismo en ambos (visto en S05/S06); solo cambia la clave.

## SD. SSRF — descargar una URL del usuario (OWASP API7:2023)

| Problema | Línea en `antes/` | Cambio en `despues/` | Cifra medida |
|---|---|---|---|
| Se descarga cualquier URL del usuario | [`antes/orders.controller.ts:55-56`](src/antes/orders.controller.ts) (`fetch(url)` directo) | [`despues/orders.controller.ts:62`](src/despues/orders.controller.ts): `await assertSafeUrl(url)` antes de pedir | secreto interno filtrado por **4 destinos** en `antes` (loopback, `localhost`, `0.0.0.0`, `[::ffff:127.0.0.1]`); **0** en `despues` ([SD](results/SD_SSRF.md)) |
| No se valida el esquema | — | [`despues/safe-url.ts:39`](src/despues/safe-url.ts): solo `http`/`https` | `file://` bloqueado en `despues` |
| Un nombre puede apuntar a una IP interna | — | [`despues/safe-url.ts:41`](src/despues/safe-url.ts): resuelve el host a IP antes de decidir | `localhost` y un dominio que resuelva a loopback caen igual |
| No se bloquean loopback/privadas/metadatos | — | [`despues/safe-url.ts:9-32`](src/despues/safe-url.ts) y la comprobación en la línea 44: `BlockList` con loopback, privadas, CGNAT, 169.254/16, única-local y enlace-local IPv6, NAT64 y reservados | **8 de 8** destinos internos bloqueados; el público **no** (pasa la validación) |
| «Esta red»: `0.0.0.0` y `::` llegan a la máquina local | — | [`despues/safe-url.ts:13,26`](src/despues/safe-url.ts): `0.0.0.0/8` y `::` (`// CORRECCIÓN:`, agregados tras la revisión) | en `antes`, `http://0.0.0.0:18630/` filtró el secreto en esta máquina (Windows); `[::]` no conectó porque el servicio escucha solo en IPv4. La lista anterior de `despues` no tenía ninguno de los dos: `BlockList.check('0.0.0.0')` daba `false`, así que esa URL pasaba la validación y llegaba al secreto (comprobado aparte, no con el script). Ahora los dos: bloqueado (400) |
| IPv4 escrita como IPv6 (`[::ffff:127.0.0.1]`) | — | sin cambio: `BlockList` compara las IPv4 mapeadas contra las reglas IPv4 | filtró el secreto en `antes`; bloqueada en `despues` |

## SE. Autenticación entre servicios (api → precios)

| Problema | Línea en `antes/` | Cambio en `despues/` | Cifra medida |
|---|---|---|---|
| `api` llama a `precios` sin autenticarse | [`antes/precios.client.ts:6`](src/antes/precios.client.ts): `fetch` sin `Authorization` | [`despues/precios.client.ts:9-18,27-30`](src/despues/precios.client.ts): pide token `client_credentials` (cliente `api`) y lo manda | `precios/despues` rechaza "sin token" (**401**) y lo acepta con el token de servicio (**200**) ([SE](results/SE_SERVICIOS.md)) |
| `precios` sirve a cualquiera | [`src/sim/precios.ts`](src/sim/precios.ts) con `MODE=antes` (acepta todo) | `MODE=despues`: `jwtVerify` con `aud=precios-api` | `precios/antes` acepta las 3 llamadas; `precios/despues` solo el token de servicio |
| Propagar el token del usuario a otro servicio | — | el token del usuario tiene `aud=orders-api`, no vale para `precios` | el token de usuario contra `precios/despues`: **401** (aud equivocado) |
