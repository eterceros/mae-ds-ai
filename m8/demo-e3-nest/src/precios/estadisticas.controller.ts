// GET /stats de la API: contadores de la implementación de precios en uso (los lee k6).
import { Controller, Get, Inject } from '@nestjs/common';
import type { ConEstadisticas } from './estadisticas';
import { PRECIOS, type PreciosPort } from './precios.port';

@Controller('stats')
export class EstadisticasController {
  constructor(@Inject(PRECIOS) private readonly precios: PreciosPort & ConEstadisticas) {}

  @Get()
  stats() {
    return this.precios.estadisticas();
  }
}
