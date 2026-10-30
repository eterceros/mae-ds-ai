import { Module } from '@nestjs/common';
import { PreciosModule } from '../precios/precios.module';
import { PedidosController } from './pedidos.controller';

@Module({
  imports: [PreciosModule], // de precios/ se importa el módulo (que exporta PRECIOS) y nada más
  controllers: [PedidosController],
})
export class PedidosModule {}
