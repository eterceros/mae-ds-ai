// Forma 1, monolito modular: el módulo corre en el mismo proceso que la API.
import { Injectable } from '@nestjs/common';
import type { ConEstadisticas, Estadisticas } from './estadisticas';
import type { Precio, PreciosPort } from './precios.port';
import { PreciosService } from './precios.service';

@Injectable()
export class PreciosEnProceso implements PreciosPort, ConEstadisticas {
  private llamadas = 0;

  constructor(private readonly dominio: PreciosService) {}

  // Llamada directa al dominio: sin red, sin serializar, sin fallos nuevos.
  // El deadline se ignora: no hay nada que pueda colgarse en el medio.
  async precioDe(id: number, _deadline: AbortSignal): Promise<Precio> {
    this.llamadas++;
    return this.dominio.precioDe(id);
  }

  estadisticas(): Estadisticas {
    return { modo: 'proceso', llamadas: this.llamadas };
  }
}
