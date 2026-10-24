// ANTES: el cliente de B que escribe alguien con apuro (o una IA sin revisar).
// Funciona en la demo de la máquina propia; se cae cuando B se pone lento, se cuelga o se reinicia.
// Cada problema está marcado con «PROBLEMA:»; la versión corregida está en ../despues/.
//
// Nota: en un código real esto sería `await fetch(url)` sin `signal`. Aquí se usa el mismo GET
// de ../http-get.ts que la versión corregida, para que lo único que cambie entre antes/ y
// despues/ sean las protecciones (y Toxiproxy decida la falla llamada por llamada).
import type http from 'node:http';
import { ErrorDeB, get, type Respuesta } from '../http-get.ts';

/** Una llamada a B. */
export async function llamarB(url: string, agent: http.Agent, intento = 1): Promise<Respuesta> {
  // PROBLEMA: no hay plazo. Si B tarda 2 s, A tarda 2 s; si B no contesta nunca, la llamada
  // queda abierta para siempre (aunque el cliente de A ya se haya ido) y se acumulan (R1).
  const r = await get(url, agent, undefined, { 'x-intento': String(intento) });
  if (r.status >= 500) throw new ErrorDeB(r.status);
  return r;
}

/** Reintenta si falla. */
export async function conReintentos<T>(fn: (intento: number) => Promise<T>, intentos: number): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await fn(intento);
    } catch (err) {
      if (intento >= intentos) throw err;
      // PROBLEMA: reintenta enseguida, sin esperar. Todos los clientes que fallaron a la vez
      // vuelven a llamar a la vez, en ráfagas, contra un B que intenta recuperarse (R4).
      // PROBLEMA: reintenta cualquier operación, sin preguntar si es idempotente: un POST que
      // sí llegó a B (y falló al responder) se ejecutaría dos veces.
    }
  }
}

// PROBLEMA: no hay circuit breaker. Con B caído, cada petición sigue llamando a B y pagando
// el error (o el timeout, si lo hubiera) aunque las 500 anteriores hayan fallado igual (R5).
// PROBLEMA: no hay límite de concurrencia. Una dependencia lenta puede ocupar todas las
// conexiones del pool que comparte con otras rutas sanas (R6).
