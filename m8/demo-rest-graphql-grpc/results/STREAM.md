# Streaming frente a respuesta completa

## Sin red limitada (contenedor Docker, red por defecto)

Lista de 2000 estudiantes, llamadas de una en una. Mediana de 3 rondas de 25 llamadas (entre paréntesis, el rango entre rondas).

| Variante | Primer estudiante disponible (ms) | Todos los estudiantes (ms) |
|---|---:|---:|
| REST, arreglo JSON (hay que esperar todo) | 6.7 (6.6–8.0) | 6.7 (6.6–8.0) |
| REST, NDJSON en flujo | 5.2 (4.8–5.4) | 15.2 (12.4–16.2) |
| gRPC unario (hay que esperar todo) | 8.0 (6.8–8.5) | 8.0 (6.8–8.5) |
| gRPC, streaming de servidor | 4.4 (4.3–4.4) | 65.2 (64.8–65.6) |

## Con red limitada (20 ms de retardo, 20mbit)

Lista de 2000 estudiantes, llamadas de una en una. Mediana de 3 rondas de 25 llamadas (entre paréntesis, el rango entre rondas).

| Variante | Primer estudiante disponible (ms) | Todos los estudiantes (ms) |
|---|---:|---:|
| REST, arreglo JSON (hay que esperar todo) | 115.8 (115.5–115.9) | 115.8 (115.5–115.9) |
| REST, NDJSON en flujo | 37.4 (37.0–38.0) | 120.0 (119.8–120.4) |
| gRPC unario (hay que esperar todo) | 86.8 (86.5–87.4) | 86.8 (86.5–87.4) |
| gRPC, streaming de servidor | 24.4 (24.0–24.8) | 114.6 (113.7–116.2) |

