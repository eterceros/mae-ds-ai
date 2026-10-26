# Kubernetes desde el desarrollador (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 11

> **Es una demostración del docente.** No hay nada que entregar. Se publica para repasarla después de la clase y reproducirla si quieren. Todo corre en un clúster local de [kind](https://kind.sigs.k8s.io/) (Kubernetes dentro de un contenedor de Docker): no necesita cuentas ni nube. La **actividad 8** (los manifiestos de su servicio) sigue la misma forma que [`despues/`](despues/).

## Qué es

Dos servicios pequeños sin estado, `api` y `precios` (Node 24, sin paquetes de npm), pasados de Compose a Kubernetes con lo que escribe el desarrollador: Deployment, Service, ConfigMap, Secret, probes, `requests/limits` y una HTTPRoute. `api` responde `GET /cotizacion?producto=p1` llamando a `precios`. No hay base de datos ni broker: no hacen falta para lo que se mide.

| De Compose | A Kubernetes | Dónde |
|---|---|---|
| un servicio (`api:`) | **Deployment** (los pods y cuántos) + **Service** (nombre y puerto estables: `http://precios:3001`) | [`despues/api.yaml`](despues/api.yaml), [`despues/precios.yaml`](despues/precios.yaml) |
| `environment:` | **ConfigMap** (ajustes) y **Secret** (claves) | [`despues/api-config.yaml`](despues/api-config.yaml); el Secret se crea por línea de comandos |
| `healthcheck:` | **probes**: *startup*, *liveness*, *readiness* | [`despues/api.yaml`](despues/api.yaml) |
| `ports: "8080:3000"` | **Gateway** + **HTTPRoute** (Gateway API) | [`despues/ruta.yaml`](despues/ruta.yaml) |
| `deploy.resources` | `resources.requests/limits` (declarados, sin afinar) | los dos Deployment |

Las tres probes de `api`, en una línea cada una:

- **startup**: «¿ya arrancó?». Mientras no pase, las otras dos no cuentan.
- **liveness** → `/salud/vivo`: «¿el proceso está trabado?». Si falla, Kubernetes **reinicia** el contenedor. Por eso no mira nada fuera del proceso.
- **readiness** → `/salud/listo`: «¿puedo recibir tráfico ahora?». Si falla, el pod **sale del Service** hasta que vuelva a pasar; no se reinicia nada. Aquí sí se consulta a `precios`. Al recibir `SIGTERM` la app responde 503 en `/salud/listo` y cierra sus conexiones: el apagado limpio de la S02.

| Pieza | Dónde | Notas |
|---|---|---|
| Clúster kind `s11-demo` | contexto `kind-s11-demo`; API en `127.0.0.1:18529` | 1 nodo, Kubernetes 1.37.0 ([`kind/cluster.yaml`](kind/cluster.yaml)) |
| `api` (2 réplicas) y `precios` (1) | espacio de nombres `s11` | imágenes `s11-demo/api:1.0` y `s11-demo/precios:1.0` ([`app/`](app/)) |
| Gateway `demo` (Envoy Gateway v1.9.2) | `127.0.0.1:18520` con `port-forward` | el controlador lo instala [`scripts/instalar-gateway.ts`](scripts/instalar-gateway.ts); no se explica en clase |
| `api` por `port-forward` | `127.0.0.1:18500` | para probar a mano |
| Pod de carga | dentro del clúster | [`app/api/carga.mjs`](app/api/carga.mjs): llama a los Services por nombre, como otro servicio |
| kube-linter v0.8.3 | contenedor `stackrox/kube-linter:v0.8.3` | sin instalar nada |

Todos los puertos son altos y escuchan solo en `127.0.0.1`.

## Antes y después

| Carpeta | Qué hay |
|---|---|
| [`antes/`](antes/) | `ka-1-generado-por-ia.yaml`: lo que devolvió un asistente sin revisar; `ka-2-pasa-los-validadores.yaml`: lo mismo tras corregir todo lo que dijeron el servidor y kube-linter, y que aún no funciona; `kb-liveness-con-dependencia.yaml`: la liveness consulta a `precios`; `kc-secreto-en-variable.yaml`: el Secret como variable de entorno. Cada defecto está comentado (`# SIGUE MAL`, `# MAL`) |
| [`despues/`](despues/) | los manifiestos revisados, con cada corrección marcada `# CORRECCIÓN: …` y su porqué: lo que aplica el README y el modelo de la actividad 8 |
| [`app/`](app/) | el código de los dos servicios (el mismo para `antes/` y `despues/`: solo cambian los manifiestos) |

[`DIFERENCIAS.md`](DIFERENCIAS.md) es la tabla problema → línea en `antes/` → cambio en `despues/` → cifra medida.

## Escenarios

| | Qué se mide | Qué enseña |
|---|---|---|
| **KA** | Manifiesto generado por IA: errores de `kubectl apply --dry-run=server` ronda por ronda, hallazgos de kube-linter, y qué sigue roto al aplicarlo | Cada herramienta ve una capa distinta; ninguna ve si la probe apunta a la ruta correcta ni si el `targetPort` es el del contenedor. Hay que aplicarlo y mirar |
| **KB** | `precios` se apaga 90 s con carga constante: reinicios de `api`, peticiones fallidas y cuánto tarda en recuperarse cuando `precios` vuelve | Una liveness que consulta una dependencia convierte una caída ajena en reinicios propios |
| **KC** | El mismo Secret leído como variable y como archivo; se cambia 3 veces | base64 no es cifrado; el archivo se actualiza solo, la variable solo al reiniciar |
| **KD** | HTTPRoute con un controlador preinstalado | Solo que enruta: `/cotizacion` → `api`, `/precios` → `precios`, el resto 404 |

## Requisitos

- Docker Desktop (probado con motor 29.9.2).
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) v0.33.0: es un solo ejecutable; descárguenlo de la página de *releases* y llámenlo con su ruta o pónganlo en el PATH.
- `kubectl` (el de Docker Desktop sirve; probado con v1.36.1 contra un clúster 1.37: una versión menor de diferencia está soportada).
- Node.js 24 o superior (probado con 24.19.0) para los scripts de medición; no hay `npm install`.

## Cómo correrlo

```
kind create cluster --config kind/cluster.yaml          # ~2 min; deja el contexto kind-s11-demo
docker build -t s11-demo/api:1.0 app/api
docker build -t s11-demo/precios:1.0 app/precios
kind load docker-image s11-demo/api:1.0 s11-demo/precios:1.0 --name s11-demo   # el nodo no ve las imágenes locales

kubectl config use-context kind-s11-demo
kubectl apply -f despues/00-namespace.yaml
kubectl -n s11 create secret generic api-secretos --from-literal=API_KEY=demo-clave-v1   # nunca en un archivo del repo
kubectl apply --dry-run=server -f despues/precios.yaml -f despues/api-config.yaml -f despues/api.yaml
kubectl apply -f despues/precios.yaml -f despues/api-config.yaml -f despues/api.yaml
kubectl -n s11 get pods                                  # 3 pods 1/1 Running

kubectl -n s11 port-forward svc/api 18500:80             # en otra terminal
curl "http://127.0.0.1:18500/cotizacion?producto=p2"     # {"producto":"p2","precio":85,"moneda":"BOB","pod":"api-…"}

node --no-warnings scripts/instalar-gateway.ts           # el docente, antes de clase (~1 min)
kubectl apply -f despues/ruta.yaml
```

Las mediciones (cada una escribe su archivo en `results/`):

```
node --no-warnings scripts/ka-validar.ts     # -> results/KA_VALIDACION.md  (~3 min; requiere el Gateway instalado)
node --no-warnings scripts/kb-probes.ts      # -> results/KB_PROBES.md      (~30 min: 3 corridas por variante)
node --no-warnings scripts/kc-secretos.ts    # -> results/KC_SECRETOS.md    (~10 min: 3 rotaciones)
node --no-warnings scripts/kd-ruta.ts        # -> results/KD_HTTPROUTE.md   (~1 min)
kind delete cluster --name s11-demo          # borra todo
```

kube-linter a mano: `docker run --rm -v "$PWD/despues:/m:ro" stackrox/kube-linter:v0.8.3 lint /m` (en Git Bash, con `MSYS_NO_PATHCONV=1` delante). Otro validador del mismo tipo, kubeconform, comprueba el esquema sin clúster; aquí no se usa porque `--dry-run=server` ya valida contra el clúster real.

A mano, KB: `kubectl apply -f antes/kb-liveness-con-dependencia.yaml`, `kubectl -n s11 scale deployment/precios --replicas=0` y en otra terminal `kubectl -n s11 get pods -w`: la columna `RESTARTS` sube y aparece `CrashLoopBackOff`. Con `despues/api.yaml` los pods pasan a `0/1` y `RESTARTS` queda en 0. Para dejarlo como estaba: `--replicas=1` y `kubectl apply -f despues/api.yaml`.

## Resultados de referencia

Medidos el 26 de octubre de 2026 en un portátil (Intel Core i9-12900H, 64 GB, Windows 11, Docker Desktop con WSL2, motor 29.9.2), kind v0.33.0 con Kubernetes 1.37.0:

| | antes | despues |
|---|---|---|
| **KA** manifiesto de IA (3 corridas, conteos idénticos) | **7 errores** de `--dry-run=server` en 3 rondas y **11 hallazgos** de kube-linter; corregido todo eso, aún **0 de 200** peticiones correctas, 4 reinicios en 90 s y `precios` nunca listo | 0 errores, 0 hallazgos, **200 de 200** |
| **KB** `precios` caído 90 s (mediana de 3, rango) | **8 reinicios (8–9)** de una api sana; hasta **56 s** extra con un pod fuera del Service | **0 reinicios**; los pods vuelven al Service en el siguiente sondeo |
| KB peticiones fallidas (de 2400) | 905 (900–941), todas durante la caída | 906 (904–916), todas durante la caída |
| **KC** Secret rotado 3 veces | como variable: **0 de 3** lo ven sin reiniciar; el valor está en `env` | como archivo: lo ven sin reiniciar en **62,2 s** de mediana (26–83,6 s) |
| KC base64 | `base64 -d` devuelve el valor: un comando, sin clave | (igual: por eso el Secret no va al repo) |
| **KD** HTTPRoute | — | `Accepted` y `ResolvedRefs` en `True`; 200 de 200 `200`, 40 de 40 `404` en rutas no declaradas |


Ver [`results/ESCENARIOS.md`](results/ESCENARIOS.md): resumen, por qué sale cada cifra y qué no se midió.
