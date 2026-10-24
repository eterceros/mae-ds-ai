// DESPUÉS: el mismo cliente de B, corregido. Cada cambio respecto de ../antes/cliente-b.ts
// está marcado con «CORRECCIÓN:» y explica por qué.
import type http from 'node:http';
import { setTimeout as dormir } from 'node:timers/promises';
import { ErrorDeB, get, type Respuesta } from '../http-get.ts';

/** Una llamada a B con plazo total. */
export async function llamarB(url: string, agent: http.Agent, plazoMs: number, intento = 1): Promise<Respuesta> {
  // CORRECCIÓN: plazo total con AbortSignal.timeout(ms): una señal que se aborta sola a los
  // `ms` milisegundos. Cubre esperar una conexión libre, conectar, enviar y leer la respuesta.
  // La latencia de A deja de depender de B: como mucho `plazoMs` por llamada (R2).
  const signal = AbortSignal.timeout(plazoMs);
  // (x-intento solo sirve para que B cuente cuántos reintentos le llegan en R4.)
  const r = await get(url, agent, signal, { 'x-intento': String(intento) });
  if (r.status >= 500) throw new ErrorDeB(r.status);
  return r;
}

/** ¿Se venció el plazo? (node:http lanza AbortError; la causa es el TimeoutError de la señal). */
export function esTimeout(err: unknown): boolean {
  const e = err as { name?: string; cause?: { name?: string } };
  return e?.name === 'TimeoutError' || e?.cause?.name === 'TimeoutError';
}

export type Jitter = 'ninguno' | 'completo' | 'igual';

export interface OpcionesReintento {
  idempotente: boolean; // ¿repetir la operación deja el mismo resultado? (GET sí; un POST de pago, no)
  intentos: number; // intentos en total (1 = sin reintentos)
  baseMs: number; // espera antes del 1er reintento; se duplica en cada uno
  topeMs: number; // la espera nunca pasa de aquí
  jitter: Jitter; // 'completo' = al azar entre 0 y el exponencial; 'igual' = la mitad fija + la mitad al azar
  alReintentar?: () => void; // para contar reintentos
}

/** Reintentos con backoff exponencial y jitter. */
export async function conReintentos<T>(fn: (intento: number) => Promise<T>, o: OpcionesReintento): Promise<T> {
  // CORRECCIÓN: solo se reintenta una operación idempotente. Si no lo es, un intento y listo
  // (para reintentar un POST hace falta una clave de idempotencia que B respete).
  if (!o.idempotente) return fn(1);
  for (let intento = 1; ; intento++) {
    try {
      return await fn(intento);
    } catch (err) {
      // llamarB solo lanza ante timeout, error de red o 5xx: todo eso vale la pena reintentarlo.
      // Un 4xx (petición mal hecha) no lanza, así que no se reintenta.
      if (intento >= o.intentos) throw err;
      // CORRECCIÓN: backoff exponencial con tope: 1.ª espera baseMs, luego el doble... hasta topeMs.
      // Le da tiempo a B de recuperarse en vez de insistirle enseguida.
      const exponencial = Math.min(o.topeMs, o.baseMs * 2 ** (intento - 1));
      // CORRECCIÓN: jitter. Con una espera al azar, los clientes que fallaron juntos NO
      // reintentan juntos: los reintentos se reparten en el tiempo en vez de llegar en ráfaga (R4).
      // ('ninguno' queda solo para poder medir la diferencia.)
      const espera =
        o.jitter === 'completo' ? Math.random() * exponencial
        : o.jitter === 'igual' ? exponencial / 2 + Math.random() * (exponencial / 2)
        : exponencial;
      o.alReintentar?.();
      await dormir(espera);
    }
  }
}
