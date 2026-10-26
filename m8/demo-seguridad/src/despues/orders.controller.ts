import {
  Controller, Get, Patch, Post, Param, Body, Req, UseGuards, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { RateLimitGuard } from './ratelimit.guard';
import { assertSafeUrl, BlockedUrlError } from './safe-url';
import type { AuthedRequest } from '../lib/principal';
import { store } from '../lib/orders';
import { fetchPrecio } from './precios.client';

@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  // DESPUES — corrección de BOLA: el objeto tiene que ser de quien lo pide.
  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthedRequest) {
    const o = store.get(id);
    // CORRECCIÓN: además de autenticar (AuthGuard), se autoriza por dueño. Si no es suyo, 404
    // (no 403) para no revelar siquiera que el pedido existe. Esta es la defensa contra BOLA.
    // CORRECCIÓN: el dueño se compara con el "sub" del token (id estable del usuario), no con
    // preferred_username, que el usuario o el administrador pueden cambiar y que no es único.
    if (!o || o.owner !== req.principal!.sub) throw new NotFoundException('no existe');
    return o;
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body('item') item: string, @Req() req: AuthedRequest) {
    const o = store.get(id);
    // CORRECCIÓN: misma comprobación de dueño (por sub) antes de modificar.
    if (!o || o.owner !== req.principal!.sub) throw new NotFoundException('no existe');
    store.setItem(id, item);
    return store.get(id);
  }

  @Get(':id/precio')
  async precio(@Param('id') id: string, @Req() req: AuthedRequest) {
    const o = store.get(id);
    if (!o || o.owner !== req.principal!.sub) throw new NotFoundException('no existe');
    return { id: o.id, item: o.item, precios: await fetchPrecio(o.item) };
  }
}

@Controller()
export class MiscController {
  @Get('health')
  health() { return { ok: true, mode: 'despues' }; }

  // SC: endpoint con límite por identidad (ver RateLimitGuard de despues). AuthGuard primero
  // para que el límite pueda usar el "sub" del token.
  @Get('ping')
  @UseGuards(AuthGuard, RateLimitGuard)
  ping(@Req() req: AuthedRequest) {
    return { ok: true, user: req.principal?.username };
  }

  // SD — SSRF: valida la URL antes de descargarla.
  @Post('fetch')
  @UseGuards(AuthGuard)
  async fetch(@Body('url') url: string) {
    try {
      // CORRECCIÓN: validar esquema y destino ANTES de hacer la petición.
      await assertSafeUrl(url);
    } catch (e) {
      if (e instanceof BlockedUrlError) throw new BadRequestException({ blocked: true, reason: e.message });
      throw e;
    }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const body = (await r.text()).slice(0, 300);
      return { reached: true, status: r.status, body };
    } catch (e) {
      // Pasó la validación (destino externo) pero no se pudo alcanzar: NO es un bloqueo de SSRF.
      return { reached: false, error: String((e as Error).message) };
    }
  }
}
