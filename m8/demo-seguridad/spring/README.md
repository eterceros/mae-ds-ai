# Spring Security 7 — resource server (fragmento de referencia)

**No se ejecuta ni se mide.** Es el equivalente en Spring de lo que hace `src/despues/auth.guard.ts` con `jose`: validar el JWT contra el mismo Keycloak (`issuer-uri`), fijar el `aud` y autorizar por dueño del recurso. Sirve para los que usan Java; la demo medida es la de NestJS.

Mismo realm que la demo: emisor `http://127.0.0.1:18600/realms/demo`, audiencia esperada `orders-api`.

- [`application.yml`](application.yml): con `issuer-uri`, Spring descubre el JWKS y valida firma, `iss` y `exp` solo. El `aud` NO se valida por defecto.
- [`SecurityConfig.java`](src/main/java/demo/SecurityConfig.java): cadena de filtros como resource server + un validador que añade la comprobación de `aud=orders-api` (lo que falta por defecto).
- [`OrdersController.java`](src/main/java/demo/OrdersController.java): la corrección de BOLA: el pedido tiene que ser del `sub` del token (`jwt.getSubject()`, el id estable del usuario, no `preferred_username`); si no, 404.

Versiones mencionadas en clase: Spring Boot 4 con el starter `spring-boot-starter-oauth2-resource-server` (Spring Security 7). La alternativa con el agente de OpenTelemetry (`JAVA_TOOL_OPTIONS`) se ve en la S11, no aquí.
