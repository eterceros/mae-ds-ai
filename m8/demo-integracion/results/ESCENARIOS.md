# Resultados de la demo de integración (I1-I3)

Medido el 26 de octubre de 2026 en un portátil: Intel Core i9-12900H (20 hilos lógicos), 64 GB de RAM, Windows 11 (10.0.26200), Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0; la VM ve 20 CPU y 31 GB). Postgres 17.11, Node 24.19.0 (imagen `node:24.19.0-slim`), pg 8.23.1. **Los procesos de Node (receptor, worker, importadores, simuladores) corrieron en un contenedor de la misma red de Compose que Postgres** (`docker compose --profile tools run --rm tools …`); el porqué está al final, en «Dónde corre Node».

Cada escenario se corrió 3 veces; las tablas dan cada corrida, la mediana y el rango. Los conteos son exactos (filas en la base, peticiones registradas por el simulador), no estimaciones. El código de cada caso está en `src/antes/` (mala práctica) o `src/despues/` (corregido); [`DIFERENCIAS.md`](../DIFERENCIAS.md) los cruza línea por línea.

## Resumen

| Escenario | Qué se hizo | antes | despues |
|---|---|---|---|
| **I1** webhook ([detalle](I1_WEBHOOK.md)) | 200 eventos de pago con plazo de 2 s y reenvíos; 20 entregas duplicadas por el proveedor; 20 falsas; 10 repeticiones de hace 10 min | respuesta p50/p95 **1138/1917 ms**; **127-131 reenvíos**; **157-161 abonos duplicados**; **20/20 falsas y 10/10 repeticiones aceptadas** | respuesta p50/p95 **5/9 ms**; **0 reenvíos**; **0 duplicados**; **0 falsas, 0 repeticiones** (401); 200/200 procesados en ~41 s |
| **I2** CSV de 50 000 filas ([detalle](I2_IMPORTACION.md)) | ~3 % inválidas de 7 tipos, ~1 % duplicadas; dos ejecuciones seguidas | archivo sucio: **aborta en la línea 38, 0 filas**; archivo sin inválidas: 7,0 s, RSS 168 MB, y la 2.ª ejecución **duplica** (97 144 filas para 48 090 clientes) | 1,3 s, RSS 138 MB, 48 090 cargadas y **1428 rechazadas con motivo**; 2.ª ejecución: **0 cambios** |
| I2 con 500 000 filas | ídem | 78,9 s, **RSS 454 MB, heap 302 MB** (archivo sin inválidas); el sucio aborta igual en la línea 38 tras ocupar 320 MB | 13,2 s, **RSS 229 MB, heap 90 MB**; 2.ª ejecución: 0 cambios |
| I2 con el heap limitado ([detalle](I2_LIMITE_MEMORIA.md)) | `--max-old-space-size=64` y `=32`, 500 000 filas | **muere** (*heap out of memory*), 6 de 6 | termina, 6 de 6 |
| I2 «la base ya valida» ([detalle](I2_BASURA.md)) | las 1428 inválidas, una por una, en la tabla de `antes` | **807 aceptadas como basura**, 621 rechazadas por Postgres | — (las 1428 se apartan antes) |
| **I3** envío a un tercero de 50/s ([detalle](I3_ENVIO.md)) | 1000 pedidos, 2 % de `503`; y una segunda pasada | 1,5 s, 3781 peticiones, 3678 con 429, **895-904 perdidos**, y la 2.ª pasada no recupera ninguno | 22,1 s (mínimo teórico 19 s), 1045 peticiones, 22 con 429, **0 perdidos**; con ritmo propio de 45/s: **0 con 429**, 22,8 s |

## I1. Webhook entrante ([detalle](I1_WEBHOOK.md))

**Mecanismo.** El proveedor espera 2 s; el trabajo de cada evento tarda entre 0,2 y 3 s. En `antes` ese trabajo va dentro de la petición, así que ~36 % de los intentos pasan del plazo: el proveedor corta y reenvía, pero el servidor **no se entera** de que el cliente se fue y termina el trabajo igual. Cada timeout deja un abono y su reenvío otro. Las cuentas cierran exactas: en la corrida 1, 131 reenvíos + 20 duplicados del proveedor + 10 repeticiones = 161 abonos duplicados. Incluso hubo 1-3 eventos por corrida que el proveedor dio por **no entregados** después de 5 intentos y que sin embargo sí se abonaron (los 200 eventos tienen abono): el proveedor cree que falló algo que en realidad se hizo, varias veces.

En `despues` el receptor solo verifica la firma, mira la hora y hace un `INSERT … ON CONFLICT DO NOTHING` en la bandeja: responde en ~5 ms y el proveedor nunca reenvía. Las 20 entregas duplicadas a propósito chocan con la clave primaria (`webhook-id`) y reciben 200 sin crear nada. Las falsas fallan la firma (401) y las repeticiones fallan la ventana de 5 minutos (401) aunque su firma es válida. El costo es que el trabajo termina más tarde: el worker con 8 en paralelo vacía la bandeja en ~41 s, mientras que `antes` terminaba en ~39 s (porque procesaba los 200 a la vez, más todos los duplicados).

## I2. Carga por lotes ([detalle](I2_IMPORTACION.md))

**Mecanismo.** `antes` hace lo que suele hacer un primer script: `readFileSync`, `split`, un objeto por fila, y un `INSERT` por fila dentro de una transacción. Con el archivo real, la línea 38 (una fila con una columna de menos) viola un `NOT NULL` y el `ROLLBACK` deshace todo: 0 filas, y el mensaje de error no dice cuántas más hay ni de qué tipo. Para medir lo demás se usó un archivo con las mismas filas sin las inválidas: carga todo, pero como no tiene clave natural, re-ejecutarlo duplica cada cliente. Y si la carga no hubiera abortado, la base habría dejado entrar 807 de las 1428 inválidas (correos vacíos o mal formados, montos negativos, países inventados): sus tipos y `NOT NULL` no saben nada de eso.

`despues` lee el archivo por partes, valida cada fila y aparta las malas en `out/rechazados.csv` con número de línea y motivo; los conteos por motivo coinciden exactamente con el manifiesto del generador. Las válidas van en lotes de 1000 a una tabla intermedia y desde ahí a `customers` con `INSERT … ON CONFLICT (external_id) DO UPDATE … WHERE … IS DISTINCT FROM`: la segunda ejecución recorre las mismas 500 000 filas y no escribe ninguna. Es más rápido (13,2 s frente a 78,9 s con 500 000) porque hace unas 250 veces menos idas y vueltas a la base (4 consultas por lote de 1000 filas en vez de 1000).

**Memoria.** En `antes` la memoria crece con el archivo (heap 66 → 302 MB al pasar de 50 000 a 500 000 filas). En `despues` el pico también sube (heap 39 → 90 MB), pero no es memoria viva: V8 deja crecer el heap mientras le sobra espacio y recolecta más tarde. La prueba es el límite: con `--max-old-space-size=32`, `despues` carga las 500 000 filas y `antes` muere a los 0,3 s, al leer el archivo.

## I3. Envío a un tercero ([detalle](I3_ENVIO.md))

**Mecanismo.** El tercero tiene una cubeta de 50 fichas que se repone a 50/s. `antes` lanza los 1000 pedidos a la vez: entran ~50 de la ráfaga y unos pocos más de la reposición, y los demás reciben 429. Los 3 reintentos inmediatos llegan en milisegundos, cuando la cubeta sigue vacía, así que vuelven a recibir 429: en 1,5 s se rinde con ~900 pedidos. Como la marca de agua avanza al último pedido aunque haya fallos, la segunda pasada no encuentra nada que enviar: la pérdida es **permanente y silenciosa** (solo quedan líneas de log).

`despues` lee la outbox (`outbound`), manda 8 a la vez y, al primer 429, **todos** esperan lo que dice `Retry-After` (1 s) más un poco de jitter. Los `503` se reintentan con backoff exponencial y jitter. Tarda 22,1 s frente a los 19 s teóricos y no pierde nada. Con un ritmo propio de 45/s (`CLIENT_RPS`), por debajo del límite, no recibe ningún 429 y tarda casi lo mismo (22,8 s): no llegar al límite es tan rápido como rebotar contra él, y más amable con el tercero. «Pico aceptados/s» llega a 67-78 en el primer segundo porque la cubeta empieza llena (50) y se repone durante ese segundo.

**Hallazgo lateral (medido y luego quitado del escenario).** En la primera versión del script los pedidos tenían `updated_at = clock_timestamp()` y caían varios en el mismo milisegundo. La marca de agua de `antes` pasa por un `Date` de JavaScript, que solo guarda milisegundos, así que `updated_at > marca` volvía a tomar entre 110 y 578 pedidos en la segunda pasada ([`raw/I3_ENVIO-marca-ms.md`](raw/I3_ENVIO-marca-ms.md)). Es otro error clásico de las marcas de agua: comparar con menos precisión de la que tiene la columna. El script actual separa los pedidos por 1 s para que I3 mida solo el límite.

## Dónde corre Node (y por qué cambia las cifras)

El importador ingenuo hace una ida y vuelta a la base por fila, así que su tiempo depende de la latencia. Medido con 500 consultas `SELECT 1` ([`raw/latencia.log`](raw/latencia.log)): **desde el anfitrión Windows por el puerto publicado, 7,98 ms** por consulta (con la máquina ocupada por otros procesos); **desde un contenedor en la red de Compose, 0,118 ms**. Con la primera, el `antes` de 500 000 filas llevaba más de 30 minutos y ~300 000 filas cuando se cortó ([`raw/anfitrion/`](raw/anfitrion/)); por eso todas las cifras de referencia se tomaron dentro de la red de Compose. Lección para su propio laboratorio: midan y anoten dónde corre cada pieza; la misma carga fila por fila puede tardar 70 veces más solo por el camino de red.

I1 también se corrió en el anfitrión, una hora antes (sin medir la latencia en ese momento) ([`raw/anfitrion/I1_WEBHOOK.md`](raw/anfitrion/I1_WEBHOOK.md)): mismos resultados de fondo (0 duplicados, 0 falsas en `despues`; 20/20 falsas y 10/10 repeticiones aceptadas en `antes`), respuesta de `despues` p50 ~20 ms en vez de ~5 ms, y 88-95 reenvíos en `antes` en vez de 127-131.

## Qué no se midió

- **La caída del worker de I1 a mitad del trabajo.** El código la cubre (plazo `locked_until` y efecto condicionado al paso a `done`), pero no se mató el worker en estas corridas. La S08 (Q3-Q4) midió el mismo patrón con caídas reales.
- **Que el trabajo externo de I1 sea idempotente.** El abono en nuestra base lo es; la llamada al ERP o al correo (simulada con una espera) se repetiría si el worker muere después de hacerla y antes del `COMMIT`. Por eso se le pasa el `event_id` para que el otro lado deduplique; no se probó.
- **Timeouts del tercero que sí registran el pedido** (I3). En el simulador, un 429 o un 503 nunca registra nada, así que `Idempotency-Key` no tuvo ocasión de evitar un duplicado (0 en todas las variantes). Con timeouts reales sí la tendría.
- **CSV con comillas, comas dentro de los campos o codificaciones distintas de UTF-8.** El generador no los produce; con datos reales hay que usar un parser de CSV de verdad.
- **`COPY`** (la carga masiva nativa de Postgres) en lugar de `INSERT` por lotes: sería aún más rápida; no se comparó.
- **Varias instancias del importador a la vez** con el mismo archivo.
- **La diferencia de reenvíos de I1 entre el anfitrión (88-95) y el contenedor (127-131).** El valor esperado con un 36 % de intentos por encima del plazo es ~109. `[por verificar]`: si se debe a cómo dispara `AbortSignal.timeout` en cada sistema o al establecimiento de conexiones; no cambia ninguna conclusión.
- **Rendimiento máximo** de cualquiera de las piezas: no es el objetivo (es tema del M12).
