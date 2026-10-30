# E3 · Informe: ¿conviene extraer este módulo?

> Plantilla. Reemplacen cada `…` por lo medido. Las hipótesis están en [`HIPOTESIS.md`](HIPOTESIS.md) y la decisión, en el ADR de `docs/adr/`.

## Qué se comparó

- **Módulo:** …
- **Forma 1, en proceso (monolito modular):** …
- **Forma 2, extraído (servicio aparte, detrás de Toxiproxy):** … (plazo por intento, reintentos, breaker: con qué valores)
- **Ruta que usa el módulo:** …   **Ruta de control (no lo usa):** …
- **Fallas provocadas:** colgado / caído / … (de qué segundo a qué segundo)
- **Carga:** … pet/s por ruta, modelo abierto; calentamiento de … s que no se cuenta.

## Entorno

- **Máquina:** CPU …, RAM …, sistema operativo …
- **Docker:** Docker Desktop …, motor …, Compose …, WSL2 … (versión exacta)
- **Imágenes y versiones:** Node …, NestJS …, Toxiproxy …, k6 …
- **Datos: tamaño del seed y cómo se generó:** … (cuántas filas por tabla, qué script o SQL, si es determinista, si es el mismo en las dos formas)

## Método

- Corridas por forma y por falla: … (5 o más), con `down -v` entre corridas.
- Orden de las corridas: … (¿alternadas entre formas o todas las de una forma seguidas?)
- Dónde están los datos crudos: …

## Resultados

Mediana de las … corridas y, entre paréntesis, el rango (mínimo–máximo).

### Falla: …

| Forma | Ruta | Fase | p95 (ms) | % errores | Llamadas al módulo |
|---|---|---|---:|---:|---:|
| En proceso | … (usa el módulo) | antes | … (…–…) | … (…–…) | … |
| En proceso | … (usa el módulo) | falla | | | |
| En proceso | … (usa el módulo) | después | | | |
| En proceso | … (control) | antes | | | - |
| En proceso | … (control) | falla | | | - |
| En proceso | … (control) | después | | | - |
| Extraído | … (usa el módulo) | antes | | | |
| Extraído | … (usa el módulo) | falla | | | |
| Extraído | … (usa el módulo) | después | | | |
| Extraído | … (control) | antes | | | - |
| Extraído | … (control) | falla | | | - |
| Extraído | … (control) | después | | | - |

(Repitan la tabla para cada falla.)

### Recuperación

- Cuánto tarda la ruta que usa el módulo en volver a 0 % de errores después de arreglar la falla: … (cómo se midió)

### Build y arranque

| Forma | `docker compose build` (s) | `docker compose up -d --wait` (s) |
|---|---:|---:|
| En proceso | … (…–…) | … (…–…) |
| Extraído | … (…–…) | … (…–…) |

### El salto del proxy

- Extraído con Toxiproxy y sin fallas, p95 de la ruta que usa el módulo: … ms; en proceso: … ms.

## Hipótesis: ¿se cumplieron?

| # | Hipótesis | Resultado | ¿Se cumple? |
|---|---|---|---|
| H1 | | | |
| H2 | | | |

## Amenazas a la validez

Razones por las que estos números podrían no significar lo que creemos (diapositiva 46). Para cada una: cómo afecta a **este** experimento y qué se hizo para acotarla.

1. **Todo en una máquina.** La API, el módulo, Toxiproxy y k6 comparten la CPU, y la red entre ellos es la interna de Docker: …
2. **Toxiproxy agrega un salto.** …
3. **Docker Desktop sobre WSL2.** El build y el arranque dependen de la máquina virtual y del disco: …
4. **Calentamiento.** …
5. **El fallo provocado no es el real.** Las fallas de Toxiproxy son limpias; los incidentes reales suelen ser lentitud parcial: …

## Conclusión

… (en dos o tres frases; la decisión y su condición de reversión van en el ADR)
