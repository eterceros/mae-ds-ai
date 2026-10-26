import {
  Controller, Get, Patch, Post, Param, Body, Req, UseGuards, NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { RateLimitGuard } from './ratelimit.guard';
import type { AuthedRequest } from '../lib/principal';
import { store } from '../lib/orders';
import { fetchPrecio } from './precios.client';

@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  // ANTES — BOLA (OWASP API1:2023): devuelve el pedido pase lo que pase; NO comprueba el dueño.
  // Con un token válido de Alice se leen igual los pedidos de Bob.
  @Get(':id')
  get(@Param('id') id: string) {
    const o = store.get(id);
    if (!o) throw new NotFoundException('no existe');
    return o;
  }

  // ANTES — lo mismo al modificar: Alice renombra un pedido de Bob.
  @Patch(':id')
  patch(@Param('id') id: string, @Body('item') item: string) {
    const o = store.setItem(id, item);
    if (!o) throw new NotFoundException('no existe');
    return o;
  }

  // SE: precio del artículo del pedido, pedido al servicio "precios" (sin autenticarse ante él).
  @Get(':id/precio')
  async precio(@Param('id') id: string) {
    const o = store.get(id);
    if (!o) throw new NotFoundException('no existe');
    return { id: o.id, item: o.item, precios: await fetchPrecio(o.item) };
  }
}

@Controller()
export class MiscController {
  @Get('health')
  health() { return { ok: true, mode: 'antes' }; }

  // SC: endpoint con límite por IP (ver RateLimitGuard de antes).
  @Get('ping')
  @UseGuards(AuthGuard, RateLimitGuard)
  ping(@Req() req: AuthedRequest) {
    return { ok: true, user: req.principal?.username };
  }

  // SD — SSRF (OWASP API7:2023): descarga la URL que mande el usuario, sin validarla.
  // Un atacante registra como "webhook" una URL interna y la API la trae por él.
  @Post('fetch')
  @UseGuards(AuthGuard)
  async fetch(@Body('url') url: string) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const body = (await r.text()).slice(0, 300);
      return { reached: true, status: r.status, body };
    } catch (e) {
      return { reached: false, error: String((e as Error).message) };
    }
  }
}
