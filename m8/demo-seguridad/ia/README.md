# SF — IA para buscar vulnerabilidades (demo en vivo)

**Preparado, sin ejecutar.** En clase, el docente corre `/security-review` de Claude Code sobre el código **inseguro** de esta demo y completa en vivo la tabla de [`HALLAZGOS.md`](HALLAZGOS.md). No se ejecuta aquí para no gastar tokens ni fijar un resultado que depende del modelo del día. El plugin Claude Security queda solo como mención: en el tiempo del bloque no caben dos revisiones en vivo.

## Por qué no se revisa este repositorio directamente

- `/security-review` revisa **los commits de la rama actual que aún no están en `origin/HEAD`**: en Claude Code 2.1.310 lee `git diff --name-only origin/HEAD...`, `git log origin/HEAD...` y `git diff origin/HEAD...`. Los cambios sin confirmar no entran. En `mae-ds-ai`, `src/antes/` queda confirmado en la rama de la sesión y luego en `main`: una vez fusionado, ese diff ya no lo contiene, y antes de fusionarlo lo mezcla con todo lo demás de la rama.
- Además, aquí la IA leería las respuestas: los comentarios de `src/antes/` nombran cada fallo, y al lado están `results/`, `DIFERENCIAS.md`, este README y `src/despues/`.

Por eso [`preparar-revision.mjs`](preparar-revision.mjs) arma un repositorio aparte, **fuera de `mae-ds-ai`**, con solo el código inseguro y sin pistas.

## Qué hace el script

`node ia/preparar-revision.mjs` (Node 24 y git; sin dependencias):

1. Crea `%TEMP%\s12-ia-revision` (o la carpeta que se le pase como argumento; se niega si está dentro de `mae-ds-ai`). Si ya existe y la creó él, la rehace.
2. Hace un commit inicial **vacío** en `main` y lo marca como `origin/main` y `origin/HEAD` (no hay remoto real).
3. En la rama `revision` copia `src/antes/` y `src/lib/` aplanados en `src/` (más un `main.ts`, un `package.json` y un `tsconfig.json` neutros), **sin comentarios**, sin el selector antes/después y sin el servicio interno simulado. No copia `results/`, `DIFERENCIAS.md`, `ia/`, `src/despues/` ni `src/sim/`.
4. Revisa que ningún archivo contenga palabras que delaten los fallos (BOLA, SSRF, OWASP, antes, después, corrección, vulnerable, ataque…); si alguna aparece, se detiene sin confirmar.
5. Confirma el código en `revision`. Ese commit es el **cambio pendiente de la rama** frente a `origin/HEAD`: exactamente lo que lee `/security-review` (12 archivos).

## Pasos en clase

1. **Antes de la clase** (o en el receso), desde `m8/demo-seguridad`:

   ```
   node ia/preparar-revision.mjs
   ```

   Debe terminar con `Repositorio listo: …\s12-ia-revision` y `Rama: revision · cambios frente a origin/HEAD: 12 archivos`.

2. **Al comenzar el bloque 4**, en una terminal aparte (PowerShell), lanzar la revisión y dejarla corriendo en paralelo mientras sigue la clase:

   ```
   cd $env:TEMP\s12-ia-revision
   claude
   ```

   y dentro de Claude Code:

   ```
   /security-review
   ```

   (En Git Bash: `cd "$TEMP/s12-ia-revision"`.) La revisión tarda varios minutos y su resultado no es determinista; por eso se lanza antes y se lee después.

3. **En el bloque 5**, volver a esa terminal, leer el informe y completar [`HALLAZGOS.md`](HALLAZGOS.md): qué detectó, qué no y los falsos positivos.

4. Al terminar, borrar la carpeta temporal (`Remove-Item -Recurse -Force $env:TEMP\s12-ia-revision`).

## Lo que debería encontrar

Lo medimos nosotros (ver [`../results/ESCENARIOS.md`](../results/ESCENARIOS.md)); en el repositorio temporal los archivos están en `src/`:

- **SA** BOLA: `src/orders.controller.ts` no comprueba el dueño en `get`, `patch` ni `precio`.
- **SB** autenticación rota: `src/auth.guard.ts` decodifica el JWT sin verificar firma, `alg`, `iss`, `aud` ni `exp`.
- **SC** límite por IP en vez de por identidad: `src/ratelimit.guard.ts`.
- **SD** SSRF: `src/orders.controller.ts` (`POST /fetch`) descarga cualquier URL.
- **SE** `api` llama a `precios` sin autenticarse: `src/precios.client.ts`.

## El punto de la sesión

Comparar lo que encuentra la IA con lo que miden **nuestras** pruebas (`results/`): la IA es buena para señalar patrones conocidos (BOLA, validación de JWT ausente), pero no sustituye a las pruebas que ejecutan el ataque y cuentan el resultado. Límite en una línea: encuentra lo que «se parece a» un fallo; confirma solo lo que se prueba.
