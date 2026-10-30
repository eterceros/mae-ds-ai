// Forma 2, servicio extraído: la misma pregunta, por la red, a otro contenedor.
// Todo lo que la red puede hacer mal se programa aquí, no en Pedidos:
//   1. plazo por intento, acotado por el plazo total de quien llama;
//   2. reintentos con backoff exponencial y jitter (GET es idempotente);
//   3. circuit breaker (opossum) para dejar de llamar a un módulo que no responde.
// Son las piezas de demo-resiliencia/src/despues/, dentro de una clase de NestJS.
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { setTimeout as dormir } from 'node:timers/promises';
import { crearBreaker } from './breaker';
import type { ConEstadisticas, Estadisticas } from './estadisticas';
import { PrecioNoEncontrado, PreciosNoDisponible, type Precio, type PreciosPort } from './precios.port';

const numero = (nombre: string, porOmision: number) => Number(process.env[nombre] ?? porOmision);

/** El módulo respondió, pero con un 5xx (u otro estado inesperado). */
class ErrorDeEstado extends Error {
  constructor(readonly status: number) {
    super(`precios respondió ${status}`);
  }
}

@Injectable()
export class PreciosHttp implements PreciosPort, ConEstadisticas, OnModuleDestroy {
  private readonly log = new Logger('PreciosHttp');
  // En compose apunta a Toxiproxy (http://toxiproxy:8666), no al módulo: así se le puede romper la red.
  private readonly url = process.env.PRECIOS_URL ?? 'http://localhost:3001';
  private readonly plazoIntentoMs = numero('PRECIOS_PLAZO_INTENTO_MS', 300);
  private readonly intentos = numero('PRECIOS_INTENTOS', 2); // en total: 2 = un reintento
  private readonly esperaBaseMs = numero('PRECIOS_ESPERA_BASE_MS', 50);

  private llamadas = 0;
  private reintentos = 0;
  private rechazadas = 0;
  private aperturas = 0;

  // La acción protegida es UN intento: solo se ejecuta si el circuito la deja pasar.
  private readonly breaker = crearBreaker((id: number, deadline: AbortSignal) => this.unIntento(id, deadline), {
    ventanaMs: numero('PRECIOS_BREAKER_VENTANA_MS', 2_000), // la demo comparó 10 s (lo de opossum) y 2 s: R5
    resetMs: numero('PRECIOS_BREAKER_RESET_MS', 2_000),
    noEsFalla: (err) => err instanceof PrecioNoEncontrado, // un 404 no dice que el módulo esté mal
  });

  constructor() {
    this.breaker.on('open', () => {
      this.aperturas++;
      this.log.warn('circuito ABIERTO: deja de llamar a precios');
    });
    this.breaker.on('halfOpen', () => this.log.log('circuito semiabierto: deja pasar una llamada de prueba'));
    this.breaker.on('close', () => this.log.log('circuito cerrado: precios responde de nuevo'));
    this.breaker.on('reject', () => this.rechazadas++);
  }

  async precioDe(id: number, deadline: AbortSignal): Promise<Precio> {
    for (let intento = 1; ; intento++) {
      try {
        return await this.breaker.fire(id, deadline);
      } catch (err) {
        if (err instanceof PrecioNoEncontrado) throw err;
        const motivo = motivoDe(err, deadline);
        // No se reintenta si se acabaron los intentos, si el circuito está abierto (fallaría
        // igual en 1 ms) o si ya venció el plazo total de quien llama.
        if (intento >= this.intentos || motivo === 'circuito abierto' || deadline.aborted) {
          throw new PreciosNoDisponible(motivo, { cause: err });
        }
        // Backoff exponencial con jitter completo: espera al azar entre 0 y base·2^(intento-1),
        // así los clientes que fallaron juntos no reintentan juntos (R4 de la demo).
        this.reintentos++;
        const espera = Math.random() * this.esperaBaseMs * 2 ** (intento - 1);
        // La espera también respeta el plazo total: si vence mientras se espera, se corta.
        await dormir(espera, undefined, { signal: deadline }).catch(() => {});
        if (deadline.aborted) throw new PreciosNoDisponible('plazo total vencido', { cause: err });
      }
    }
  }

  private async unIntento(id: number, deadline: AbortSignal): Promise<Precio> {
    this.llamadas++;
    // Plazo por intento, acotado por el plazo total: la señal se aborta con la PRIMERA de las
    // dos (el deadline de quien llama o los `plazoIntentoMs` de este intento).
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(this.plazoIntentoMs)]);
    const r = await fetch(`${this.url}/precios/${id}`, { signal });
    if (r.status === 404) throw new PrecioNoEncontrado(`no hay precio para el producto ${id}`);
    if (!r.ok) throw new ErrorDeEstado(r.status);
    // Mientras se lee el cuerpo la señal sigue activa: si el módulo se cuelga a mitad, también corta.
    return (await r.json()) as Precio;
  }

  estadisticas(): Estadisticas {
    return {
      modo: 'http',
      llamadas: this.llamadas,
      reintentos: this.reintentos,
      rechazadasPorBreaker: this.rechazadas,
      aperturasDelBreaker: this.aperturas,
      breaker: this.breaker.opened ? 'abierto' : this.breaker.halfOpen ? 'semiabierto' : 'cerrado',
    };
  }

  onModuleDestroy() {
    this.breaker.shutdown(); // apaga los temporizadores de opossum al cerrar la API
  }
}

/** Traduce el error de un intento a un motivo legible para la respuesta 503. */
function motivoDe(err: unknown, deadline: AbortSignal): string {
  const e = err as { code?: string; name?: string; cause?: { code?: string } };
  if (e?.code === 'EOPENBREAKER') return 'circuito abierto';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return deadline.aborted ? 'plazo total vencido' : 'plazo del intento vencido';
  }
  if (err instanceof ErrorDeEstado) return err.message;
  // fetch envuelve los errores de red en un TypeError con la causa (ECONNREFUSED, ECONNRESET...).
  return `error de red (${e?.cause?.code ?? e?.code ?? 'desconocido'})`;
}
