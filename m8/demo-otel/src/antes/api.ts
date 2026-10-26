// API de pedidos (NestJS 12), versión ANTES. Igual que en la S08: el pedido y su evento se guardan en
// la misma transacción (outbox) y el traceparent se arma A MANO (src/lib/trace.ts) y se guarda en la
// fila de la outbox; los logs son de texto. Sin OpenTelemetry funciona igual que en la S08; con la
// auto-instrumentación encendida (ANTES_NODE_OPTIONS, ver README), la traza se corta en la outbox (OB).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PORT, PRECIOS_URL, SCHEMA } from '../lib/config.js';
import { ensureSchema, pool } from '../lib/db.js';
import { childOf, traceIdOf } from '../lib/trace.js';

@Controller()
class PedidosController {
  @Get('salud')
  salud() { return 'ok'; }

  @Post('pedidos')
  @HttpCode(201)
  async crear(@Body() body: { sku?: string; cantidad?: number }, @Headers('traceparent') entrante?: string) {
    const sku = body.sku ?? 'sku-1';
    const cantidad = body.cantidad ?? 1;
    const r = await fetch(`${PRECIOS_URL}/precios/${sku}`);
    const { cents } = (await r.json()) as { cents: number };
    const pedido = { id: randomUUID(), sku, cantidad, totalCents: cents * cantidad };
    // Propagación manual de la S08: un span-id nuevo dentro del trace-id que llegó (o uno nuevo).
    const traceparent = childOf(entrante);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO ${SCHEMA}.pedidos (id, sku, cantidad, total_cents) VALUES ($1, $2, $3, $4)`,
        [pedido.id, sku, cantidad, pedido.totalCents]);
      await c.query(`INSERT INTO ${SCHEMA}.outbox (pedido_id, payload, headers) VALUES ($1, $2, $3)`,
        [pedido.id, pedido, { traceparent }]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    console.log(`pedido ${pedido.id} creado (trace ${traceIdOf(traceparent)})`);
    return pedido;
  }
}

@Module({ controllers: [PedidosController] })
class AppModule {}

await ensureSchema();
const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
app.enableShutdownHooks();
await app.listen(PORT, '0.0.0.0');
console.log(`api (antes) escuchando en ${PORT}`);
