# Q7. E4: llamada síncrona a un LLM local frente a 202 Accepted + cola + worker

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores (Docker Desktop, WSL2): PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2); RabbitMQ 4.4.0 (Erlang 29.1.2). LLM: Docker Model Runner (motor llama.cpp) con `ai/smollm2` (361.82 M parámetros, IQ2_XXS/Q4_K_M, id 354bf30d0aa3), `max_tokens` 48, `temperature` 0, declarado con `models:` en Compose (la API y el worker reciben `LLM_URL` y `LLM_MODEL`). k6 2.3.0 en un contenedor de la misma red, `constant-arrival-rate` durante 30s; cada petición lleva un número de pedido distinto en el texto. API y worker en contenedores Node 24.19 (en esta medición las dos rutas las servía un mismo contenedor; hoy la síncrona es `src/antes/llm-api.ts` y la asíncrona `src/despues/llm-api.ts` + `src/despues/llm-worker.ts`, con la misma lógica); plazo del LLM: 10 s en la ruta síncrona (`AbortSignal.timeout`, responde 504), 30 s en el worker. Worker con prefetch 2. Antes de cada prueba se espera a que el LLM no tenga cola (responde en < 2 s). 3 corridas.

## Síncrono: `POST /sync/summaries` espera al LLM

| Corrida | pet/s | Peticiones | 200 | 504 (plazo de 10 s) | Iteraciones descartadas por k6 | Latencia mediana (ms) | p95 (ms) | VUs máx. | Segundos hasta que el LLM vuelve a responder rápido |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 5 | 150 | 150 | **0** | 0 | 105 | 123 | 50 | 0 |
| 1 | 10 | 293 | 293 | **0** | 7 | 3196 | 7012 | 57 | 0 |
| 1 | 20 | 475 | 84 | **391** | 125 | 10001 | 10003 | 175 | 47 |
| 2 | 5 | 151 | 151 | **0** | 0 | 108 | 122 | 50 | 0 |
| 2 | 10 | 275 | 187 | **88** | 26 | 2978 | 10002 | 76 | 25 |
| 2 | 20 | 476 | 93 | **383** | 125 | 10001 | 10002 | 175 | 37 |
| 3 | 5 | 151 | 151 | **0** | 0 | 113 | 131 | 50 | 0 |
| 3 | 10 | 289 | 289 | **0** | 12 | 5378 | 6868 | 62 | 0 |
| 3 | 20 | 476 | 81 | **395** | 125 | 10001 | 10002 | 175 | 73 |

## Asíncrono: `POST /async/summaries` responde 202 y un worker procesa la cola

| Corrida | pet/s | Peticiones | 202 | Latencia de la API mediana (ms) | p95 (ms) | Trabajos hechos | Fallidos | Pendientes al final | Petición→hecho mediana (ms) | p95 (ms) | máx. (ms) | Del primer encargo al último hecho (s) | `traceparent` conservado |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 5 | 150 | 150 | 3 | 5 | 150 | 0 | 0 | 126 | 152 | 237 | 29.9 | 150 / 150 |
| 1 | 10 | 301 | 301 | 3 | 4 | 301 | 0 | 0 | 12283 | 23631 | 24719 | 54.6 | 301 / 301 |
| 1 | 20 | 600 | 600 | 3 | 5 | 600 | 0 | 0 | 35396 | 64276 | 66995 | 96.9 | 600 / 600 |
| 2 | 5 | 151 | 151 | 3 | 5 | 151 | 0 | 0 | 128 | 155 | 210 | 30.1 | 151 / 151 |
| 2 | 10 | 301 | 301 | 3 | 5 | 301 | 0 | 0 | 12730 | 21650 | 22383 | 52.4 | 301 / 301 |
| 2 | 20 | 601 | 601 | 3 | 4 | 601 | 0 | 0 | 32169 | 59974 | 62956 | 93 | 601 / 601 |
| 3 | 5 | 151 | 151 | 3 | 10 | 151 | 0 | 0 | 145 | 176 | 209 | 30.1 | 151 / 151 |
| 3 | 10 | 301 | 301 | 3 | 9 | 301 | 0 | 0 | 11233 | 20090 | 20912 | 50.9 | 301 / 301 |
| 3 | 20 | 601 | 601 | 3 | 5 | 601 | 0 | 0 | 37366 | 63880 | 66940 | 96.9 | 601 / 601 |

## Worker caído en mitad de la carga (10 pet/s asíncronas, 30s; se detiene en el segundo 10 y vuelve en el 20)

- `kill`: `docker compose kill llm-worker` (SIGKILL, como un corte).
- `stop`: `docker compose stop llm-worker` (SIGTERM; el worker deja de recibir, termina lo que tiene en vuelo, cierra; gracia de 20 s).

| Corrida | Cómo | Peticiones | 202 | Tiempo de parada (ms) | ¿Apagado limpio en el log? | Mensajes en cola con el worker caído | Trabajos hechos | Pendientes al final | Reintentados (`attempts` > 1) | En la DLQ | Petición→hecho máx. (ms) |
|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | kill | 301 | 301 | 492 | no | 77 | 301 | 0 | **2** | 0 | 27931 |
| 1 | stop | 301 | 301 | 552 | sí | 82 | 301 | 0 | **0** | 0 | 29976 |
| 2 | kill | 300 | 300 | 438 | no | 54 | 300 | 0 | **2** | 0 | 32235 |
| 2 | stop | 300 | 300 | 498 | sí | 90 | 300 | 0 | **0** | 0 | 29197 |
| 3 | kill | 301 | 301 | 622 | no | 75 | 301 | 0 | **2** | 0 | 23610 |
| 3 | stop | 300 | 300 | 744 | sí | 72 | 300 | 0 | **0** | 0 | 24318 |

Lectura: ver la sección Q7 de [ESCENARIOS.md](ESCENARIOS.md).
