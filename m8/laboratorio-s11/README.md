# Laboratorio de la sesión 11: su servicio en kind

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 11 (miércoles 4 de noviembre de 2026)

- **En clase:** 35 minutos, después del bloque de Kubernetes desde el desarrollador. Lo que no terminen en clase lo completan en casa.
- **Quién:** cada grupo, con **un solo servicio sin estado** de su `compose.yaml` (la API, o un servicio que no guarde datos propios). La base de datos y el broker se quedan fuera.
- **Qué se hace:** escriben a mano los manifiestos de ese servicio a partir de las plantillas de [`plantillas/`](plantillas/), lo levantan en un clúster local de **kind**, le hacen una petición y rompen una *probe* a propósito para ver qué pasa.
- **Inicia la actividad 8** (manifiestos de Kubernetes): carpeta `k8s/` en el repositorio del grupo, **fecha sugerida: miércoles 11 de noviembre, 23:59**; se reciben hasta el **viernes 13 de noviembre, 23:59**. Ver «[Seguir en casa](#seguir-en-casa-hacia-la-actividad-8)».
- **Sin IA.** Este laboratorio se hace a mano: sin asistentes de IA, ni para escribir los manifiestos ni para leer los errores. La idea es que cada uno sepa qué hace cada línea antes de pedirle manifiestos a una IA (eso se revisa en el bloque de clase con `--dry-run=server` y un *linter*).

## Palabras que se usan aquí

- **kind** (*Kubernetes in Docker*): un clúster de Kubernetes completo que corre dentro de un contenedor de Docker en su máquina. Sirve para probar; no es un clúster de producción.
- **Nodo**: la máquina donde corren los pods. En kind, el nodo es el contenedor `lab-s11-control-plane`.
- **Pod**: uno o más contenedores que Kubernetes arranca juntos. Aquí, un pod = un contenedor de su servicio.
- **Probe**: una comprobación periódica que hace Kubernetes contra su contenedor (aquí, un `GET` a su endpoint de salud). La **readiness** decide si el pod recibe tráfico; la **liveness** decide si hay que reiniciarlo.
- **Ready**: el pod pasó su readiness. `kubectl get pods` lo muestra como `1/1` en la columna `READY`.

---

## Tarea previa obligatoria (antes de la clase del miércoles 4 de noviembre)

La primera vez, crear el clúster baja una imagen de **388 MB** (1,34 GB en disco) y construir la imagen de su servicio puede bajar otra base y todas sus dependencias. Con la red del aula eso no entra en 35 minutos: **lleguen con los pasos 1 a 4 hechos** y comprobados en su máquina. Cada integrante que vaya a trabajar en su computadora hace la tarea previa en ella.

Necesitan **Docker** Desktop (Windows o macOS) o Docker Engine (Linux), encendido: `docker version` debe mostrar **Client** y **Server**. Unos **3 GB libres** en disco.

### 1. Instalar kind v0.33 y kubectl

**Windows** (PowerShell):

```
winget install --id Kubernetes.kind --version 0.33.0 --source winget
winget install --id Kubernetes.kubectl --source winget
```

Cierren y vuelvan a abrir la terminal (winget agrega los programas al PATH, y las terminales ya abiertas no lo ven). Docker Desktop trae su propio `kubectl`; si ya lo tienen, sirve (versión 1.36 o superior) y pueden saltar la segunda línea.

Sin winget, descarguen los binarios a una carpeta que esté en su PATH:

```
curl.exe -Lo kind.exe https://kind.sigs.k8s.io/dl/v0.33.0/kind-windows-amd64
curl.exe -Lo kubectl.exe https://dl.k8s.io/release/v1.37.1/bin/windows/amd64/kubectl.exe
```

**macOS** (con Homebrew):

```
brew install kind kubectl
```

Homebrew instala la última versión de kind; comprueben que `kind version` diga 0.33 o superior. Para la versión exacta, sin Homebrew (Apple Silicon; en Intel cambien `arm64` por `amd64`):

```
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.33.0/kind-darwin-arm64
curl -Lo ./kubectl https://dl.k8s.io/release/v1.37.1/bin/darwin/arm64/kubectl
chmod +x ./kind ./kubectl
sudo mv ./kind ./kubectl /usr/local/bin/
```

**Linux** (x86-64; en ARM cambien `amd64` por `arm64`):

```
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-amd64
curl -Lo ./kubectl https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl
chmod +x ./kind ./kubectl
sudo mv ./kind ./kubectl /usr/local/bin/
```

Comprueben:

```
kind version
kubectl version --client
```

Deben ver `kind v0.33.0` (o superior) y `Client Version: v1.36` o superior.

### 2. Crear el clúster

Desde la carpeta `plantillas/` de este laboratorio (ahí está [`kind.yaml`](plantillas/kind.yaml)):

```
kind create cluster --name lab-s11 --config kind.yaml
```

Termina con `Set kubectl context to "kind-lab-s11"`. Comprueben que `kubectl` habla con este clúster (y no con otro, por ejemplo el de Docker Desktop):

```
kubectl config current-context
kubectl get nodes
```

Deben ver `kind-lab-s11` y un nodo `lab-s11-control-plane` en estado `Ready`, versión `v1.37.0`.

### 3. Construir la imagen de su servicio

Elijan el servicio sin estado de su `compose.yaml` y construyan su imagen con una **etiqueta fija** (aquí `:lab`, no `:latest`; el porqué está en «[Problemas típicos](#problemas-típicos)»):

```
docker build -t mi-servicio:lab ruta/a/la/carpeta/del/servicio
```

Si ya la construyen con Compose, pueden reetiquetar la que sale de ahí (Compose la llama `<proyecto>-<servicio>`; `docker images` les muestra el nombre):

```
docker compose build api
docker tag miproyecto-api:latest mi-servicio:lab
```

Si todos sus servicios necesitan la base de datos o el broker **para arrancar**, elijan el que menos dependa. Si ninguno arranca solo, traigan también construida la imagen de [`ejemplo/`](ejemplo/) (una API mínima en Node 24, sin dependencias) para hacer el laboratorio con ella en clase y pasar a su servicio en casa. Desde la carpeta de este laboratorio (`m8/laboratorio-s11/`):

```
docker build -t ejemplo-api:lab ejemplo
kind load docker-image ejemplo-api:lab --name lab-s11
```

### 4. Cargar la imagen en el clúster

El nodo de kind **no ve** las imágenes de su Docker: hay que copiarlas dentro.

```
kind load docker-image mi-servicio:lab --name lab-s11
```

Comprueben que quedó en el nodo:

```
docker exec lab-s11-control-plane crictl images
```

Debe aparecer `docker.io/library/mi-servicio` con la etiqueta `lab`. Cada vez que reconstruyan la imagen, vuelvan a ejecutar `kind load` (o el nodo seguirá usando la anterior).

Si van a apagar la computadora antes de la clase, no borren el clúster: al volver a encender Docker, el contenedor del nodo arranca de nuevo con la imagen cargada. Si algo se rompe, `kind delete cluster --name lab-s11` y repitan los pasos 2 y 4.

### Cuánto tarda cada paso la primera vez

Medido en la máquina del docente con la API de [`ejemplo/`](ejemplo/), una corrida por paso (dos para crear el clúster y cargar la imagen). Es una referencia: su red y su servicio cambian las cifras.

| Paso | Tiempo medido | Qué depende de ustedes |
|---|---|---|
| 1. Descargar kind (10,8 MB) y kubectl (63 MB, Windows) | 2,3 s y 2,6 s (descarga directa a ≈ 26 MB/s) | Con winget o Homebrew no se midió. |
| 2a. Bajar la imagen del nodo `kindest/node:v1.37.0` (solo la primera vez) | 388 MB comprimidos: 15 s de descarga a ≈ 26 MB/s (≈ 200 Mbit/s) | **Con una red de 20 Mbit/s son unos 2,5–3 minutos**, más la descompresión (no se midió aparte). Es el paso que más pesa: háganlo en casa. |
| 2b. `kind create cluster` con la imagen ya bajada | 23 s y 26 s | — |
| 3. `docker build` del ejemplo (base `node:24` slim ya bajada, 81 MB comprimidos) | 1,5 s y 1,8 s | Su servicio tarda bastante más la primera vez: baja su imagen base y sus dependencias (`npm ci`, Maven o Gradle). |
| 4. `kind load docker-image` (imagen de 330 MB en disco) | 15 s y 17 s | Crece con el tamaño de su imagen. |
| En clase: `kubectl apply` hasta el pod Ready | 1,4 s y 1,8 s | Un servicio Spring tarda más en arrancar (ver *startupProbe*). |
| En clase: readiness rota | el pod nuevo queda `0/1` desde el primer chequeo y no se reinicia | — |
| En clase: liveness rota (`periodSeconds: 10`, `failureThreshold: 3`) | primer reinicio a los ≈ 30 s; 4 reinicios en 2 min; `CrashLoopBackOff` a los ≈ 2,5 min | — |
| En clase: arreglar la probe y volver a aplicar | ≈ 1,5 s hasta Ready | — |

Banco de pruebas: Intel Core i9-12900H, 64 GB de RAM, Windows 11, Docker Desktop 4.96.1 (WSL2), Docker 29.9, kind 0.33.0, kubectl 1.37.1, nodo Kubernetes 1.37.0.

---

## Qué hay en esta carpeta

| Archivo | Qué es |
|---|---|
| [`plantillas/kind.yaml`](plantillas/kind.yaml) | El clúster: un solo nodo, sin puertos publicados (se llega con `kubectl port-forward`). |
| [`plantillas/deployment.yaml`](plantillas/deployment.yaml) | Deployment con `TODO`: imagen, puerto, ConfigMap, Secret (como variable o como archivo), readiness, liveness, `requests/limits`. |
| [`plantillas/service.yaml`](plantillas/service.yaml) | Service `ClusterIP` con `TODO`: nombre, selector y puerto destino. |
| [`plantillas/configmap.yaml`](plantillas/configmap.yaml) | ConfigMap con `TODO`: la configuración no secreta. |
| [`plantillas/secret.yaml`](plantillas/secret.yaml) | Secret con `TODO`: valores secretos (en el laboratorio, falsos). |
| [`plantillas/gateway.yaml`](plantillas/gateway.yaml) | Gateway `lab` listo para aplicar, sin `TODO` (para la actividad 8, en casa). |
| [`plantillas/httproute.yaml`](plantillas/httproute.yaml) | HTTPRoute con `TODO`: nombre, Gateway (`parentRefs`) y Service (`backendRefs`) (para la actividad 8, en casa). |
| [`ejemplo/`](ejemplo/) | API mínima en Node 24 sin dependencias (`GET /` y `GET /salud`, puerto 3000) y su `Dockerfile`. Sirve para probar el clúster o para hacer el laboratorio si su servicio no arranca solo. Lee `MENSAJE` del ConfigMap y la clave de `API_KEY` o del archivo `API_KEY_FILE`. |

Las plantillas **no aplican tal como están**: la mayoría de los `TODO_...` son valores que Kubernetes rechaza (nombres, puertos, cantidades de CPU y memoria), y `kubectl apply --dry-run=server` les dice cuál falta (por ejemplo, `metadata.name: Invalid value: "TODO_NOMBRE_SERVICIO-config"`). **No todos:** el servidor acepta como válidos la imagen (`TODO_IMAGEN:TODO_ETIQUETA`), la ruta de salud (`/TODO_RUTA_SALUD`), las etiquetas y las claves y valores del ConfigMap y del Secret. Un `TODO_` que se les cuele ahí pasa el `dry-run` y falla después (ver el paso 2).

---

## En clase (35 minutos)

Copien las cuatro plantillas del servicio (`deployment`, `service`, `configmap` y `secret`; sin `kind.yaml`, `gateway.yaml` ni `httproute.yaml`, que son para la actividad 8 en casa) a una carpeta `k8s/` en el repositorio del grupo y trabajen ahí. Lean cada comentario `TODO` antes de completarlo.

### Paso 1: completar los manifiestos (≈ 15 min)

1. **ConfigMap**: una clave por cada variable de entorno no secreta que hoy está en `environment:` de su `compose.yaml`. Lo que apunte a la base o al broker, déjenlo con un valor que no rompa el arranque, o sáquenlo.
2. **Secret**: las claves secretas que lee su servicio, con **valores falsos**. Elijan si su servicio las recibe como variable de entorno (opción A) o como archivo montado (opción B) y completen la parte que corresponde en el Deployment. Si montan el Secret como archivo, no le pongan `defaultMode: 0400`: los archivos son de root y una imagen que corre como usuario no root (como la de la S08) no podría leerlos (`EACCES`).
3. **Deployment**: nombre, etiquetas, imagen (`mi-servicio:lab`), puerto del contenedor, el endpoint de salud en la readiness, **su** liveness (que no consulte dependencias) y `requests/limits` con un valor razonable y el porqué en un comentario. Si su servicio es Spring o tarda en arrancar, agreguen una `startupProbe`.
4. **Service**: el mismo nombre de servicio, el selector igual a las etiquetas del pod y el `targetPort` igual al puerto del contenedor (o su nombre, `http`).

### Paso 2: validar contra el clúster sin crear nada

```
kubectl apply --dry-run=server -f k8s/
```

Deben ver cuatro líneas `... created (server dry run)`. Si sale un error, léanlo: dice el archivo, el campo y por qué.

**Qué no detecta el `dry-run`:** un `TODO_` en la imagen, en la ruta de salud o en las claves del ConfigMap y del Secret pasa limpio. Búsquenlos antes de aplicar (si no sale nada, no quedó ninguno):

```
grep -rn TODO k8s/
```

Si se les escapa uno, lo notan en el paso 3: el pod no llega a `1/1`, queda en `ErrImagePull` o `ImagePullBackOff` (imagen), la *readiness* falla con `statuscode: 404` (ruta de salud) o el contenedor no encuentra su variable o su archivo (clave).

### Paso 3: aplicar y esperar a que el pod esté Ready

```
kubectl apply -f k8s/
kubectl get pods -w
```

(`-w` se queda mirando los cambios; Ctrl+C para salir.) **Criterio de éxito:** el pod de su servicio en `1/1 Running` y `RESTARTS` en `0`. Si no llega, `kubectl describe pod <nombre-del-pod>` (la sección `Events`, al final) y `kubectl logs <nombre-del-pod>` dicen por qué.

### Paso 4: una petición con respuesta 200

En una terminal aparte (se queda abierta mientras la usan):

```
kubectl port-forward service/mi-servicio 18560:80
```

Y en otra:

```
curl -i http://localhost:18560/salud
```

(En PowerShell, `curl.exe`; `curl` a secas es otro comando.) **Criterio de éxito:** `HTTP/1.1 200 OK`. Prueben también una ruta de su API que no necesite la base. Se usa el puerto local 18560 para no chocar con los que ya usa su `compose.yaml`; si está ocupado, elijan otro.

### Paso 5: romper una probe a propósito y arreglarla

Elijan **una** de las dos (si les sobra tiempo, la otra) y anoten lo que ven:

- **Readiness rota.** Cambien `path` de la readiness a una ruta que no existe (por ejemplo `/salud-no-existe`) y `kubectl apply -f k8s/`. Con `kubectl get pods -w` verán aparecer un pod nuevo que se queda en `0/1` y **no se reinicia**; el anterior sigue `1/1` y atendiendo, porque Kubernetes no retira el pod viejo hasta que el nuevo esté `Ready`: por eso el servicio sigue respondiendo mientras el pod roto no se arregla. `kubectl describe pod <pod-nuevo>` muestra `Readiness probe failed: HTTP probe failed with statuscode: 404`.
- **Liveness rota.** Cambien el `port` de la liveness a uno en el que su proceso no escucha (por ejemplo, 3001 si escucha en 3000) y apliquen. El pod sigue `1/1` unos segundos y después `RESTARTS` empieza a subir: Kubernetes lo mata y lo vuelve a arrancar cada vez que la liveness falla 3 veces seguidas, y tras varios reinicios lo deja en `CrashLoopBackOff`. `kubectl describe pod` muestra `Liveness probe failed: ... connection refused` y `Container ... failed liveness probe, will be restarted`. Fíjense en el `Exit Code` de `Last State`: si su servicio hace el apagado limpio de la S02, sale con 0.

Arréglenla, vuelvan a aplicar y comprueben otra vez el criterio de éxito: pod `1/1`, `RESTARTS` en 0 (es un pod nuevo) y `200` por `port-forward`. **Vuelvan a lanzar el `port-forward`**: se corta cuando el pod al que apuntaba se reinicia o se reemplaza.

### Criterio de éxito del laboratorio, en resumen

1. `kubectl get pods`: el pod de su servicio en `1/1 Running`.
2. `curl` a través de `kubectl port-forward`: `200`.
3. Una probe rota a propósito (lo que vieron, con el mensaje de `kubectl describe`) y arreglada (otra vez `1/1` y `200`).

---

## Seguir en casa hacia la actividad 8

La actividad 8 es la carpeta **`k8s/`** del repositorio del grupo con los manifiestos de su servicio. Fecha sugerida: **miércoles 11 de noviembre, 23:59**; se reciben hasta el **viernes 13 de noviembre, 23:59**.

**Qué se entrega:**

- Los manifiestos en `k8s/`: **Deployment** (con *probes* y `requests/limits`), **Service**, **ConfigMap** y **HTTPRoute**, más el **Secret** solo con valores falsos (los reales se crean por comando, ver el paso 3).
- La **HTTPRoute** (la escriben ustedes) apunta a **su** Service a través del Gateway `lab` (Gateway API). El script del docente `demo-k8s/scripts/instalar-gateway` instala el controlador (Envoy Gateway) y deja la GatewayClass `eg`; el Gateway `lab` lo crean aplicando [`plantillas/gateway.yaml`](plantillas/gateway.yaml) tal como está. Ni el controlador ni el Gateway hace falta entenderlos.
- La salida limpia de `kubectl apply --dry-run=server -f k8s/`.
- La salida de **kube-linter** sobre `k8s/`, con cada hallazgo **corregido o justificado** por escrito (por ejemplo, en un comentario del manifiesto o en `k8s/README.md`).
- La evidencia del laboratorio: pods `Ready`, un `200` y una *probe* rota a propósito y arreglada.

Desde lo que dejaron en clase:

1. Si en clase usaron `ejemplo/`, repitan los pasos 3 y 4 de la tarea previa y los pasos 1 a 5 de la clase con **su** servicio.
2. Revisen la liveness y la readiness con lo visto en clase: qué comprueba cada una, qué pasa si se cae la base o el broker, y si hace falta `startupProbe`.
3. Dejen en el `Secret` del repositorio **solo valores falsos**. Los reales se crean desde la máquina, sin archivo:

   ```
   kubectl create secret generic mi-servicio-secret --from-literal=API_KEY=valor-real
   ```

4. Instalen el controlador del Gateway. Necesitan la carpeta `m8/demo-k8s/` de este repositorio y **Node.js 24 o superior** (el script no tiene dependencias: no hay `npm install`). Con el clúster `kind-lab-s11` activo, desde la raíz de este repositorio:

   ```
   node --no-warnings m8/demo-k8s/scripts/instalar-gateway.ts
   ```

   Tarda cerca de 1 minuto (baja Envoy Gateway v1.9.2) y termina con `GatewayClass "eg" accepted`. Después copien [`plantillas/gateway.yaml`](plantillas/gateway.yaml) y [`plantillas/httproute.yaml`](plantillas/httproute.yaml) a `k8s/` y apliquen el Gateway, sin cambiarlo:

   ```
   kubectl apply -f k8s/gateway.yaml
   ```

   Escriban la **HTTPRoute**: `parentRefs` hacia el Gateway `lab` y `backendRefs` hacia el nombre y el `port` de **su** Service. Con el Gateway aplicado, `kubectl get httproute <nombre> -o yaml` debe mostrar `Accepted` y `ResolvedRefs` en `True` en `status.parents[].conditions`; si `ResolvedRefs` es `False`, casi siempre el Service o el puerto del `backendRefs` no existe.

   Prueben que la ruta enruta. En kind no hay balanceador, así que `kubectl get gateway lab` mostrará `Programmed=False` (`AddressNotAssigned`) aunque el Gateway funcione: es lo esperado en kind y no es un error. Para llegar a él, hagan `port-forward` al Service que el controlador crea para el Gateway (vive en el namespace `envoy-gateway-system`) y, en otra terminal, una petición a una ruta que su HTTPRoute declare:

   ```
   kubectl -n envoy-gateway-system get svc -l gateway.envoyproxy.io/owning-gateway-name=lab,gateway.envoyproxy.io/owning-gateway-namespace=default
   kubectl -n envoy-gateway-system port-forward svc/<nombre-que-salio-arriba> 18561:80
   curl -i http://localhost:18561/<ruta-de-su-HTTPRoute>
   ```

   (Si el Gateway lo aplicaron en otro namespace, cambien `default` por ese. Si el Service aún no aparece, esperen unos segundos a que el pod de Envoy esté `Running`. Una ruta que no declaren devuelve `404` del propio Gateway.)
5. Instalen **kube-linter** (desde su página de versiones en GitHub o con `brew install kube-linter`) y ejecútenlo sobre la carpeta:

   ```
   kube-linter lint --include no-readiness-probe,no-liveness-probe k8s/
   ```

   Por omisión kube-linter **no** revisa las *probes*; con `--include` sí. Sin esa opción, un Deployment sin *liveness* pasa sin aviso.

   Corrijan cada hallazgo o, si deciden no corregirlo, justifíquenlo por escrito (qué avisa y por qué lo dejan así).
6. Dejen en el README del repositorio (o en `k8s/README.md`) los comandos, en orden, para levantar su servicio en kind desde cero: crear el clúster, construir, `kind load`, `node --no-warnings m8/demo-k8s/scripts/instalar-gateway.ts`, `kubectl apply -f k8s/gateway.yaml`, `kubectl apply -f k8s/`, `port-forward`.
7. Antes de entregar, desde un clúster recién creado: `kubectl apply --dry-run=server -f k8s/` sin errores, `kube-linter lint --include no-readiness-probe,no-liveness-probe k8s/` con los hallazgos corregidos o justificados, y los tres puntos del criterio de éxito.

---

## Problemas típicos

| Síntoma | Causa más común | Qué hacer |
|---|---|---|
| Pod en `ErrImagePull` o `ImagePullBackOff`; en `kubectl describe pod`: `pull access denied, repository does not exist or may require authorization` | No ejecutaron `kind load docker-image`, la cargaron en otro clúster (falta `--name lab-s11`) o el nombre o la etiqueta del manifiesto no es igual al de `docker images` | `kind load docker-image mi-servicio:lab --name lab-s11` y comprueben con `docker exec lab-s11-control-plane crictl images`. Después `kubectl delete pod <pod>` para que lo intente de nuevo sin esperar. |
| `ImagePullBackOff` **aunque** la imagen está cargada | La etiqueta es `:latest` (o no tiene etiqueta). Con `:latest`, Kubernetes pone `imagePullPolicy: Always` si no se dice otra cosa y va siempre a buscarla a Docker Hub, donde no existe | Etiqueta fija (`:lab`) e `imagePullPolicy: IfNotPresent`, como en la plantilla. |
| Sigue corriendo la versión vieja de su código | Reconstruyeron la imagen pero no la volvieron a cargar, o la cargaron pero el pod es el de antes | `kind load docker-image ...` otra vez y `kubectl delete pod -l app=mi-servicio`: el Deployment crea un pod nuevo con la imagen cargada. |
| Pod en `0/1 Running` que nunca llega a `1/1`, sin reinicios | La **readiness** apunta mal: ruta que no existe (`statuscode: 404`), puerto equivocado (`connection refused`) o el endpoint de salud depende de la base que no está | `kubectl describe pod` → `Events`. Corrijan `path` y `port` (mejor por nombre: `port: http`). |
| `RESTARTS` sube solo y termina en `CrashLoopBackOff` | La **liveness** apunta mal, o consulta una dependencia caída, o su servicio tarda en arrancar más de lo que la liveness espera (típico de Spring) | Que la liveness solo compruebe que el proceso responde; para el arranque lento, `startupProbe`. `kubectl logs <pod> --previous` muestra los logs del contenedor anterior al reinicio. |
| `CrashLoopBackOff` desde el principio, con el proceso terminando solo | Su servicio no arranca: falta una variable, no encuentra la base | `kubectl logs <pod>` (o `--previous`). Agreguen la variable al ConfigMap o elijan un servicio que arranque sin la base. |
| Pod en `CreateContainerConfigError`; `Error: configmap "..." not found` (o `secret`) | El nombre del ConfigMap o del Secret en el Deployment no coincide con el del manifiesto, o no lo aplicaron | Igualen los nombres y `kubectl apply -f k8s/` (la carpeta entera). |
| Las probes y el `port-forward` dan `connection refused` aunque el proceso dice que escucha | Su servicio escucha en `127.0.0.1` (o `localhost`) dentro del contenedor: desde fuera del contenedor no se llega | Que escuche en `0.0.0.0` (todas las interfaces). |
| `port-forward` dice `error forwarding port 8080 to pod ...` y `lost connection to pod` | El `targetPort` del Service no es el puerto en el que escucha el contenedor | `targetPort: http` (el nombre del puerto del Deployment) o el número correcto. |
| `kubectl port-forward service/...` se queda esperando y al minuto dice `timed out waiting for the condition` | El `selector` del Service no coincide con las etiquetas del pod: no encuentra ningún pod | Igualen `spec.selector` del Service con `spec.template.metadata.labels` del Deployment. |
| `Unable to listen on port 18560: ... bind: Only one usage of each socket address` (o `address already in use`) | El puerto local está ocupado (otro `port-forward` abierto, o su Compose) | Cierren el otro `port-forward` o usen otro puerto local: `18561:80`. |
| `curl` funcionaba y dejó de responder | El `port-forward` se corta cuando el pod se reinicia o se reemplaza | Vuelvan a lanzar `kubectl port-forward`. |
| `kubectl` dice que no encuentra sus recursos, o muestra otros | `kubectl` apunta a otro clúster (por ejemplo, el de Docker Desktop) | `kubectl config use-context kind-lab-s11`. |
| `kind load docker-image` falla con `content digest ... not found` | La imagen es multiplataforma (varias arquitecturas) y `kind` no logra importarla desde el daemon de Docker | `docker save <imagen> -o img.tar` y después `kind load image-archive img.tar --name lab-s11`. |
| `kind create cluster` falla con un error de Docker | Docker no está encendido, o no tiene memoria o disco suficientes | `docker version` debe mostrar **Server**; liberen espacio (`docker system df`). |

---

## Bajar todo

Cuando terminen la actividad 8:

```
kind delete cluster --name lab-s11
```

(Borra el contenedor del nodo y todo lo que había dentro. La imagen del nodo queda en Docker para la próxima vez.)
