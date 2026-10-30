// El módulo de precios como servicio aparte (forma extraída): lo arranca main-precios.ts.
// Usa el MISMO dominio (PreciosService) que la forma en proceso: lo único que cambia es
// que se llega a él por HTTP.
import { Module } from '@nestjs/common';
import { SaludController } from '../salud.controller';
import { PreciosController } from './precios.controller';
import { PreciosService } from './precios.service';

@Module({
  controllers: [PreciosController, SaludController],
  providers: [PreciosService],
})
export class PreciosServicioModule {}
