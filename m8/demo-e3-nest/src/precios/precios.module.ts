// El módulo de precios tal como lo ve la API: entrega PRECIOS con la forma elegida.
import { Module } from '@nestjs/common';
import { EstadisticasController } from './estadisticas.controller';
import { PreciosEnProceso } from './precios-en-proceso';
import { PreciosHttp } from './precios-http';
import { PRECIOS } from './precios.port';
import { PreciosService } from './precios.service';

// PRECIOS_MODO se lee UNA vez, al cargar este archivo (al arrancar la API):
//   http        -> PreciosHttp: por la red, a PRECIOS_URL, con plazo, reintentos y breaker
//   otro valor  -> PreciosEnProceso: llamada directa, como en un monolito modular
// Cambiar de forma = cambiar la variable y reiniciar. Pedidos no cambia ni una línea.
@Module({
  controllers: [EstadisticasController],
  providers: [
    PreciosService, // solo lo usa PreciosEnProceso; en modo http queda sin usar
    { provide: PRECIOS, useClass: process.env.PRECIOS_MODO === 'http' ? PreciosHttp : PreciosEnProceso },
  ],
  exports: [PRECIOS],
})
export class PreciosModule {}
