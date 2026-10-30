// La API completa (main.ts): pedidos, con precios en la forma que diga PRECIOS_MODO.
import { Module } from '@nestjs/common';
import { PedidosModule } from './pedidos/pedidos.module';
import { SaludController } from './salud.controller';

@Module({
  imports: [PedidosModule],
  controllers: [SaludController],
})
export class AppModule {}
