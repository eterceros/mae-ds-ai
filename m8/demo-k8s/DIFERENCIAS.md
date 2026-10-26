# Diferencias entre `antes/` y `despues/`

Problema → línea en `antes/` → cambio en `despues/` → cifra medida. El código de la app ([`app/`](app/)) es el mismo en los dos casos: solo cambian los manifiestos. Las cifras salen de [`results/`](results/).

## KA. Manifiesto generado por IA, sin revisar

Cada fila dice quién lo encontró: el **servidor** (`kubectl apply --dry-run=server`), **kube-linter**, **al ejecutar** (aplicado de verdad) o **nadie**.

| Problema | Línea en `antes/` | Cambio en `despues/` | Quién lo encontró y cifra |
|---|---|---|---|
| Valores de ConfigMap que no son texto (`3000`, `true`) | [`ka-1:12-13`](antes/ka-1-generado-por-ia.yaml) | [`api-config.yaml:9`](despues/api-config.yaml): todo entre comillas | servidor, en **dos rondas** (primero el booleano, después el número) |
| Secret con texto plano bajo `data:` | [`ka-1:22`](antes/ka-1-generado-por-ia.yaml) | el Secret no está en el repo: se crea con `kubectl create secret generic --from-literal` (README) | servidor (`illegal base64`); al pasarlo a base64 lo aceptan las dos herramientas, aunque sigue en el repo (nadie) |
| Etiquetas de la plantilla que no coinciden con el selector | [`ka-1:37`](antes/ka-1-generado-por-ia.yaml) | [`api.yaml:16`](despues/api.yaml) | servidor, **recién en la 3.ª ronda**: antes lo tapaban errores de decodificación del mismo objeto |
| Imagen `:latest` / sin etiqueta | [`ka-1:41`](antes/ka-1-generado-por-ia.yaml), [`ka-1:87`](antes/ka-1-generado-por-ia.yaml) | [`api.yaml:20`](despues/api.yaml), [`precios.yaml:17`](despues/precios.yaml): `:1.0` e `IfNotPresent` | kube-linter (`latest-tag` ×2) |
| Clave como valor literal en `env` | [`ka-1:46`](antes/ka-1-generado-por-ia.yaml) | [`api.yaml:27`](despues/api.yaml): archivo del Secret montado | **nadie**: `env-var-secret` solo mira nombres que contienen `secret` |
| Errata `livenesProbe` | [`ka-1:47`](antes/ka-1-generado-por-ia.yaml) | [`api.yaml:38`](despues/api.yaml) | servidor (validación estricta de campos), en la 2.ª ronda |
| `256mb` no es una cantidad | [`ka-1:53`](antes/ka-1-generado-por-ia.yaml) | [`api.yaml:48`](despues/api.yaml): `128Mi` | servidor |
| `protocol: HTTP` en un Service | [`ka-1:68`](antes/ka-1-generado-por-ia.yaml) | se omite (TCP por defecto) | servidor |
| Sin `requests`/`limits`, con root, disco escribible | `ka-1` (los dos Deployment) | [`api.yaml:48-55`](despues/api.yaml), [`precios.yaml`](despues/precios.yaml) | kube-linter (`unset-*`, `run-as-non-root`, `no-read-only-root-fs`: 7 hallazgos) |
| Service `precios` que no selecciona ningún pod (`prices`) | [`ka-1:102`](antes/ka-1-generado-por-ia.yaml) | [`precios.yaml:41`](despues/precios.yaml) | kube-linter (`dangling-service`) |
| Liveness a una ruta que no existe (`/salud`) | [`ka-2`](antes/ka-2-pasa-los-validadores.yaml) (liveness de `api`) | [`api.yaml:39`](despues/api.yaml): `/salud/vivo` | al ejecutar: **4 reinicios en 90 s** (2 pods), 3 de 3 corridas |
| Readiness a `/health` (la app expone `/salud`) | [`ka-1:92`](antes/ka-1-generado-por-ia.yaml) | [`precios.yaml:22`](despues/precios.yaml) | al ejecutar: `precios` **0 de 1 listo** |
| `targetPort: 8080` (el contenedor escucha en 3000) | [`ka-1:67`](antes/ka-1-generado-por-ia.yaml) | [`api.yaml:67`](despues/api.yaml): `targetPort: http` (por nombre) | al ejecutar: **0 de 200** peticiones correctas (200 `ECONNREFUSED`); con `despues/`, 200 de 200 |
| `type: LoadBalancer` en kind | [`ka-1:62`](antes/ka-1-generado-por-ia.yaml) | [`api.yaml:64`](despues/api.yaml): ClusterIP; se entra por el Gateway (KD) | al ejecutar: `EXTERNAL-IP <pending>` para siempre |
| ConfigMap que nadie lee; falta `MONEDA` | `ka-1` (sin `envFrom`) | [`api.yaml:24`](despues/api.yaml): `envFrom` | al ejecutar (la app usa sus valores por defecto) |

Totales: **7 errores del servidor en 3 rondas, 11 hallazgos de kube-linter, 5 defectos que solo se ven al ejecutar y 2 que no ve nadie**. `despues/`: 0 errores, 0 hallazgos (con una excepción declarada: `no-anti-affinity`, un solo nodo) y 200 de 200 peticiones correctas. Con `--include no-readiness-probe,no-liveness-probe`, kube-linter además avisa que `ka-2` no tiene readiness en `api` ni liveness en `precios` (2 hallazgos; 0 en `despues/`).

## KB. Liveness que consulta una dependencia

| Problema | Línea en `antes/` | Cambio en `despues/` | Cifra medida (mediana de 3, rango) |
|---|---|---|---|
| La liveness mira a `precios`: si `precios` cae, Kubernetes reinicia una api sana | [`kb-liveness-con-dependencia.yaml:39`](antes/kb-liveness-con-dependencia.yaml) | [`api.yaml:39`](despues/api.yaml): liveness a `/salud/vivo`, que no mira nada fuera del proceso; la dependencia queda solo en la readiness ([`api.yaml:44-47`](despues/api.yaml)) | con `precios` caído 90 s: **8 reinicios (8–9)** frente a **0** |
| Tras los reinicios, un pod queda esperando el *backoff* | ídem | ídem | segundos hasta tener los 2 pods otra vez en el Service: 2 (2–**56**) frente a 0 (0–2) |
| (igual en los dos) `/cotizacion` necesita a `precios` | — | — | peticiones fallidas durante la caída: 905 (900–941) frente a 906 (904–916) de 2400; después de que `precios` vuelve: 0 en las dos |
| Apagado que no suelta las conexiones *keep-alive* | — | [`app/api/server.mjs:64`](app/api/server.mjs): al recibir `SIGTERM` responde con `connection: close` | ver «Qué no se midió» en [`results/ESCENARIOS.md`](results/ESCENARIOS.md): sin este cambio, una corrida exploratoria de `antes` tuvo 174 fallos después de que `precios` volvió |

## KC. Secret como variable o como archivo

| Problema | Línea en `antes/` | Cambio en `despues/` | Cifra medida |
|---|---|---|---|
| El valor queda en el entorno del proceso | [`kc-secreto-en-variable.yaml:24-26`](antes/kc-secreto-en-variable.yaml) | [`api.yaml:27`](despues/api.yaml) y [`api.yaml:57`](despues/api.yaml): volumen `secret`; la app lee el archivo ([`server.mjs:19-22`](app/api/server.mjs)) | `env` y `/proc/1/environ`: el valor aparece con variable, no con archivo. Con `kubectl exec … cat` se lee igual de las dos formas |
| Un Secret que cambia no llega a la variable | ídem | ídem | archivo: el valor nuevo llega sin reiniciar, mediana **62,2 s** (26–83,6 s, 6 observaciones en 3 rotaciones); variable: **0 de 3** a los 180 s, solo tras `rollout restart` |
| «Está en un Secret, así que está cifrado» | — | el Secret se crea fuera del repo | `kubectl get secret … -o jsonpath` + `base64 -d` devuelve el valor original: un comando, sin clave |

## KD. HTTPRoute

| Problema | Línea en `antes/` | Cambio en `despues/` | Cifra medida |
|---|---|---|---|
| Entrar al clúster con `type: LoadBalancer` (kind no tiene balanceador) | [`ka-1:62`](antes/ka-1-generado-por-ia.yaml) | [`ruta.yaml`](despues/ruta.yaml): Gateway `demo` + HTTPRoute (`/cotizacion` → `api:80`, `/precios` → `precios:3001`) | HTTPRoute `Accepted=True`, `ResolvedRefs=True`; 100 de 100 `200` en `/cotizacion` (repartidas en los 2 pods), 100 de 100 en `/precios/p3`, 20 de 20 `404` en rutas no declaradas |
