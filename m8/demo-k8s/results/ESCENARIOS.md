# Resultados de la demo de Kubernetes (KA-KD)

Medido el 26 de octubre de 2026 en un portátil: Intel Core i9-12900H (20 hilos lógicos), 64 GB de RAM, Windows 11 (10.0.26200), Docker Desktop con WSL2 (motor 29.9.2). kind v0.33.0 con un nodo `kindest/node:v1.37.0`, kubectl v1.36.1, Node 24.19.0 en el anfitrión, imágenes `node:24.19.0-alpine`, kube-linter v0.8.3 y Envoy Gateway v1.9.2. La carga la genera un pod **dentro** del clúster ([`app/api/carga.mjs`](../app/api/carga.mjs)), que llama a los Services por nombre como otro servicio; así no se mide el `port-forward`.

KA se corrió 3 veces (conteos idénticos), KB 3 corridas por variante, KC 3 rotaciones (6 observaciones del archivo), KD una vez (solo comprueba que enruta). El detalle de cada escenario está en su archivo; los datos crudos, en [`raw/`](raw/).

## Resumen

| Escenario | Qué se hizo | antes | despues |
|---|---|---|---|
| **KA** manifiesto de IA ([detalle](KA_VALIDACION.md)) | `--dry-run=server` ronda por ronda, kube-linter, aplicar y mirar | **7 errores del servidor en 3 rondas**; **11 hallazgos de kube-linter**; con los dos en verde (`ka-2`): 4 reinicios en 90 s, `precios` 0/1 listo, **0 de 200 peticiones correctas** | 0 errores, 0 hallazgos, **200 de 200** |
| **KB** liveness con dependencia ([detalle](KB_PROBES.md)) | `precios` caído 90 s, 10 peticiones/s durante 240 s | **8 reinicios (8–9)**; los 2 pods de vuelta en el Service tras 2 s (2–56 s) | **0 reinicios**; los 2 pods de vuelta tras 0 s (0–2 s) |
| **KC** Secret ([detalle](KC_SECRETOS.md)) | base64, dónde aparece el valor, 3 rotaciones | variable: valor visible en `env` y `/proc/1/environ`; tras rotar, **no lo ve nunca** (0 de 3 a los 180 s) sin reiniciar | archivo: no está en el entorno; tras rotar lo ve sin reiniciar en **62,2 s** de mediana (26–83,6 s) |
| **KD** HTTPRoute ([detalle](KD_HTTPROUTE.md)) | 100 + 100 + 40 peticiones por el Gateway | — | `Accepted` y `ResolvedRefs` en `True`; 200 de 200 respuestas `200`; 40 de 40 `404` en rutas no declaradas |

## KA. Cada herramienta ve una capa

**Mecanismo.** El servidor decodifica cada objeto y se detiene en su primer error. Por eso los errores salen por tandas: en la ronda 1 el ConfigMap se queja del booleano, y solo en la 2 del número; el selector que no coincide con las etiquetas aparece recién en la 3, cuando el Deployment por fin se decodifica. Quien corrige «lo que dice el mensaje» y vuelve a aplicar necesita varias vueltas: conviene correr el `--dry-run=server` en un bucle, no una vez.

kube-linter mira buenas prácticas sobre objetos válidos: etiquetas `latest`, recursos sin declarar, root, disco escribible, Services que no seleccionan nada. Sobre el archivo original vio 7 hallazgos y no 11 porque **se salta sin avisar** los objetos que no puede decodificar (el ConfigMap y el Deployment `api`). Orden útil: primero el servidor, después el linter.

Y con los dos en verde, `ka-2` no funciona: ninguno sabe qué rutas expone la app (`/salud/vivo`, `/salud`), en qué puerto escucha el contenedor ni que kind no tiene balanceador. Eso solo aparece al aplicar y mirar: `kubectl get pods` (reinicios, `0/1`), `kubectl describe pod` (`Liveness probe failed: HTTP probe failed with statuscode: 404`) y una petición real. Las comprobaciones de *probes* de kube-linter (`--include no-readiness-probe,no-liveness-probe`) solo dicen si existen, no si apuntan bien.

## KB. La liveness reinicia; la readiness solo saca del Service

**Mecanismo.** En `antes` la liveness llama a `/salud/listo`, que consulta a `precios`. Al apagar `precios`, cada pod de `api` falla la liveness 3 veces (15 s), Kubernetes lo reinicia, el pod arranca bien, vuelve a fallar a los 15 s, y así: 8-9 reinicios en 90 s entre los 2 pods, con esperas crecientes entre uno y otro (*CrashLoopBackOff*). En `despues` la liveness solo mira el proceso; la readiness sí falla y saca a los 2 pods del Service en pocos segundos (2 fallos con sondeo cada 2 s), sin reiniciar nada; cuando `precios` vuelve, la readiness pasa y los pods vuelven al Service en el siguiente sondeo.

Las peticiones fallidas durante la caída son las mismas en las dos variantes (~905 de 2400): `/cotizacion` necesita a `precios` y ninguna probe lo arregla. La diferencia está en lo que pasa con la api: en `antes` se reinicia un proceso sano 8 veces, y en 1 de las 3 corridas uno de los pods quedó esperando su *backoff* y tardó **56 s** más que `precios` en volver al Service (la api trabajó a media capacidad ese tiempo). En las otras dos el reinicio coincidió con la vuelta de `precios` y no se notó.

**Hallazgo lateral: las conexiones ya abiertas no salen del Service.** En `despues`, con los 2 pods fuera del Service, ~875 de los ~905 fallos son `502` de la propia api, no `ECONNREFUSED`: el generador de carga reutiliza conexiones *keep-alive* abiertas antes de la caída, y sacar un pod del Service solo afecta a las conexiones **nuevas**. Es inofensivo aquí (la api contesta rápido que `precios` no responde), pero explica por qué un pod «no listo» puede seguir recibiendo peticiones.

**Hallazgo lateral: el apagado con *keep-alive*.** La primera versión de la api cerraba el servidor con `server.close()` al recibir `SIGTERM`, sin más. Con conexiones *keep-alive* ocupadas, `close()` espera a que el cliente las suelte, el cliente nunca las suelta y Kubernetes mata el proceso a los 30 s (`terminationGracePeriodSeconds`). En una corrida exploratoria de `antes` con esa versión, cada reinicio tardó ~45 s en vez de ~15 s y, después de que `precios` volvió, hubo **174 peticiones fallidas** y 17 s sin ningún `200`. La versión actual responde con `connection: close` mientras se apaga ([`server.mjs:64`](../app/api/server.mjs)) y las cifras de arriba son con ella. Esa corrida no se conserva en `raw/` (se midió antes de fijar el procedimiento); es el apagado limpio de la S02 visto desde Kubernetes.

## KC. base64 no es cifrado; el archivo se actualiza solo

**Mecanismo.** Un Secret guarda sus valores en base64, que es una codificación: `base64 -d` devuelve el valor sin ninguna clave. Quien puede leer Secrets en el espacio de nombres, o ve el YAML en el repositorio, tiene el valor. Por eso el Secret se crea con `kubectl create secret … --from-literal` y no desde un archivo del repo.

Como **variable**, Kubernetes copia el valor al entorno del proceso una sola vez, al crear el contenedor: aparece en `env`, en `/proc/1/environ` y en el entorno de cualquier proceso hijo, y si el Secret cambia, el proceso no se entera hasta que el pod se reinicia (0 de 3 rotaciones lo vieron a los 180 s; 3 de 3 tras `rollout restart`). Como **archivo**, el kubelet reescribe el archivo cuando el Secret cambia: la app, que lo lee en cada uso, ve el valor nuevo en 26-84 s sin reiniciar. Ese plazo depende de la sincronización periódica del kubelet, no de la app. Con `kubectl exec` el valor se lee igual de las dos formas: el archivo no protege de quien entra al contenedor.

## KD. La HTTPRoute enruta

El controlador (Envoy Gateway) crea un Deployment y un Service propios para el Gateway `demo`. En kind ese Service es `LoadBalancer` sin dirección, así que el Gateway queda `Programmed=False` (`AddressNotAssigned`), lo esperado en kind, y se llega a él con `port-forward`. Las 100 peticiones a `/cotizacion` llegaron a `api` (respondieron sus 2 pods), las 100 a `/precios/p3` a `precios`, y las rutas no declaradas devolvieron `404` del propio Gateway.

Con el mismo clúster se probaron las plantillas del [laboratorio](../../laboratorio-s11/): `plantillas/gateway.yaml` tal cual (Gateway `lab`, espacio de nombres `default`) y `plantillas/httproute.yaml` con sus `TODO` completados hacia el servicio de `laboratorio-s11/ejemplo/`: `Accepted=True`, `ResolvedRefs=True`, y los tres comandos de la guía (listar el Service con `owning-gateway-name=lab,owning-gateway-namespace=default`, `port-forward svc/<nombre> 18561:80`, `curl`) devolvieron `200`.

## Qué no se midió

- **Latencia y consumo.** No se midieron tiempos de respuesta ni CPU/memoria: los `requests/limits` están declarados sin afinar.
- **El origen exacto de los `TimeoutError` de KB `antes`** (~700 por corrida, durante la caída). Lo medido es que el cliente no recibió respuesta en 2 s mientras los pods se reiniciaban; no se aisló si las conexiones quedan colgadas en el contenedor que se está matando o en las reglas del Service. [por verificar]
- **Más de un nodo.** kind con un solo nodo: repartir réplicas entre nodos (`no-anti-affinity`) no aplica aquí.
- **`subPath`.** Un Secret montado con `subPath` tampoco se actualiza (documentado por Kubernetes); no se probó.
- **Otro controlador de Gateway.** Solo Envoy Gateway; NGINX Gateway Fabric no se probó.
- **kubeconform.** Solo se nombra; `--dry-run=server` valida contra el clúster real.
