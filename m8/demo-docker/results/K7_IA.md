# K7. Un Dockerfile generado por IA, revisado con hadolint y Trivy

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Docker Engine 29.9.2 (Docker Desktop sobre WSL2, VM con 20 CPU y 31 GB, almacén de imágenes containerd), Compose 5.6.0, buildx v0.38.1. hadolint 2.15.1 y Trivy 0.76.1 en contenedor (fijados por digest).

El mismo pedido ([`ia/prompt.txt`](../ia/prompt.txt)) a dos asistentes:

- **ai/smollm2** (361 M de parámetros, Docker Model Runner, local y sin costo), `temperature: 0`, `max_tokens: 700`. Respuesta cruda en [`ia/respuesta-smollm2.json`](../ia/respuesta-smollm2.json).
- **Gordon** (`docker ai`, Docker Desktop 4.96, CLI v1.31.0). Gordon pidió permiso para listar y leer los archivos del proyecto; se le negó (corrió sin terminal), así que respondió solo con el texto del pedido. Respuesta cruda en [`ia/respuesta-gordon.txt`](../ia/respuesta-gordon.txt). Gordon usa un modelo en la nube que Docker no detalla en la CLI `[por verificar]`, y su respuesta cambia de una vez a otra.

Los Dockerfiles se copiaron tal cual ([`antes/Dockerfile.ia-smollm2`](../antes/Dockerfile.ia-smollm2), [`antes/Dockerfile.ia-gordon`](../antes/Dockerfile.ia-gordon)). Para comparar se revisan también el ingenuo de K1, la referencia y la versión de Gordon corregida a mano después de leer los avisos ([`despues/Dockerfile.ia-gordon-revisado`](../despues/Dockerfile.ia-gordon-revisado)).

| Dockerfile | Avisos de hadolint | Avisos de `trivy config` | ¿Construye? | Tamaño en disco | Usuario | ¿Arranca? | ¿El proceso puede reescribir su código? | Trivy (CVE en la imagen) | Docker Scout |
|---|---:|---:|---|---:|---|---|---|---|---|
| IA local: ai/smollm2 (sin revisar) | 21 | 2 | no | — | — | — | — | — | — |
| Gordon (sin revisar) | 1 | 1 | sí | 274MB | node | sí | **sí** | 16 (0C 6H 9M 1L) | 0C 6H 9M 1L |
| Gordon, revisado a mano | 1 | 1 | sí | 270MB | node | sí | no | 16 (0C 6H 9M 1L) | 0C 6H 9M 1L |
| Ingenuo de K1 | 1 | 2 | sí | 1.74GB | root | sí | **sí** | 4641 (21C 618H 2076M 1760L) | 3C 57H 85M 245L |
| Referencia (despues/Dockerfile) | 1 | 1 | sí | 357MB | node | sí | no | 245 (1C 62H 96M 84L) | 0C 14H 13M 39L |

## Lo que dijo cada herramienta

### IA local: ai/smollm2 (sin revisar)

hadolint (código de salida 1):

```
línea 6 DL3016 warning: Pin versions in npm. Instead of `npm install <package>` use `npm install <package>@<version>`
línea 9 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 12 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 15 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 18 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 21 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 24 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 27 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 30 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 33 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 36 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 39 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 42 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 45 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 48 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 51 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 54 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 57 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 60 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 63 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
línea 66 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
```

`trivy config`: 

- DS-0002 (HIGH): Image user should not be 'root'
- DS-0026 (LOW): No HEALTHCHECK defined

Build: **falla** — `ERROR: failed to build: failed to solve: nest:v2.10.0: failed to resolve source metadata for docker.io/library/nest:v2.10.0: pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed`

### Gordon (sin revisar)

hadolint (código de salida 1):

```
línea 24 DL3066 info: Non-numeric user-id may not be resolvable by host system
```

`trivy config`: 

- DS-0026 (LOW): No HEALTHCHECK defined

### Gordon, revisado a mano

hadolint (código de salida 1):

```
línea 36 DL3066 info: Non-numeric user-id may not be resolvable by host system
```

`trivy config`: 

- DS-0026 (LOW): No HEALTHCHECK defined

### Ingenuo de K1

hadolint (código de salida 1):

```
línea 17 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
```

`trivy config`: 

- DS-0002 (HIGH): Image user should not be 'root'
- DS-0026 (LOW): No HEALTHCHECK defined

### Referencia (despues/Dockerfile)

hadolint (código de salida 1):

```
línea 45 DL3066 info: Non-numeric user-id may not be resolvable by host system
```

`trivy config`: 

- DS-0026 (LOW): No HEALTHCHECK defined


## Qué muestra

- **El modelo local chico no sirve para esto.** smollm2 inventó una imagen base que no existe (`nest:v2.10.0`) y repitió la misma línea hasta agotar los tokens; el build falla en la primera instrucción. Un modelo de 361 M sirve para probar la mecánica de E4 sin gastar tokens, no para generar infraestructura.
- **Gordon produjo algo razonable a primera vista**: multi-stage, Alpine, `npm ci`, `--omit=dev`, `USER node`, forma exec en `CMD`. Los problemas son los que no se ven sin revisar: base con etiqueta flotante (`node:24-alpine`) y sin digest, `--chown=node:node` en `dist/` (el proceso **puede reescribir su propio código**, lo contrario de K3) y la etapa final vuelve a ejecutar `npm ci` en lugar de copiar dependencias de una etapa ya construida. Como usa la misma base que la variante Alpine de K2, tiene las mismas 16 CVE: revisar no cambia eso, cambia el permiso de escritura y la reproducibilidad.
- **hadolint encontró poco de lo que importa.** En los cinco archivos solo dio avisos de forma: `DL3059` (varias `RUN` seguidas), `DL3016` (`npm install -g` sin versión) y `DL3066` (usuario no numérico: con un nombre, Kubernetes no puede comprobar `runAsNonRoot`). **No avisó** que el ingenuo corre como root (su regla `DL3002` solo salta si hay un `USER root` explícito), ni que `node:24` es una etiqueta flotante (`DL3006` solo salta si no hay etiqueta), ni que la base de smollm2 no existe, ni el `--chown`.
- **`trivy config` vio el root** (`DS-0002`, en el ingenuo y en el de smollm2) y la falta de `HEALTHCHECK` (`DS-0026`, en todos: aquí el healthcheck está en `compose.yaml`, así que ese aviso es esperable). **Trivy/Scout sobre la imagen** miran lo que quedó dentro (CVE de paquetes), no cómo se construyó.
- **Ninguna herramienta detectó el `--chown` sobre el código**: lo encuentra una persona que revisa o una prueba como la de K3. Lo generado por la IA se lee, se pasa por el linter y el escáner y se prueba, igual que un PR de un colega.
