// API de pedidos (NestJS 12), versión DESPUÉS. La instrumentación NO está en este archivo: la carga
// Node antes que la app (NODE_OPTIONS en docker-compose.yml). Lo único que se toca es la outbox: por
// una tabla no hay instrumentación que lleve el contexto, así que se guarda con la API de OpenTelemetry.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { context, propagation } from '@opentelemetry/api';
import { PORT, PRECIOS_URL, SCHEMA } from '../lib/config.js';
import { ensureSchema, pool } from '../lib/db.js';
import { log } from '../lib/log.js';

@Controller()
class PedidosController {
  @Get('salud')
  salud() { return 'ok'; }

  @Post('pedidos')
  @HttpCode(201)
  // CORRECCIÓN: ya no se lee la cabecera traceparent a mano; la instrumentación HTTP la leyó y
  // este código corre dentro del span de la petición.
  async crear(@Body() body: { sku?: string; cantidad?: number }) {
    const sku = body.sku ?? 'sku-1';
    const cantidad = body.cantidad ?? 1;
    // fetch (undici) está instrumentado: el traceparent viaja solo a precios.
    const r = await fetch(`${PRECIOS_URL}/precios/${sku}`);
    const { cents } = (await r.json()) as { cents: number };
    const pedido = { id: randomUUID(), sku, cantidad, totalCents: cents * cantidad };
    // CORRECCIÓN: en vez de armar el traceparent con childOf() (S08), se pide al propagador de
    // OpenTelemetry que escriba el contexto ACTIVO (traceparent y, si hay, tracestate y baggage).
    const headers: Record<string, string> = {};
    propagation.inject(context.active(), headers);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO ${SCHEMA}.pedidos (id, sku, cantidad, total_cents) VALUES ($1, $2, $3, $4)`,
        [pedido.id, sku, cantidad, pedido.totalCents]);
      await c.query(`INSERT INTO ${SCHEMA}.outbox (pedido_id, payload, headers) VALUES ($1, $2, $3)`,
        [pedido.id, pedido, headers]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    // CORRECCIÓN: log estructurado con pino; trace_id y span_id los agrega la instrumentación (OC).
    log.info({ pedido: pedido.id, sku, totalCents: pedido.totalCents }, 'pedido creado');
    return pedido;
  }
}

@Module({ controllers: [PedidosController] })
class AppModule {}

await ensureSchema();
const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
app.enableShutdownHooks();
await app.listen(PORT, '0.0.0.0');
log.info({ port: PORT }, 'api (despues) escuchando');
