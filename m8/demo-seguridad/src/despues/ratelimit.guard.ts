// DESPUES — límite de peticiones por identidad. Mismo algoritmo (ventana fija, visto en S05/S06);
// cambia la CLAVE: el "sub" del token en vez de la IP. Cada usuario tiene su propio cupo, así que dos
// usuarios detrás de la misma IP ya no se bloquean entre sí.
import { Injectable, HttpException, HttpStatus, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../lib/principal';

const LIMIT = Number(process.env.RL_LIMIT ?? 20);
const WINDOW_MS = Number(process.env.RL_WINDOW_MS ?? 10000);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private hits = new Map<string, { count: number; resetAt: number }>();
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    // CORRECCIÓN: la clave es el sujeto autenticado, no la IP. (AuthGuard ya corrió y puso principal.)
    const key = req.principal?.sub ?? req.ip ?? 'desconocida';
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || now >= e.resetAt) { e = { count: 0, resetAt: now + WINDOW_MS }; this.hits.set(key, e); }
    e.count++;
    if (e.count > LIMIT) throw new HttpException('demasiadas peticiones', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
