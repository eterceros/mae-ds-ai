# KA · Manifiesto generado por IA, sin revisar

Medido el 2026-10-26 11:24 UTC · 12th Gen Intel(R) Core(TM) i9-12900H (20 hilos), 64 GB · Windows_NT 10.0.26200 · Node v24.19.0 · kubectl v1.36.1 · Kubernetes v1.37.0 (kind, contexto kind-s11-demo)

Archivo de partida: [`antes/ka-1-generado-por-ia.yaml`](../antes/ka-1-generado-por-ia.yaml) (6 objetos: ConfigMap, Secret, 2 Deployment, 2 Service). Script: `node --no-warnings scripts/ka-validar.ts`. Conteos exactos; la validación es determinista (3 corridas, mismo resultado en los conteos).

## 1. `kubectl apply --dry-run=server`, ronda por ronda

El servidor valida cada objeto y se detiene en **su primer error**: al corregir uno puede aparecer el siguiente. En cada ronda se corrigió solo lo que pedía el mensaje.

| Ronda | Mensaje del servidor | Corrección |
|---|---|---|
| 1 (4) | (BadRequest) ConfigMap in version "v1" cannot be handled as a ConfigMap: json: cannot unmarshal bool into Go struct field ConfigMap.data of type string | ConfigMap: `DEBUG: true` → `"true"` |
|  | (BadRequest) Secret in version "v1" cannot be handled as a Secret: illegal base64 data at input byte 4 | Secret: el valor de `data:` pasado a base64 |
|  | (BadRequest) Deployment in version "v1" cannot be handled as a Deployment: quantities must match the regular expression '^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$' | Deployment api: `256mb` → `256Mi` |
|  | (Invalid) Service "api" is invalid: spec.ports[0].protocol: Unsupported value: "HTTP": supported values: "SCTP", "TCP", "UDP" | Service api: `protocol: HTTP` → `TCP` |
| 2 (2) | (BadRequest) ConfigMap in version "v1" cannot be handled as a ConfigMap: json: cannot unmarshal number into Go struct field ConfigMap.data of type string | ConfigMap: `PORT: 3000` → `"3000"` |
|  | (BadRequest) Deployment in version "v1" cannot be handled as a Deployment: strict decoding error: unknown field "spec.template.spec.containers[0].livenesProbe" | Deployment api: errata `livenesProbe` → `livenessProbe` |
| 3 (1) | The Deployment "api" is invalid: spec.template.metadata.labels: Invalid value: {"app":"api-server"}: `selector` does not match template `labels` | Deployment api: etiqueta de la plantilla `api-server` → `api` |
| 4 (0) | todos los objetos: «created (server dry run)» | — |

**Total: 7 errores en 3 rondas** hasta que el servidor acepta el archivo. Resultado: [`raw/ka/ka-1-tras-dry-run.yaml`](raw/ka/ka-1-tras-dry-run.yaml).

## 2. kube-linter v0.8.3 (comprobaciones por defecto)

| Sobre | Hallazgos | Por comprobación |
|---|---|---|
| el archivo original (`ka-1`) | 7 | `dangling-service` ×2, `latest-tag` ×1, `no-read-only-root-fs` ×1, `run-as-non-root` ×1, `unset-cpu-requirements` ×1, `unset-memory-requirements` ×1 |
| la versión que ya acepta el servidor | **11** | `latest-tag` ×2, `no-anti-affinity` ×1, `no-read-only-root-fs` ×2, `run-as-non-root` ×2, `unset-cpu-requirements` ×2, `unset-memory-requirements` ×1, `dangling-service` ×1 |
| [`antes/ka-2-pasa-los-validadores.yaml`](../antes/ka-2-pasa-los-validadores.yaml) | 0 | — |

Sobre el archivo original kube-linter **se salta sin avisar** los objetos que no puede decodificar (el ConfigMap con `DEBUG: true` y el Deployment `api` con `256mb`): por eso ve menos. Orden útil: primero el servidor, después el linter.

<details><summary>Hallazgos de kube-linter sobre la versión que acepta el servidor</summary>

- `latest-tag` · s11-ka/api apps/v1, Kind=Deployment
- `no-anti-affinity` · s11-ka/api apps/v1, Kind=Deployment
- `no-read-only-root-fs` · s11-ka/api apps/v1, Kind=Deployment
- `run-as-non-root` · s11-ka/api apps/v1, Kind=Deployment
- `unset-cpu-requirements` · s11-ka/api apps/v1, Kind=Deployment
- `latest-tag` · s11-ka/precios apps/v1, Kind=Deployment
- `no-read-only-root-fs` · s11-ka/precios apps/v1, Kind=Deployment
- `run-as-non-root` · s11-ka/precios apps/v1, Kind=Deployment
- `unset-cpu-requirements` · s11-ka/precios apps/v1, Kind=Deployment
- `unset-memory-requirements` · s11-ka/precios apps/v1, Kind=Deployment
- `dangling-service` · s11-ka/precios /v1, Kind=Service

</details>

## 3. `ka-2`: pasa los dos validadores y no funciona

`ka-2` (servidor: acepta todo; kube-linter: 0 hallazgos) aplicado de verdad en el espacio de nombres `s11-ka`:

| Qué | Medido | Causa (ningún validador la ve) |
|---|---|---|
| `precios` listo a los 90 s | 0 de 1 pods; endpoints listos en su Service: 0 | readiness a `/health`; la app expone `/salud` (404) |
| reinicios de `api` en 90 s | **4** (entre 2 pods) | liveness a `/salud`; la app expone `/salud/vivo` (404): Kubernetes reinicia el contenedor cada ~30 s |
| Service `api` tipo LoadBalancer | EXTERNAL-IP `<pending>` | kind no trae balanceador; se entra con Gateway API (KD) o `port-forward` |
| 200 peticiones (10/s × 20 s) a `http://api.s11-ka/cotizacion` desde un pod | **0 correctas**, 200 fallidas (ECONNREFUSED: 200) | `targetPort: 8080`; el contenedor escucha en 3000 |
| ConfigMap `api-config` | no lo lee nadie | el Deployment no tiene `envFrom`; `MONEDA` no existe |
| Secret con `data:` en base64, en el repositorio | aceptado por los dos | base64 no es cifrado (KC); el secreto no va en el repo (S02) |

Mensajes `Unhealthy` distintos en los eventos:

- `Liveness probe failed: HTTP probe failed with statuscode: 404`
- `Readiness probe failed: Get "http://10.244.0.38:3001/health": dial tcp 10.244.0.38:3001: connect: connection refused`
- `Readiness probe failed: HTTP probe failed with statuscode: 404`

## 4. `despues/`

- `kubectl apply --dry-run=server -f despues/`: **0 errores**
- kube-linter sobre `despues/`: **0 hallazgos** (una excepción declarada con su motivo en `api.yaml`: `no-anti-affinity`, un solo nodo en kind)
- 200 peticiones (10/s × 20 s) a `http://api.s11/cotizacion` desde un pod: **200 correctas**, 0 fallidas

## Cuenta de hallazgos

| Quién lo encontró | Defectos |
|---|---|
| `--dry-run=server` | 7 |
| kube-linter (después del servidor) | 11 |
| Solo al ejecutar: readiness de `precios`, liveness de `api`, `targetPort`, LoadBalancer, ConfigMap sin uso | 5 |
| Ninguna de las dos: el secreto en el repositorio (lo encuentra `gitleaks`, S02) y la clave como valor literal en `env` (`env-var-secret` de kube-linter solo mira nombres que contienen `secret`; `API_KEY` no lo dispara) | 2 |
