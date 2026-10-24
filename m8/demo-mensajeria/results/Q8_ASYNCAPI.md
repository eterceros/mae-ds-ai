# Q8. AsyncAPI 3.1 como contrato verificable

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores (Docker Desktop, WSL2): PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2); RabbitMQ 4.4.0 (Erlang 29.1.2). AsyncAPI CLI 6.2.1 (`npx asyncapi`, fijada en `package.json`), Ajv 8.20.0 + ajv-formats 3.0.1.

| Comprobación | Resultado | Código de salida | Tiempo (ms) |
|---|---|---:|---:|
| `asyncapi validate asyncapi.yaml` | File asyncapi.yaml is valid! File asyncapi.yaml and referenced documents don't have governance issues. | 0 | 2533 |
| `asyncapi validate contract/asyncapi-invalido.yaml` (operación que apunta a un canal inexistente) | 72:13 error invalid-ref '#/channels/summaryCancelled' does not exist operations.publishSummaryRequested.channel.$ref<br>74:9 error asyncapi3-operation-messages-from-referred-channel Operation message does not belong to the specified channel. operations.publishSummaryRequested.messages[0] | 1 | 2461 |
| `asyncapi diff` original → `amountCents` renombrado a `amount` (`-t all`) | 0 breaking, 0 non-breaking, 23 unclassified | 0 | 2746 |
| `asyncapi diff` original → campo opcional `currency` añadido (`-t all`) | 0 breaking, 0 non-breaking, 13 unclassified | 0 | 2423 |

**Mensajes reales.** 200 pedidos por la API con outbox → relay → RabbitMQ; se leen los 200 mensajes de la cola de auditoría y se validan contra `components.schemas` del mismo `asyncapi.yaml`:

| Mensajes | Válidos (payload + cabecera `traceparent`) |
|---|---:|
| Tal como los publicó el relay | **200 / 200** |
| Los mismos con `amountCents` renombrado a `amount` (simula cambiar el productor sin cambiar el contrato) | **0 / 200** |

Error que da Ajv en el segundo caso: `data must have required property 'amountCents'`.

Lectura: ver la sección Q8 de [ESCENARIOS.md](ESCENARIOS.md).
