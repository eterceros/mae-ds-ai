# K3. Usuario root frente a no root

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Docker Engine 29.9.2 (Docker Desktop sobre WSL2, VM con 20 CPU y 31 GB, almacén de imágenes containerd), Compose 5.6.0, buildx v0.38.1.

Dos imágenes de la misma API: la ingenua de K1 (no declara `USER`, así que el proceso corre como root) y la de referencia (`USER node`, uid 1000; los archivos de `/app` quedan de root). Cada una se arrancó contra el Postgres del stack (responde `/salud`: root sí, noroot sí) y se probó con `docker exec` lo que puede hacer **un proceso con los permisos de la API**: lo mismo que podría hacer quien aprovechara una vulnerabilidad de la API para ejecutar comandos.

| | Ingenua (sin USER: root) | Referencia (USER node) |
|---|---|---|
| `docker exec <c> id` | `uid=0(root) gid=0(root) groups=0(root)` | `uid=1000(node) gid=1000(node) groups=1000(node)` |
| Capacidades efectivas del PID 1 (`CapEff`) | `00000000a80425fb` (14 capacidades) | `0000000000000000` (0 capacidades) |
| Modificar el código de la app (`/app/dist/main.js`) | sí | no (permiso denegado) |
| Agregar un usuario a `/etc/passwd` | sí | no (permiso denegado) |
| Dejar un binario setuid en `/usr/local/bin` | sí | no (permiso denegado) |
| `docker exec -u root <c> id -un` | root | root |

Procesos dentro de cada contenedor (usuario, PID, comando):

**Ingenua (sin USER: root)**

```
root 1 npm run start                     
root 18 sh -c node dist/main.js 
root 19 node dist/main.js 
```

**Referencia (USER node)**

```
node 1 node dist/main.js 
```

## Por qué

- **Root dentro del contenedor es el uid 0 del kernel**, con un conjunto reducido de capacidades (Docker quita varias por defecto, pero deja 14). Si alguien logra ejecutar comandos a través de la API, como root puede reescribir el código, tocar la configuración del sistema del contenedor y dejar herramientas; y si el contenedor tiene montado un directorio del host o el socket de Docker, lo que escriba allí lo escribe como root. Con `USER node` el mismo ataque queda limitado a lo que el uid 1000 pueda tocar: ninguna de las tres escrituras de la tabla.
- **Los archivos de la app son de root y el proceso no**, por eso ni siquiera puede modificar su propio código: es un efecto de copiar sin `--chown` en el Dockerfile de referencia.
- **La ingenua además tiene `npm` como PID 1** (`CMD ["npm", "run", "start"]`): npm lanza un `sh` que lanza `node`. Ese detalle (señales y apagado) se vio en la S02.
- **No root no protege del operador**: quien controla el demonio de Docker entra como root con `docker exec -u root`. Protege del proceso comprometido, que es lo que importa.
