# KC · Secret como variable o como archivo; base64 no es cifrado

Medido el 2026-10-26 11:11 UTC · 12th Gen Intel(R) Core(TM) i9-12900H (20 hilos), 64 GB · Windows_NT 10.0.26200 · Node v24.19.0 · kubectl v1.36.1 · Kubernetes v1.37.0 (kind, contexto kind-s11-demo)

Script: `node --no-warnings scripts/kc-secretos.ts`. Secret `api-secretos` (clave `API_KEY`, valores de demostración `demo-clave-vN`) creado con `kubectl create secret generic … --from-literal`, no desde un archivo del repositorio. La app nunca devuelve el valor: `/config` da sus primeros 8 caracteres de SHA-256.

- **variable** · [`antes/kc-secreto-en-variable.yaml`](../antes/kc-secreto-en-variable.yaml): `env.valueFrom.secretKeyRef` (1 pod)
- **archivo** · [`despues/api.yaml`](../despues/api.yaml): volumen `secret` en `/etc/secretos` y la app lee `/etc/secretos/API_KEY` en cada uso (2 pods)

## 1. base64 no es cifrado

`kubectl get secret api-secretos -o jsonpath='{.data.API_KEY}'` devuelve `ZGVtby1jbGF2ZS12MA==`; decodificado con `base64 -d` da el valor original: **sí, idéntico**. Un solo comando, sin clave: cualquiera con permiso de leer Secrets en el espacio de nombres (o con el YAML en el repo) tiene el valor.

## 2. Dónde aparece el valor (búsqueda literal)

| Dónde | variable | archivo |
|---|---|---|
| `kubectl exec … -- env` | **sí** | no |
| `/proc/1/environ` del contenedor (lo hereda cualquier proceso hijo) | **sí** | — |
| `kubectl get pod … -o yaml` | no | no |
| `kubectl exec … -- cat /etc/secretos/API_KEY` | — | **sí** |

Con `exec` se lee igual de las dos formas: el archivo no protege contra quien entra al contenedor. Lo que evita es que el valor viaje en el entorno (volcados de `env`, procesos hijos, mensajes de error que imprimen el entorno).

## 3. Cambiar el Secret (3 rotaciones, sondeo cada 1 s)

| Rotación | archivo: segundos hasta ver el valor nuevo (por pod) | variable: ¿lo ve a los 180 s? | variable tras `kubectl rollout restart` |
|---|---|---|---|
| 1 | 66,8 · 83,6 | **no** | sí (reinicio en 3,8 s) |
| 2 | 26 · 69,9 | **no** | sí (reinicio en 3,5 s) |
| 3 | 57,5 · 48,9 | **no** | sí (reinicio en 13,1 s) |

**Archivo: mediana 62,2 s (rango 26–83,6 s, 6 observaciones), sin reiniciar. Variable: nunca, hasta reiniciar el pod.** El retraso del archivo lo fija el kubelet (sincronización periódica), no la app; por eso la app lee el archivo en cada uso en vez de copiarlo al arrancar.

No se midió: un volumen montado con `subPath` tampoco se actualiza (documentado por Kubernetes).
