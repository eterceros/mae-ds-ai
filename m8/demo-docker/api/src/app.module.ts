import { Module } from '@nestjs/common';
import { crearPool } from './db';
import { ItemsController } from './items.controller';
import { POOL } from './tokens';

export { POOL };

@Module({
  controllers: [ItemsController],
  providers: [{ provide: POOL, useFactory: crearPool }],
})
export class AppModule {}
