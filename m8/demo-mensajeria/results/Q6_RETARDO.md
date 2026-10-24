# Q6. Reintento con retardo: nativo de RabbitMQ 4.4 frente a DLX + TTL

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores (Docker Desktop, WSL2): PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2); RabbitMQ 4.4.0 (Erlang 29.1.2).

20 mensajes; cada uno falla 3 veces y el intento 4 funciona. Retardo planificado antes del intento n+1: 1000 ms × n (1 s, 2 s, 3 s). Se mide el tiempo real entre intentos del mismo mensaje. 3 corridas por variante (las cifras juntan los 20 mensajes de cada corrida: mediana [mín-máx] en ms).

| Variante | Corrida | Terminados | Intento 1→2 (plan 1000) | 2→3 (plan 2000) | 3→4 (plan 3000) |
|---|---:|---:|---:|---:|---:|
| A) nativo: `x-delayed-retry-*` + `reject(requeue)` | 1 | 20/20 | 1009 [1007-1009] | 2016 [2016-2019] | 3016 [3015-3017] |
| A) nativo: `x-delayed-retry-*` + `reject(requeue)` | 2 | 20/20 | 1005.5 [1005-1006] | 2005 [2004-2007] | 3005 [3004-3006] |
| A) nativo: `x-delayed-retry-*` + `reject(requeue)` | 3 | 20/20 | 1026 [1004-1027] | 2003 [2003-2012] | 3005 [3004-3005] |
| B) `x-opt-delivery-time` al republicar | 1 | 20/20 | 1001 [1000-1001] | 2001 [2001-2002] | 3005 [3002-3005] |
| B) `x-opt-delivery-time` al republicar | 2 | 20/20 | 1007 [1006-1007] | 2003 [2000-2003] | 3001 [3000-3001] |
| B) `x-opt-delivery-time` al republicar | 3 | 20/20 | 999 [999-1000] | 2000 [2000-2000] | 2999 [2999-3000] |
| C) DLX + TTL (3 colas de espera) | 1 | 20/20 | 1013 [1012-1013] | 2010 [2009-2014] | 3013 [3013-3015] |
| C) DLX + TTL (3 colas de espera) | 2 | 20/20 | 1012 [1010-1012] | 2009 [2009-2012] | 3017 [3017-3018] |
| C) DLX + TTL (3 colas de espera) | 3 | 20/20 | 1013 [1011-1013] | 2011 [2010-2012] | 3012 [3011-3016] |

**Cabeza de cola.** Se encola A con retardo de 5 s y, detrás, B con 1 s. Momento (ms desde el envío) en que cada uno llega al consumidor:

| Mecanismo | A (plan 5000) | B (plan 1000) |
|---|---:|---:|
| TTL por mensaje (`expiration`) en una cola classic de espera | 5013 | 5013 |
| TTL por mensaje (`expiration`) en una cola classic de espera | 5013 | 5013 |
| TTL por mensaje (`expiration`) en una cola classic de espera | 5014 | 5014 |
| TTL por mensaje en una cola quorum de espera | 5050 | 5051 |
| TTL por mensaje en una cola quorum de espera | 5028 | 5028 |
| TTL por mensaje en una cola quorum de espera | 5030 | 5030 |
| `x-opt-delivery-time` en la cola quorum | 4999 | 999 |
| `x-opt-delivery-time` en la cola quorum | 4999 | 1005 |
| `x-opt-delivery-time` en la cola quorum | 4998 | 1002 |

Lectura: ver la sección Q6 de [ESCENARIOS.md](ESCENARIOS.md).
