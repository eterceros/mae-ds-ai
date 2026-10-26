# I2, complemento: qué inválidas habría aceptado la base en «antes»

Medido el 2026-10-26. Las 1428 filas que [`src/despues/importer.ts`](../src/despues/importer.ts) rechazó en `clientes-50000.csv`, insertadas una por una en `customers_naive` con la conversión de [`src/antes/importer.ts`](../src/antes/importer.ts) (`split(',')`, sin validar). Es lo que pasa cuando «la base ya valida»: solo rechaza lo que sus tipos y restricciones `NOT NULL` detectan.

| Motivo de rechazo en despues | Filas | Aceptadas por Postgres (basura) | Error de Postgres en las demás |
|---|---:|---:|---|
| amount_cents negativo | 196 | **196** | — |
| amount_cents no es un entero | 225 | **0** | `invalid input syntax for type integer: "12;5"` |
| country desconocido | 202 | **202** | — |
| email con formato inválido | 215 | **215** | — |
| email vacío | 194 | **194** | — |
| se esperaban 6 columnas y hay 5 | 200 | **0** | `null value in column "signup_date" of relation "customers_naive" violates not-nu` |
| signup_date no es una fecha válida (AAAA-MM-DD) | 196 | **0** | `date/time field value out of range: "2023-13-01"` |
