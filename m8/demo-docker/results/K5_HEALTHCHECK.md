# K5. Arranque con y sin healthcheck

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Docker Engine 29.9.2 (Docker Desktop sobre WSL2, VM con 20 CPU y 31 GB, almacén de imágenes containerd), Compose 5.6.0, buildx v0.38.1.

Tres archivos de Compose con el mismo Postgres 17.11 y la misma API (que hace `SELECT 1` al arrancar y termina con código 1 si la base no responde, como hacen TypeORM o Prisma). Ninguno tiene `restart:`, para ver el primer intento. 5 corridas por variante y por estado del volumen: **vacío** (`down -v` antes: Postgres crea la base desde cero) y **ya inicializado** (`down` sin `-v`: los datos quedan). Se mide desde `docker compose up -d` hasta que `GET /salud` responde (la API ya hizo su `SELECT 1` y escucha; los dos archivos de `antes/` no corren migraciones, así que `/items` no aplica).

- [`antes/compose.yaml`](../antes/compose.yaml): `depends_on: [postgres]`.
- [`antes/compose.healthcheck-socket.yaml`](../antes/compose.healthcheck-socket.yaml): healthcheck `pg_isready -U postgres` (sin `-h`: pregunta por el socket Unix) y `condition: service_healthy`.
- [`despues/compose.yaml`](../despues/compose.yaml): healthcheck `pg_isready -h 127.0.0.1 ...` (por TCP) y `condition: service_healthy`.

| Variante | Volumen de Postgres | La API arrancó bien | La API arrancó N s después de Postgres (mediana, rango) | Hasta `/salud` OK (s) | Error de la API cuando falló |
|---|---|---|---:|---:|---|
| depends_on sin condición, sin healthcheck | vacío (primera vez) | 0 de 5 | 0.20 (0.2–0.2) | — | `No se pudo arrancar la API: connect ECONNREFUSED 172.23.0.2:5432` |
| depends_on sin condición, sin healthcheck | ya inicializado | 5 de 5 | 0.20 (0.2–0.3) | 1.4 (1.1–1.5) | — |
| service_healthy con pg_isready por socket Unix | vacío (primera vez) | 5 de 5 | 1.71 (1.7–2.7) | 2.9 (2.7–3.7) | — |
| service_healthy con pg_isready por socket Unix | ya inicializado | 5 de 5 | 1.70 (1.7–1.7) | 2.7 (2.6–3.0) | — |
| service_healthy con pg_isready -h 127.0.0.1 (compose.yaml) | vacío (primera vez) | 5 de 5 | 2.40 (2.4–3.5) | 4.1 (3.5–5.0) | — |
| service_healthy con pg_isready -h 127.0.0.1 (compose.yaml) | ya inicializado | 5 de 5 | 2.41 (2.4–2.5) | 3.9 (3.5–4.2) | — |

## Por qué

- **`depends_on` sin condición solo ordena el arranque de los contenedores**: Compose crea y arranca Postgres y enseguida la API, sin esperar a que Postgres acepte conexiones. Con el volumen vacío Postgres tarda varios segundos (`initdb`, crear la base `tienda`, reiniciar) y la API, que está lista en menos de un segundo, se conecta antes y muere. Con la base ya inicializada Postgres está listo mucho antes, pero sigue siendo una carrera que gana o pierde según la máquina: «en mi máquina funciona».
- **`condition: service_healthy`** hace que Compose espere a que el healthcheck de Postgres pase antes de crear la API. La API arranca más tarde, pero arranca bien.
- **La trampa del socket.** Para inicializar un volumen vacío, la imagen oficial de Postgres levanta primero un servidor temporal que solo escucha por socket Unix (`listen_addresses=''`), crea la base, lo apaga y arranca el definitivo. `pg_isready` sin `-h` pregunta por ese socket: si el chequeo cae en esa ventana, Postgres figura «healthy» mientras todavía no escucha por TCP, que es por donde llega la API. Con `-h 127.0.0.1` el chequeo usa el mismo camino que la API. **En estas corridas no se dio** (5 de 5 bien): la ventana del servidor temporal es corta (fracciones de segundo en esta máquina) y el primer chequeo, que llega a ~1 s, ya cayó después. Es una carrera que depende de la máquina y de los scripts de inicialización (cuantos más haya en `/docker-entrypoint-initdb.d`, más larga la ventana); por eso el chequeo por TCP es lo correcto aunque aquí no se haya visto fallar. Costo medido: con TCP la API arrancó unos 0,7 s más tarde (2,4 s frente a 1,7 s).
- **Aun así, la API debe tolerar que la base no esté**: un healthcheck ordena el arranque, pero la base puede reiniciarse después. Reintentar la conexión con espera (o `restart: on-failure`) es la segunda defensa; los reintentos en código se ven en el bloque 2 (E3).
