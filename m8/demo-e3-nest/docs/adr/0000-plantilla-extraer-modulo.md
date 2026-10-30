# ADR 0000 · Extraer (o no) el módulo … a un servicio

> Plantilla. Cópienla con el número que siga en su `docs/adr/` (p. ej. `0012-extraer-precios.md`) y reemplacen cada `…`. Decidir **no** extraer también es una decisión válida.

- **Estado:** propuesto / aceptado / reemplazado por …
- **Fecha:** …
- **Autores:** …

## Contexto

Qué módulo es, por qué se pensó en extraerlo (la razón de la diapositiva 36: otro *runtime*, carga distinta, datos sensibles, ritmo de despliegue distinto…) y qué restricciones hay.

…

## Decisión

Qué se decide, en una o dos frases. Si se extrae, con qué protecciones (plazo, reintentos, breaker); si no, qué se deja preparado.

…

## Evidencia

Las cifras que sostienen la decisión, con la mediana y el rango de las corridas. El detalle está en `bench/e3/INFORME.md`.

- p95 de … : en proceso … ms, extraído … ms (mediana de …, rango …).
- Con el módulo caído: …
- Ruta que no usa el módulo, durante la falla: …
- Build y arranque: …

## Consecuencias

Qué se gana, qué se paga y qué queda por hacer.

…

## Condición de reversión

El hecho **medible** que haría deshacer esta decisión: qué se mide, con qué umbral y en cuántas corridas o durante cuánto tiempo.

…
