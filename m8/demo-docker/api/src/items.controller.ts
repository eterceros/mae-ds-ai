import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from './tokens';

@Controller()
export class ItemsController {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  // Salud del proceso: no toca la base (la usa el healthcheck del contenedor).
  @Get('salud')
  salud() {
    return { ok: true };
  }

  // El unico endpoint "de negocio": lee la tabla que crea la migracion (K6).
  @Get('items')
  async items() {
    const { rows } = await this.pool.query(
      'SELECT id, nombre, precio FROM items ORDER BY id',
    );
    return rows;
  }
}
