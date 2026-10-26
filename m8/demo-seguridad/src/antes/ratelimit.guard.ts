// ANTES — límite de peticiones por IP (ventana fija). El algoritmo (ventana fija) se vio en S05/S06;
// lo que importa aquí es la CLAVE. Al contar por IP, dos usuarios detrás de la misma IP (NAT, oficina,
// móvil) comparten la cuenta: uno agota el cupo y deja fuera al otro.
import { Injectable, HttpException, HttpStatus, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../lib/principal';

const LIMIT = Number(process.env.RL_LIMIT ?? 20);
const WINDOW_MS = Number(process.env.RL_WINDOW_MS ?? 10000);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private hits = new Map<string, { count: number; resetAt: number }>();
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const key = req.ip ?? 'desconocida'; // clave = IP de origen
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || now >= e.resetAt) { e = { count: 0, resetAt: now + WINDOW_MS }; this.hits.set(key, e); }
    e.count++;
    if (e.count > LIMIT) throw new HttpException('demasiadas peticiones', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
