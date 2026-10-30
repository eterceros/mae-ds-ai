# Plantilla para E3: un módulo en sus dos formas, en NestJS

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 8

> **Es una plantilla para copiar, no una demo medida ni una solución de E3.** No trae cifras: las cifras de E3 son las que mide cada grupo sobre **su** proyecto. Esta carpeta muestra el paso que [`demo-resiliencia/`](../demo-resiliencia/) no muestra (tener el módulo **dentro del monolito y extraído**, eligiendo con una variable de entorno) y deja listas las piezas para medir las dos formas con la misma carga.

## Qué es

Una API NestJS con dos módulos:

- **`precios`**: el módulo que se compara. Su dominio es una tabla en memoria, **sin base de datos**, para que el ejemplo sea corto (en su proyecto, el módulo tiene sus tablas). Se puede usar de dos formas:
  - **en proceso** (`PreciosEnProceso`): la API llama directo al dominio, como en un monolito modular;
  - **extraído** (`PreciosHttp`): la API lo llama por HTTP a otro contenedor, a través de Toxiproxy, con plazo por intento, reintentos con *jitter* y circuit breaker.
- **`pedidos`**: quien usa a precios. `GET /pedidos/:id` necesita un precio; `GET /catalogo` no lo necesita y sirve de **ruta de control**: si se cae cuando se cae precios, la falla arrastró al resto.

La variable `PRECIOS_MODO` (`proceso` o `http`) elige la forma al arrancar. `pedidos` no cambia ni una línea entre las dos: solo conoce el contrato `PreciosPort` y el token `PRECIOS`, con los mismos nombres que las diapositivas 37 y 38 de la S08.

```
              forma "proceso"                        forma "http" (perfil "extraido")
  k6 ──> api (pedidos + precios)        k6 ──> api (pedidos) ──> toxiproxy ──> precios
                                                                    ▲
                                                k6 rompe aquí ──────┘ (API de Toxiproxy)
```

Una sola imagen, dos puntos de entrada: `dist/main.js` (la API completa) y `dist/main-precios.js` (solo el módulo de precios, en su puerto).

## Mapa: archivo → paso de E3

| Paso de E3 (diapositiva 43) | Archivos de esta plantilla | Qué hacer en su proyecto |
|---|---|---|
| 1 · Las dos formas del módulo | [`src/precios/precios.port.ts`](src/precios/precios.port.ts) (contrato y errores), [`precios.module.ts`](src/precios/precios.module.ts) (elige con `PRECIOS_MODO`), [`precios-en-proceso.ts`](src/precios/precios-en-proceso.ts), [`precios-http.ts`](src/precios/precios-http.ts) | Una interfaz para su módulo y dos implementaciones; quien lo usa inyecta el token |
| 1 · El módulo como servicio aparte | [`src/main-precios.ts`](src/main-precios.ts) con [`precios-servicio.module.ts`](src/precios/precios-servicio.module.ts) y [`precios.controller.ts`](src/precios/precios.controller.ts) | Un segundo `main` que arranca solo su módulo, con un controlador que expone lo que dice la interfaz |
| 1 · La frontera | [`scripts/chequear-frontera.mjs`](scripts/chequear-frontera.mjs) (`npm run frontera`, corre en cada `npm run build`) | Que nadie fuera del módulo importe sus clases internas |
| 2 · Toxiproxy entre la API y el módulo | [`compose.yaml`](compose.yaml) (servicios `precios` y `toxiproxy`), [`toxiproxy/toxiproxy.json`](toxiproxy/toxiproxy.json), [`formas/`](formas/) | Tres servicios más en su compose: el módulo (misma imagen, otro `command`), Toxiproxy y k6 |
| 3 · Dos rutas con k6 mientras se rompe el módulo | [`k6/carga.js`](k6/carga.js) y [`k6/comun.js`](k6/comun.js) | Sus dos rutas (una que usa el módulo, otra que no) y sus ids |
| 4 · 5 corridas o más por forma | [Comandos](#cinco-corridas-por-forma) de este README; los resúmenes quedan en `resultados/` | Lo mismo, con `down -v` entre corridas |
| 2, 4, 5 · Hipótesis, informe y ADR | [`bench/e3/HIPOTESIS.md`](bench/e3/HIPOTESIS.md), [`bench/e3/INFORME.md`](bench/e3/INFORME.md), [`docs/adr/0000-plantilla-extraer-modulo.md`](docs/adr/0000-plantilla-extraer-modulo.md) (vacíos) | Llenarlos: las hipótesis antes de medir |

Las protecciones de `PreciosHttp` son las de `demo-resiliencia/src/despues/` (plazo, reintentos con *jitter*, opossum), dentro de una clase de NestJS. Lo que mide cada una está en el README de esa demo.

## Cómo trasladarlo a su proyecto

1. **Elijan el módulo.** No es un endpoint: es un módulo con sus rutas y **sus tablas**, al que el resto llama por pocas funciones, y con una razón para extraerlo de la diapositiva 36 (otro *runtime*, carga distinta, datos sensibles). Típico en sus proyectos: el de IA, notificaciones o reportes. Si otros módulos leen sus tablas directamente, primero hay que cortar eso.
2. **Escriban la interfaz y las dos implementaciones.** Copien la forma de `precios.port.ts`: los métodos que el resto necesita, cada uno con un `deadline: AbortSignal`, un `Symbol` como token y los errores del contrato (aquí `PrecioNoEncontrado` y `PreciosNoDisponible`). La implementación en proceso envuelve su servicio actual; la HTTP copia `precios-http.ts` cambiando la URL y la respuesta. En el módulo, el `useClass` con la variable, como en `precios.module.ts`.
3. **Cambien a quien lo usa** para que inyecte el token (`@Inject(PRECIOS)`) y solo importe el contrato. Adapten `scripts/chequear-frontera.mjs` (las constantes `MODULO` y `PERMITIDOS`) y córranlo.
4. **Agreguen el segundo `main`** que arranca solo su módulo, con un controlador que expone por HTTP lo que la interfaz promete.
5. **Agreguen tres servicios a su `compose.yaml`**: el módulo (la misma imagen con `command: ["node", "dist/main-<modulo>.js"]` y su healthcheck), `toxiproxy` (con `upstream` apuntando al módulo) y `k6` (perfil `carga`). En su API, la URL del módulo apunta a `toxiproxy`, no al módulo. Si el módulo usa una base, la forma extraída necesita la conexión a **sus** tablas; las de los demás, no.
6. **Adapten `k6/carga.js`**: sus dos rutas, sus ids (ver [Datos para la carga](#datos-para-la-carga)) y, si sus rutas piden login, el token. En la diapositiva 43 el script va en `bench/e3/`: pueden mover `k6/` allí y cambiar el volumen del servicio `k6`.

## Datos para la carga

**k6 no inventa datos**: manda exactamente las peticiones que el script le dice. Que esas peticiones encuentren datos, y que sean los mismos en cada corrida, es trabajo del grupo:

- **Midan rutas de lectura (`GET`).** No cambian el estado, así que todas las corridas parten de lo mismo.
- **Llenen la base con un *seed* fijo y reproducible**: un script de seed o un SQL que corre después de las migraciones (en compose, como el servicio `migrate` de `demo-docker/despues/compose.yaml`). Con un volumen parecido al real: el p95 depende del tamaño de las tablas. Y **el mismo en las dos formas**.
- **Cada corrida termina con `down -v`**, que borra los volúmenes: el seed se vuelve a cargar en la corrida siguiente y ninguna hereda datos de la anterior.
- **k6 pide ids que existen**: de un rango conocido o de un archivo JSON leído con `SharedArray` (lo lee una vez y lo comparte entre los usuarios virtuales). `k6/carga.js` hace las dos cosas: por omisión elige ids de 1 a `N_PRODUCTOS` (1000); con `-e IDS=/k6/ids.ejemplo.json` los toma de [`k6/ids.ejemplo.json`](k6/ids.ejemplo.json).
- **Si la ruta pide login**, el token se obtiene **una vez** en `setup()` de k6, con un usuario del seed, y se pasa a cada petición en el encabezado `Authorization`.
- **Si miden escrituras (`POST`)**, usen claves únicas por iteración (p. ej. con `exec.vu.idInTest` y `exec.vu.iterationInScenario` de `k6/execution`) y tengan en cuenta que el estado crece durante la corrida.
- **Anoten en el informe el tamaño de los datos** y cómo se generaron (`bench/e3/INFORME.md`, sección «Entorno»).

En esta plantilla los datos están en memoria y son **deterministas**: 1000 productos con ids de 1 a 1000 y siempre el mismo precio para el mismo id ([`src/precios/precios.service.ts`](src/precios/precios.service.ts), constante `N_PRODUCTOS`), y 1000 pedidos, el pedido *i* con el producto *i* ([`src/pedidos/pedidos.datos.ts`](src/pedidos/pedidos.datos.ts)). En su proyecto, esa tabla es su seed.

## Piezas

| Pieza | Dónde | Notas |
|---|---|---|
| API (NestJS 12.3.2, Node 24.22.2) | `127.0.0.1:18300` | `GET /pedidos/:id`, `GET /catalogo`, `GET /salud`; `GET /stats` da las llamadas a precios y el estado del breaker (los lee k6) |
| Servicio de precios (misma imagen) | `127.0.0.1:18301` | Solo en la forma `http`. `GET /precios/:id`; el puerto publicado es para probarlo a mano: la API pasa por Toxiproxy |
| Toxiproxy 2.13.0 | API en `127.0.0.1:18310` | Solo en la forma `http`. Un proxy, `precios`: escucha en `toxiproxy:8666` y reenvía a `precios:3001` |
| k6 2.3.0 | contenedor de un solo uso | `k6/carga.js`; el resumen va a `resultados/` |

Todo en Docker Compose (proyecto `e3-nest`), puertos altos y solo en `127.0.0.1`. Las imágenes están fijadas por versión y *digest*.

Valores por omisión de `PreciosHttp` (variables de entorno de la API): plazo por intento `PRECIOS_PLAZO_INTENTO_MS=300`, intentos en total `PRECIOS_INTENTOS=2`, ventana del breaker `PRECIOS_BREAKER_VENTANA_MS=2000`, tiempo abierto `PRECIOS_BREAKER_RESET_MS=2000`; plazo total de `/pedidos/:id`, `PEDIDOS_PLAZO_MS=800`. Son ejemplos para estos tiempos, no recomendaciones.

## Requisitos

- Docker (probado con Docker Desktop, motor 29.9.2, Compose v5.6.0).
- k6 **no** hace falta instalarlo: corre en un contenedor (`grafana/k6:2.3.0`).
- Node.js 24 en la máquina solo si quieren compilar o chequear tipos fuera de Docker (`npm ci`, `npm run build`, `npm run typecheck`). La imagen compila sola.

## Cómo correrlo

Todos los comandos, desde esta carpeta. La forma se elige con `--env-file`: [`formas/proceso.env`](formas/proceso.env) (solo la API) o [`formas/http.env`](formas/http.env) (activa el perfil `extraido`: agrega `precios` y `toxiproxy`). Usen el mismo `--env-file` en `up` y en `run`.

**En Git Bash, primero** `export MSYS_NO_PATHCONV=1`. Sin eso, Git Bash convierte `/k6/carga.js` en `C:/Program Files/Git/k6/carga.js` y k6 no encuentra el script. PowerShell no lo necesita.

### Levantar cada forma

PowerShell y Git Bash (es el mismo comando):

```
docker compose --env-file formas/proceso.env up -d --build --wait   # forma 1: monolito modular
docker compose --profile "*" down -v                                # borra todo

docker compose --env-file formas/http.env up -d --build --wait      # forma 2: extraído, detrás de Toxiproxy
docker compose --profile "*" down -v
```

Para bajar, `--profile "*"`: un `down` sin perfiles borra solo la API y deja vivos `precios` y `toxiproxy`.

Probar a mano (con la forma `http` levantada). Git Bash:

```bash
curl http://127.0.0.1:18300/pedidos/7        # 200, con el precio
curl http://127.0.0.1:18300/catalogo         # 200, no usa precios
curl http://127.0.0.1:18300/stats            # forma, llamadas a precios, estado del breaker
curl -X POST http://127.0.0.1:18310/proxies/precios -d '{"enabled":false}'   # precios caído
curl http://127.0.0.1:18300/pedidos/7        # 503 {"error":"Precios no disponible","motivo":...}
curl http://127.0.0.1:18300/catalogo         # sigue en 200
curl -X POST http://127.0.0.1:18310/reset    # quita las fallas
```

PowerShell. Toxiproxy rechaza las peticiones con un *user agent* de navegador (el de PowerShell empieza con `Mozilla/`; responde «User agent not allowed»), por eso `-UserAgent`:

```powershell
Invoke-RestMethod http://127.0.0.1:18300/pedidos/7
Invoke-RestMethod http://127.0.0.1:18300/stats
Invoke-RestMethod -Method Post -UserAgent powershell http://127.0.0.1:18310/proxies/precios -Body '{"enabled":false}'
try { Invoke-RestMethod http://127.0.0.1:18300/pedidos/7 } catch { $_.ErrorDetails.Message }   # el cuerpo del 503
(Invoke-RestMethod http://127.0.0.1:18300/catalogo).Count                                      # 50: sigue bien
Invoke-RestMethod -Method Post -UserAgent powershell http://127.0.0.1:18310/reset
```

### Una corrida de k6

PowerShell:

```powershell
docker compose --env-file formas/http.env run --rm k6 run -e FALLA=colgado /k6/carga.js
docker compose --env-file formas/http.env run --rm k6 run -e FALLA=caido /k6/carga.js
docker compose --env-file formas/proceso.env run --rm k6 run -e FALLA=colgado /k6/carga.js
```

Git Bash:

```bash
export MSYS_NO_PATHCONV=1
docker compose --env-file formas/http.env run --rm k6 run -e FALLA=colgado /k6/carga.js
docker compose --env-file formas/http.env run --rm k6 run -e FALLA=caido /k6/carga.js
docker compose --env-file formas/proceso.env run --rm k6 run -e FALLA=colgado /k6/carga.js
```

Una corrida dura 40 s: 10 s de calentamiento (no se cuentan) y 30 s medidos, con la falla de los 10 a los 20 s. Variables (`-e NOMBRE=valor`): `FALLA` (`colgado`, `caido` o vacía), `RPS` (peticiones por segundo **en cada ruta**, 50), `CALENTAMIENTO` (10), `INICIO_FALLA` (10), `FIN_FALLA` (20), `DURACION` (30), `N_PRODUCTOS` (1000), `IDS` (archivo JSON de ids), `SALIDA` (nombre del resumen).

- **colgado**: un *toxic* `timeout` con `timeout: 0` en el sentido API→precios. Toxiproxy acepta la conexión, la petición nunca llega a precios y la conexión no se cierra.
- **caido**: `enabled: false` en el proxy. Toxiproxy cierra el puerto y conectar falla al instante (`ECONNREFUSED`).
- En la forma `proceso` no hay red que romper: el script lo dice y mide las mismas fases igual.

Al terminar, k6 muestra una tabla por ruta y fase (peticiones, p50, p95, máximo, % de errores) y las llamadas de la API a precios en cada fase, y guarda el resumen completo en `resultados/<forma>-<falla>-<fecha>.json` (o `resultados/<SALIDA>.json`). Dentro del JSON, las cifras de cada combinación están en `metrics["http_req_duration{ruta:pedidos,fase:falla}"]`, `metrics["http_req_failed{ruta:catalogo,fase:falla}"]`, `metrics["llamadas_a_precios{fase:falla}"]`, etc. k6 solo guarda una submétrica si tiene un umbral; `k6/comun.js` les pone umbrales que nunca fallan. Si quieren que k6 marque la corrida como fallida cuando su hipótesis no se cumple, agreguen uno de verdad, p. ej. `'http_req_duration{ruta:catalogo,fase:falla}': ['p(95)<50']`.

### Cinco corridas por forma

Con `down -v` entre corridas, para que ninguna herede el estado de la anterior (ni el del breaker, ni datos). Cambien `http`/`colgado` por cada combinación.

PowerShell:

```powershell
foreach ($i in 1..5) {
  docker compose --env-file formas/http.env up -d --wait
  docker compose --env-file formas/http.env run --rm k6 run -e FALLA=colgado -e SALIDA="http-colgado-$i" /k6/carga.js
  docker compose --profile "*" down -v
}
```

Git Bash:

```bash
export MSYS_NO_PATHCONV=1
for i in 1 2 3 4 5; do
  docker compose --env-file formas/http.env up -d --wait
  docker compose --env-file formas/http.env run --rm k6 run -e FALLA=colgado -e SALIDA=http-colgado-$i /k6/carga.js
  docker compose --profile "*" down -v
done
```

Construyan la imagen una vez antes (`docker compose build`) para que el bucle no mida builds. `resultados/` está fuera de git en esta carpeta porque es una plantilla; en su proyecto, decidan dónde guardar los JSON que respaldan su informe.

### Medir el build y el arranque

Git Bash (`time`):

```bash
time docker compose build --no-cache                                # build desde cero
time docker compose --env-file formas/proceso.env up -d --wait      # arranque de la forma 1
docker compose --profile "*" down -v
time docker compose --env-file formas/http.env up -d --wait         # arranque de la forma 2
docker compose --profile "*" down -v
```

PowerShell (`Measure-Command`; `| Out-Default` para seguir viendo la salida):

```powershell
(Measure-Command { docker compose build --no-cache | Out-Default }).TotalSeconds
(Measure-Command { docker compose --env-file formas/proceso.env up -d --wait | Out-Default }).TotalSeconds
docker compose --profile "*" down -v
(Measure-Command { docker compose --env-file formas/http.env up -d --wait | Out-Default }).TotalSeconds
docker compose --profile "*" down -v
```

Aquí las dos formas usan la misma imagen, así que el build es uno solo; en su proyecto puede no serlo (si el módulo extraído tiene su propia imagen). El arranque sí cambia: la forma `http` espera a que precios esté sano antes de levantar la API.

### Fuera de Docker

```
npm ci
npm run typecheck     # chequeo de tipos
npm run build         # chequeo de frontera + compilación a dist/
npm run frontera      # solo el chequeo de frontera
```

Para ver fallar el chequeo, agreguen `import { PreciosService } from '../precios/precios.service';` en `src/pedidos/pedidos.module.ts` y corran `npm run frontera`.

## Decisiones de la plantilla

- **Una variable y un perfil, en un archivo por forma.** `PRECIOS_MODO` elige la implementación dentro de la API; `COMPOSE_PROFILES` decide si existen `precios` y `toxiproxy`. Las dos van juntas en `formas/*.env` para que no queden desparejas. En la forma `proceso` no hay contenedores de más: así el arranque y los recursos que se comparan son los de cada forma.
- **`depends_on` con `required: false`.** La API espera a `precios` y `toxiproxy` cuando existen (forma `http`) y no los pide cuando el perfil está apagado (forma `proceso`).
- **El breaker envuelve un intento y los reintentos van por fuera.** Con el circuito abierto no se reintenta (fallaría igual en 1 ms), y tampoco cuando ya venció el plazo total. Un 404 no cuenta como falla del breaker (`errorFilter`).
- **`fetch` y no `node:http`.** La demo de resiliencia usa `node:http` para controlar el pool; aquí basta `fetch` con `AbortSignal.any`. `fetch` reutiliza conexiones (*keep-alive*): con fallas que tocan a todas las conexiones, como las de este script, da igual; si usan `toxicity` menor que 1, recuerden que Toxiproxy decide **por conexión**, no por petición (ver el README de la demo).
- **`/stats` en la API** para contar las llamadas a precios por fase. k6 lo lee al empezar, en cada cambio de fase y al terminar.
- **Calentamiento como fase propia** (`calentamiento`) que queda en el resumen pero no se compara (amenaza 4 de la diapositiva 46).
- **TypeScript compilado con `tsc`**, como `demo-docker/api`. TypeScript 6.0.3 y no 7.0.2 (la última): es la versión que usa `@nestjs/cli` 12 y la de las otras demos NestJS del módulo.

## Problemas encontrados al armar la plantilla

- **Git Bash convierte las rutas que empiezan con `/`.** `/k6/carga.js` llegaba a k6 como `C:/Program Files/Git/k6/carga.js`. Se resuelve con `export MSYS_NO_PATHCONV=1`.
- **`docker compose down -v` sin perfiles no borra los servicios de un perfil.** Con la forma `http` levantada, un `down` con `formas/proceso.env` dejaba vivos `precios` y `toxiproxy`. Por eso se baja con `--profile "*"`.
- **Toxiproxy rechaza el *user agent* de PowerShell** (`Invoke-RestMethod` se presenta como `Mozilla/…` y Toxiproxy bloquea los navegadores en su API). Con `-UserAgent powershell` anda. Y `curl.exe -d "{\"enabled\":false}"` en Windows PowerShell 5.1 llega con las barras: por eso en PowerShell se usa `Invoke-RestMethod`.
- **El chequeo de frontera marcaba a `main-precios.ts`**, que tiene que importar el módulo extraído para arrancarlo. Los puntos de entrada (`main*.ts`) arman la aplicación y quedan fuera del chequeo.

## Qué no trae esta plantilla

- **Cifras.** Se corrió para verificar que funciona, no para publicar resultados.
- **Base de datos, migraciones ni seed**: el dominio está en memoria (ver [Datos para la carga](#datos-para-la-carga)).
- **Bulkhead**: si su API comparte un pool entre la ruta que usa el módulo y otras, vean `demo-resiliencia/src/despues/bulkhead.ts` (R6).
- **Tiempo de recuperación medido directamente.** El resumen da los errores de la fase `despues`; para saber en qué segundo volvió a 0 %, achiquen las fases o guarden cada petición con `--out json=/out/detalle.json` y búsquenlo ahí.
- **Una falla «lento»** (`latency`): se agrega igual que las otras, con un *toxic* en `control()` de `k6/carga.js`.
- **Contrato OpenAPI, autenticación entre servicios, trazas**: se ven en otras sesiones.

## Versiones (verificadas el 30 de octubre de 2026)

| Software | Versión | Imagen o paquete |
|---|---|---|
| Node.js | 24.22.2 (27 oct 2026) | `docker.io/library/node:24.22.2-bookworm-slim@sha256:c86ecead…` |
| NestJS (`@nestjs/common`, `core`, `platform-express`) | 12.3.2 (27 oct 2026) | npm, versión exacta |
| opossum | 10.0.0 | npm, versión exacta |
| reflect-metadata / rxjs | 0.2.2 / 7.8.2 | npm, versión exacta |
| TypeScript (solo compilación) | 6.0.3 | npm, versión exacta |
| @types/node | 24.19.2 | npm, versión exacta |
| Toxiproxy | 2.13.0 | `ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09…` |
| k6 | 2.3.0 | `grafana/k6:2.3.0@sha256:2dd4756e…` |

Probado en Windows 11 con Docker Desktop (motor 29.9.2, Compose v5.6.0), en PowerShell y en Git Bash.
