# Solución del docente: laboratorio S09 «Su servicio en kind»

Manifiestos completos, sin `TODO`, para el servicio de [`../ejemplo/`](../ejemplo/) (API mínima en Node 24: `GET /`, `GET /salud`, puerto 3000). Es una referencia para comparar **después** de hacer el laboratorio a mano. Cada `TODO` de [`../plantillas/`](../plantillas/) aparece resuelto con un comentario `RESUELTO (TODO ...)` que explica el porqué.

## Qué resuelve cada archivo

| Archivo | Qué resuelve |
|---|---|
| [`k8s/configmap.yaml`](k8s/configmap.yaml) | ConfigMap `ejemplo-api-config` con `PORT` (`"3000"`, igual al `containerPort`) y `MENSAJE` (el texto de `GET /`). Los valores van entre comillas porque siempre son texto. |
| [`k8s/secret.yaml`](k8s/secret.yaml) | Secret `ejemplo-api-secret` con la clave `API_KEY` y un **valor falso**. El real se crea por comando (ver el paso 5). |
| [`k8s/deployment.yaml`](k8s/deployment.yaml) | Deployment `ejemplo-api`: imagen fija `ejemplo-api:lab` con `IfNotPresent`; puerto con nombre `http` (3000); ConfigMap por `envFrom`; Secret **como archivo** (opción B: volumen `secretos` en `/etc/secretos`, `API_KEY_FILE=/etc/secretos/API_KEY`, sin `defaultMode`; la opción A queda comentada); `startupProbe`, `readinessProbe` y `livenessProbe` a `GET /salud` por el puerto `http`, con la liveness más tolerante que la readiness; `requests` (50m, 64Mi) y `limits` de memoria (128Mi) explicados; `securityContext` como en `demo-k8s/despues/` más `runAsUser: 1000` (ver la nota), `capabilities.drop: ["ALL"]` y `seccompProfile: RuntimeDefault` (nivel *restricted* de Pod Security). |
| [`k8s/service.yaml`](k8s/service.yaml) | Service `ejemplo-api` `ClusterIP`: selector `app: ejemplo-api` (igual a las etiquetas del pod), puerto 80 hacia `targetPort: http`. |
| [`gateway/gateway.yaml`](gateway/gateway.yaml) | El Gateway `lab` de la plantilla, sin cambios (no tenía `TODO`). |
| [`gateway/httproute.yaml`](gateway/httproute.yaml) | HTTPRoute `ejemplo-api`: `parentRefs` al Gateway `lab` y `backendRefs` al Service `ejemplo-api`, **puerto 80** (el del Service, no el 3000 del contenedor). |
| [`romper/deployment-readiness-rota.yaml`](romper/deployment-readiness-rota.yaml) | El mismo Deployment con un solo cambio: la readiness pide `/salud-no-existe` (404). |
| [`romper/deployment-liveness-rota.yaml`](romper/deployment-liveness-rota.yaml) | El mismo Deployment con un solo cambio: la liveness pregunta en el puerto 3001, donde nadie escucha. |

Están en carpetas separadas a propósito: `kubectl apply -f k8s/` aplica solo los cuatro del servicio. `gateway/` necesita antes las CRD de Gateway API, y `romper/` se aplica de a un archivo.

**Nota sobre `runAsUser: 1000`.** El [`Dockerfile`](../ejemplo/Dockerfile) de `ejemplo/` dice `USER node`, que es un **nombre**. Con `runAsNonRoot: true` y un usuario que no es un número, el kubelet no puede comprobar que no sea root y el pod queda en `CreateContainerConfigError` (`image has non-numeric user (node), cannot verify user is non-root`). Hay dos salidas: `USER 1000` en el Dockerfile (es lo que hace `demo-k8s/app/api/Dockerfile`) o `runAsUser: 1000` en el manifiesto. Aquí se eligió el manifiesto para no tocar `ejemplo/`.

## La demostración, en orden

Desde la carpeta `m8/laboratorio-s11/`. Necesita Docker encendido, kind v0.33.0 y kubectl 1.36 o superior. Los comandos sirven en Git Bash y en PowerShell salvo donde se indica (en PowerShell, `curl.exe` en lugar de `curl`).

### 1. Crear el clúster y comprobar el contexto

Un nodo, sin puertos publicados:

```
kind create cluster --name lab-s11 --config plantillas/kind.yaml
kubectl config current-context          # kind-lab-s11
kubectl get nodes                       # lab-s11-control-plane   Ready
```

### 2. Construir la imagen y cargarla en el nodo

```
docker build -t ejemplo-api:lab ejemplo
kind load docker-image ejemplo-api:lab --name lab-s11
```

Comprobar que quedó en el nodo (debe salir `docker.io/library/ejemplo-api  lab`):

```
# Git Bash
docker exec lab-s11-control-plane crictl images | grep ejemplo-api
# PowerShell
docker exec lab-s11-control-plane crictl images | Select-String ejemplo-api
```

### 3. Validar contra el clúster sin crear nada, y buscar `TODO_` que el servidor no ve

```
kubectl apply --dry-run=server -f solucion/k8s/   # cuatro líneas "... created (server dry run)"
```

Buscar marcadores sin resolver solo en los manifiestos (con `TODO` a secas salen los comentarios `RESUELTO (TODO ...)`; sin `--include` saldría además este README). No debe salir nada:

```
# Git Bash
grep -rn TODO_ --include=*.yaml solucion/
# PowerShell
Get-ChildItem solucion -Recurse -Filter *.yaml | Select-String TODO_
```

### 4. Aplicar y esperar a que el pod esté Ready

```
kubectl apply -f solucion/k8s/
kubectl get pods -l app=ejemplo-api -w            # 1/1 Running, RESTARTS 0 (Ctrl+C para salir)
```

### 5. Una petición con 200

El `port-forward` va en otra terminal y se queda abierto:

```
kubectl port-forward service/ejemplo-api 18560:80
curl -i http://localhost:18560/salud              # HTTP/1.1 200 OK  {"estado":"ok"}
curl -s http://localhost:18560/                   # {"mensaje":"Hola desde kind (ConfigMap ejemplo-api-config)","secreto_configurado":true,"pod":"ejemplo-api-..."}
```

`secreto_configurado: true` prueba que el Secret llegó como archivo y que el usuario 1000 lo puede leer.

**El Secret real, sin archivo.** Para no subir nunca un valor real, se pisa el falso por comando (el Deployment no cambia; el pod lee el archivo al responder, así que basta con esperar a que kubelet actualice el volumen, o `kubectl rollout restart deployment/ejemplo-api`):

```
kubectl create secret generic ejemplo-api-secret --from-literal=API_KEY=valor-real --dry-run=client -o yaml | kubectl apply -f -
```

Cuidado: un nuevo `kubectl apply -f solucion/k8s/` vuelve a aplicar `secret.yaml` y **pisa el valor real con el falso**. Después de reaplicar la carpeta, repitan este comando (o apliquen los otros tres archivos uno por uno).

### 6. Romper la readiness y arreglarla

```
kubectl apply -f solucion/romper/deployment-readiness-rota.yaml
kubectl get pods -l app=ejemplo-api -w
kubectl describe pod <pod-nuevo>          # sección Events, al final
```

Lo que se ve: aparece un pod **nuevo** que queda en `0/1 Running` y **no se reinicia** (`RESTARTS 0`); el pod anterior sigue `1/1` y atendiendo, porque con 1 réplica el Deployment no retira el viejo hasta que el nuevo esté listo. El `curl` por el `port-forward` sigue dando 200 (contesta el pod viejo). En `Events`: `Readiness probe failed: HTTP probe failed with statuscode: 404`.

Arreglada:

```
kubectl apply -f solucion/k8s/deployment.yaml
kubectl get pods -l app=ejemplo-api       # un solo pod 1/1 Running, RESTARTS 0
```

### 7. Romper la liveness y arreglarla

```
kubectl apply -f solucion/romper/deployment-liveness-rota.yaml
kubectl get pods -l app=ejemplo-api -w
kubectl describe pod <pod-nuevo>
```

Lo que se ve: el pod nuevo pasa la `startupProbe` y la readiness (siguen en el puerto `http`) y queda `1/1`; a los ≈ 30 s (3 fallas × 10 s) `RESTARTS` pasa a 1, y sigue subiendo hasta `CrashLoopBackOff` tras varios reinicios (la guía midió con este mismo `periodSeconds: 10` y `failureThreshold: 3`: primer reinicio a ≈ 30 s, 4 reinicios en 2 min, `CrashLoopBackOff` a ≈ 2,5 min). En `Events`: `Liveness probe failed: Get "http://10.244.0.x:3001/salud": dial tcp ...: connect: connection refused` y `Container ejemplo-api failed liveness probe, will be restarted`. En `Last State: Terminated`, `Exit Code: 0`: `server.mjs` hace el apagado limpio al recibir `SIGTERM`. `kubectl logs <pod> --previous` termina en `SIGTERM received, closing`.

Arreglada:

```
kubectl apply -f solucion/k8s/deployment.yaml
kubectl get pods -l app=ejemplo-api       # pod nuevo 1/1 Running, RESTARTS 0
kubectl port-forward service/ejemplo-api 18560:80    # volver a lanzarlo: se corta al reemplazar el pod
curl -i http://localhost:18560/salud                 # HTTP/1.1 200 OK
```

### 8. Opcional: la HTTPRoute por el Gateway

Desde la raíz del repositorio (necesita Node.js 24 o superior):

```
node --no-warnings m8/demo-k8s/scripts/instalar-gateway.ts    # termina con GatewayClass "eg" accepted
kubectl apply -f m8/laboratorio-s11/solucion/gateway/
kubectl get httproute ejemplo-api -o yaml                     # Accepted=True y ResolvedRefs=True en status.parents[].conditions
kubectl -n envoy-gateway-system get svc -l gateway.envoyproxy.io/owning-gateway-name=lab,gateway.envoyproxy.io/owning-gateway-namespace=default
kubectl -n envoy-gateway-system port-forward svc/<nombre-que-salio-arriba> 18561:80
curl -i http://localhost:18561/salud                          # HTTP/1.1 200 OK
```

`kubectl get gateway lab` muestra `Programmed=False` (`AddressNotAssigned`): en kind no hay balanceador y es lo esperado.

### 9. kube-linter y kubeconform, y bajar todo

Desde `m8/laboratorio-s11/` otra vez (si hicieron el paso 8 están en la raíz del repositorio: `cd m8/laboratorio-s11`). Las dos herramientas corren en un contenedor, sin instalar nada:

```
# Git Bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/solucion/k8s:/m:ro" stackrox/kube-linter:v0.8.3 lint /m
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/solucion/k8s:/m:ro" stackrox/kube-linter:v0.8.3 lint --include no-readiness-probe,no-liveness-probe /m
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/solucion/k8s:/m:ro" ghcr.io/yannh/kubeconform:v0.6.7 -strict -summary /m
# PowerShell: las mismas tres líneas sin MSYS_NO_PATHCONV=1 y con -v "${PWD}/solucion/k8s:/m:ro"

kind delete cluster --name lab-s11
```

Resultado esperado: `No lint errors found!` en las dos de kube-linter y `Valid: 4, Invalid: 0, Errors: 0` en kubeconform (ver abajo).

## Qué se validó y qué no

Validado el 9 nov 2026 en la máquina del docente (Windows 11, kubectl v1.36.1, Docker 29.9.2), **sin clúster**:

- **Los ocho manifiestos se leen como objetos de Kubernetes**: `kubectl label --local --dry-run=client -o name -f k8s/ -f gateway/ -f romper/ check=ok` lista `configmap/ejemplo-api-config`, `deployment.apps/ejemplo-api`, `secret/ejemplo-api-secret`, `service/ejemplo-api`, `gateway.gateway.networking.k8s.io/lab`, `httproute.gateway.networking.k8s.io/ejemplo-api` y los dos `deployment.apps/ejemplo-api` de `romper/`. Esto comprueba el YAML y `apiVersion`/`kind`/nombre; los campos los comprueba kubeconform (siguiente punto).
- **Esquema, con kubeconform v0.6.7** (contenedor `ghcr.io/yannh/kubeconform:v0.6.7`, `-strict -summary`): sobre `k8s/`, `Summary: 4 resources found in 4 files - Valid: 4, Invalid: 0, Errors: 0, Skipped: 0`. Los dos de `romper/` también son válidos. Los de `gateway/` **no** se validan así: kubeconform no trae el esquema de las CRD de Gateway API (`could not find schema for Gateway` y `... for HTTPRoute`).
- **kube-linter v0.8.3** (contenedor `stackrox/kube-linter:v0.8.3`) sobre `k8s/`: `No lint errors found!`, tanto con los chequeos por omisión como con `--include no-readiness-probe,no-liveness-probe`. Sobre `romper/`: la readiness rota **pasa** (kube-linter no sabe que `/salud-no-existe` da 404) y la liveness rota da 1 hallazgo, que es justo el defecto puesto a propósito: `container "ejemplo-api" does not expose port 3001 for the HTTPGet (check: liveness-port, ...)`.
- **Coherencia entre archivos** (un script propio, no incluido): selectores iguales a las etiquetas del pod; `targetPort: http` existe en el contenedor; el ConfigMap y el Secret referenciados existen; `PORT` del ConfigMap igual al `containerPort`; `API_KEY_FILE` apunta a una clave del Secret montado; las tres *probes* a `/salud` por el puerto `http`; `requests`/`limits` declarados; `runAsUser` numérico no root; la HTTPRoute apunta al Gateway `lab` y al nombre y puerto 80 del Service. Todo OK.
- **`grep -rn TODO_ --include=*.yaml solucion/`**: sin resultados.
- **La imagen se comporta como espera el manifiesto**, en un contenedor de Docker (no en Kubernetes) con las mismas restricciones que el `securityContext` del pod: `--user 1000 --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt seccomp=builtin`, que corresponden a `runAsUser: 1000`, `readOnlyRootFilesystem`, `capabilities.drop: ["ALL"]`, `allowPrivilegeEscalation: false` y `seccompProfile: RuntimeDefault`; con las variables del ConfigMap y el Secret montado como archivo de solo lectura en `/etc/secretos/API_KEY`. Resultados: `GET /salud` → `HTTP/1.1 200 OK`; `GET /` → `{"mensaje":"Hola desde kind (ConfigMap ejemplo-api-config)","secreto_configurado":true,...}`; `GET /salud-no-existe` → `404 Not Found` (lo que verá la readiness rota); el puerto 3001 dentro del contenedor → `ECONNREFUSED` (lo que verá la liveness rota); `docker stop` (SIGTERM) → `ExitCode=0` y el log `SIGTERM received, closing`. `docker inspect` confirma `User=node` en la imagen (de ahí `runAsUser: 1000`).

**No validado:**

- `kubectl apply --dry-run=client` **no funciona sin un API server**: aun con `--validate=false`, kubectl pide al servidor la lista de tipos para mapear cada `kind` y falla (`unable to recognize ...: the server could not find the requested resource`). Por eso se usaron `kubectl label --local` y kubeconform.
- `kubectl apply --dry-run=server`, el clúster kind de punta a punta (pod `Ready`, `200` por `port-forward`, las dos *probes* rotas y arregladas, los mensajes exactos de `kubectl describe`) y la HTTPRoute con Envoy Gateway: **kind no está instalado** en esta máquina. Lo que dicen los pasos 6 y 7 sale de la guía y de la demo, no de una corrida de estos archivos. Para correrlo de verdad, instalen kind y kubectl como indica el paso 1 de la [guía](../README.md).
