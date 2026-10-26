# Resultados de la demo de seguridad (SA-SE)

Medido el 26 de octubre de 2026 en un portátil: Intel Core i9-12900H (20 hilos lógicos), 64 GB de RAM, Windows 11 (10.0.26200), Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0). Keycloak 26.8.1 en `start-dev` con el realm `demo` importado (`quay.io/keycloak/keycloak:26.8.1`). API NestJS 11 (compilada a CommonJS), `jose` 6.1.0, Node 24.19.0. **La API, el servicio `precios`, el servicio interno simulado y los scripts corren en el anfitrión**; así el `iss` del token y la URL del JWKS son los mismos que valida la API (`http://127.0.0.1:18600/realms/demo`), sin trucos de red de Docker.

Los conteos son exactos (respuestas HTTP contadas, no estimaciones) y deterministas: donde hay repeticiones (SA, SB, SC) las 3 corridas dan lo mismo y el script aborta si alguna difiere. SD, SE y el anexo de SB (refresh token) no tienen tiempos, así que una pasada basta. Remedido tras la revisión del 26 de octubre: SSRF con 3 destinos nuevos (`0.0.0.0`, `[::]`, `[::ffff:127.0.0.1]`) y la lista de bloqueo ampliada; dueño por `sub`; anexo del refresh token. El código de cada caso está en `src/antes/` (mala práctica) o `src/despues/` (corregido); [`../DIFERENCIAS.md`](../DIFERENCIAS.md) los cruza línea por línea.

> **Material defensivo.** Todos los "ataques" (tokens fabricados, BOLA, SSRF) se hacen contra esta misma demo local. No apuntan a ningún sistema ajeno.

## Resumen

| Escenario | Qué se hizo | antes | despues |
|---|---|---|---|
| **SA** BOLA ([detalle](SA_BOLA.md)) | Alice pide y modifica los 5 pedidos de Bob con su token válido | **5/5 leídos, 5/5 modificados** | **0/5 y 0/5** (404, dueño comparado por `sub`); Alice sigue viendo lo suyo |
| **SB** tokens manipulados ([detalle](SB_TOKENS.md)) | 6 tokens con un defecto cada uno + 1 válido de control, contra `/orders/ord-a-1` | **6/6 manipulados aceptados** | **0/6 aceptados**; el válido, 200 en ambos |
| anexo de SB: refresh token ([detalle](SB_REFRESH.md)) | usar R1, reusar R1, usar R2; «Revoke Refresh Token» apagado y encendido | apagado: reuso de R1 **200** | encendido: reuso de R1 **400** y R2 **400** (control sin reuso: R2 200) |
| **SC** límite por identidad ([detalle](SC_RATELIMIT.md)) | Alice agota su cupo (20) y Bob hace 10, misma IP | Bob **10/10 bloqueado** (429) por culpa de Alice | Bob **0/10 bloqueado** |
| **SD** SSRF ([detalle](SD_SSRF.md)) | `POST /fetch {url}` con 8 destinos internos y 1 público | **secreto interno filtrado** (4 destinos), 0 bloqueos | **0 filtrado**, 8/8 internos bloqueados; el público no se bloquea |
| **SE** entre servicios ([detalle](SE_SERVICIOS.md)) | llamadas a `precios` sin token / token de usuario / token de servicio | precios acepta **las tres** | precios acepta **solo el token de servicio** (sin token y token de usuario: 401) |

## SA. BOLA ([detalle](SA_BOLA.md))

**Mecanismo.** Alice se autentica de verdad (token válido del cliente `demo-cli`) y pide `GET /orders/ord-b-1..5`, que son de Bob. En `antes` el controlador devuelve el pedido sin mirar de quién es: Alice lee los 5 y, con `PATCH`, los renombra. Es BOLA (OWASP API1): autenticado no es autorizado. En `despues`, cada lectura/escritura comprueba `o.owner === principal.sub` (el `sub` es el id del usuario en Keycloak, fijado en el realm; no se usa `preferred_username`, que no es único ni estable) y responde **404** (no 403, para no revelar que el pedido existe): 0 de 5 en las dos operaciones. El control confirma que la corrección no rompe lo legítimo: Alice sigue viendo su propio `ord-a-1`.

## SB. Tokens manipulados ([detalle](SB_TOKENS.md))

**Mecanismo.** Se piden a `GET /orders/ord-a-1` (un pedido de la propia Alice), así que el único motivo de rechazo posible es la autenticación. Cada token tiene **un** defecto, para que se vea qué comprobación lo atrapa:

| Token | Defecto | Qué comprobación de `despues` lo rechaza |
|---|---|---|
| sin firma (alg=none) | algoritmo `none` | `algorithms:['RS256']` (jose no verifica fuera de la lista) |
| confusión de claves | HS256 con la clave pública RSA como secreto | `algorithms:['RS256']` |
| firmado por otra clave | par RSA del atacante, `kid` desconocido | la firma no valida contra el JWKS |
| sin aud | falta `aud=orders-api` (emitido por `demo-noaud`) | `audience:'orders-api'` |
| expirado | `exp` en el pasado (cliente `demo-short`, vida 1 s) | `exp` (se espera más que los 5 s de `clockTolerance`) |
| ID token como access token | `aud=cliente`, `typ=ID` | `audience` y la comprobación `typ !== 'Bearer'` |

`antes` (decodifica el payload sin verificar nada) acepta los **6**; `despues` acepta **0**. El token válido lo aceptan los dos (200/200). Los dos primeros son el CVE clásico de "la librería acepta el algoritmo que diga el token"; el de "ID token como access token" es la regla "el backend nunca acepta un ID token como access token".

## Anexo de SB. Rotación del refresh token ([detalle](SB_REFRESH.md))

**Mecanismo.** Alice hace login (R1), usa R1 una vez (Keycloak le da R2), alguien vuelve a usar R1 y, por último, Alice usa R2. Con «Revoke Refresh Token» **apagado** (el valor por defecto de Keycloak) las tres peticiones dan 200: un refresh token robado sigue sirviendo aunque el dueño ya lo haya usado. **Encendido** (`refreshTokenMaxReuse: 0`, como queda en el realm de la demo), el reuso de R1 da 400 (`Maximum allowed refresh token reuse exceeded`) y R2 también da 400 (`Session doesn't have required client`); en la fila de control, sin reuso, R2 da 200. Es decir: en Keycloak 26.8.1, con este cliente, el reuso tumba también el token legítimo de esa sesión. Es lo medido, no una garantía documentada que hayamos verificado.

## SC. Límite por identidad ([detalle](SC_RATELIMIT.md))

**Mecanismo.** Alice y Bob salen por la misma IP (127.0.0.1), como dos personas en la misma oficina o detrás del mismo NAT. Alice hace 20 peticiones a `GET /ping` y llena el cupo. En `antes` la clave del contador es la **IP**: el cupo es compartido, así que las 10 de Bob reciben `429` sin que Bob haya hecho nada (10/10). En `despues` la clave es el **`sub`** del token: cada usuario tiene su cupo y Bob pasa sin bloqueos (0/10). El algoritmo (ventana fija) es el mismo en los dos; se vio en S05/S06. Solo cambia la clave.

## SD. SSRF ([detalle](SD_SSRF.md))

**Mecanismo.** `POST /fetch {url}` descarga la URL que mande el usuario (el "webhook de destino"). Solo hay un servicio interno **vivo** escuchando (127.0.0.1:18630, solo IPv4), que devuelve un "secreto"; cinco destinos lo apuntan escrito de cinco maneras (IP de loopback, `localhost`, `0.0.0.0`, `[::]` y la IPv4 mapeada `[::ffff:127.0.0.1]`). Los demás destinos internos (metadatos 169.254.169.254, IP privada, `file://`) no tienen servidor, así que miden si la API **intenta** llegar (antes) o **bloquea antes de pedir** (despues). `antes` filtra el secreto por **4** vías (loopback, `localhost`, `0.0.0.0` y la mapeada) y no bloquea nada; `[::]` no llega en esta máquina (Windows) porque el servicio no escucha en IPv6, y en Linux o macOS el resultado puede variar. `despues` bloquea los **8** destinos internos (0 secretos filtrados) y **no** bloquea el destino público: la defensa corta lo interno, no todo. La comprobación resuelve el nombre a IP antes de decidir, así que un dominio que apunte a 127.0.0.1 o a 169.254.169.254 también cae.

**Por qué se volvió a medir.** La primera lista de bloqueo de `despues` no tenía `0.0.0.0/8` ni `::`. `BlockList.check('0.0.0.0', 'ipv4')` daba `false`, y en esta misma máquina `http://0.0.0.0:18630/secret` llega al servicio de 127.0.0.1, así que el «después» se podía saltar (comprobado aparte con esos dos hechos, no con el script: el script se corrió solo con la lista nueva). Se agregaron `0.0.0.0/8`, `::`, NAT64 (`64:ff9b::/96`) y los rangos reservados (192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4), cada uno con `// CORRECCIÓN:`, y los tres destinos nuevos a la batería.

## SE. Autenticación entre servicios ([detalle](SE_SERVICIOS.md))

**Mecanismo.** `api` llama a `precios`. En el borde de `precios`: `antes` responde a cualquiera (sin token, token de usuario, token de servicio: los tres 200). `despues` valida el token igual que la API valida el del usuario (firma por JWKS, `iss`, `aud=precios-api`) y solo acepta el **token de servicio** del cliente `api` (client credentials); el "sin token" y el token de usuario (cuyo `aud` es `orders-api`, no `precios-api`) reciben 401. De extremo a extremo contra `precios/despues`: `api/antes` no manda token y `precios` lo rechaza (401); `api/despues` pide su token con `client_credentials` y pasa (200). La API responde 200 en ambos casos porque trata la respuesta de `precios` como un dato del pedido; lo que cambia es si `precios` sirvió o no el precio.

## Qué no se midió

- **El flujo authorization code + PKCE completo.** El cliente público `spa-demo` está configurado con PKCE S256 en el realm (es el del dibujo del flujo), pero no se recorre con un navegador: los scripts piden tokens reales con `direct access grants` (cliente `demo-cli`) para no depender de una interfaz. La validación del token en la API es idéntica venga de donde venga.
- **Tokens opacos + introspección (RFC 7662) y revocación.** La demo usa JWT con JWKS. La introspección y el endpoint de revocación se mencionan en clase pero no se montan. Del refresh token solo se midió el reuso (anexo de SB) con un cliente público y direct grants: no el flujo con navegador, ni otras versiones de Keycloak, ni si el access token ya emitido deja de valer (por diseño no debería: es un JWT que la API valida sola hasta su `exp`; no se midió).
- **`redirect_uri` exacta.** El realm registra una sola URI exacta para `spa-demo` (`http://127.0.0.1:18610/callback`), sin comodines, pero no se probó que Keycloak rechace otra ruta, porque el flujo con navegador no se recorre.
- **Que el dueño por `sub` resista un renombre.** SA da las mismas cifras comparando por `sub` que por nombre de usuario; no se midió qué pasa si se renombra un usuario en Keycloak.
- **SSRF en Linux y macOS.** SD se midió solo en Windows; ahí `[::]` no llega al servicio interno (escucha solo en IPv4). En otros sistemas `antes` puede filtrar por más o menos vías; `despues` bloquea las ocho por la IP, sin conectar.
- **DNS rebinding en SD.** `despues` resuelve el nombre, lo comprueba y luego `fetch` lo vuelve a resolver: un DNS que cambie de respuesta entre las dos consultas pasaría. No se probó; la defensa completa es conectar a la IP ya comprobada.
- **TLS, DPoP, passkeys, mTLS.** Keycloak corre en HTTP (`start-dev`, `sslRequired: none`) para la demo local; nada de esto se mide.
- **Rendimiento** de la validación del JWT o del límite de peticiones: no es el objetivo (es tema del M12). `jose` cachea el JWKS; no se midió el coste del primer `fetch` del JWKS.
- **Un destino público alcanzable en SD.** La demo no tiene salida a internet, así que el destino público solo comprueba que `despues` **no** lo bloquea (pasa la validación); la descarga en sí no se completa.
- **Spring Security 7** (`spring/`): es un fragmento de referencia, no se ejecuta ni se mide.
- **Fuerza bruta / enumeración de usuarios en Keycloak, rotación de secretos, consentimiento.** Fuera del alcance de la sesión.
