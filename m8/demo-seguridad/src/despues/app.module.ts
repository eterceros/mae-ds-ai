import { Module } from '@nestjs/common';
import { OrdersController, MiscController } from './orders.controller';

@Module({ controllers: [OrdersController, MiscController] })
export class AppModule {}
