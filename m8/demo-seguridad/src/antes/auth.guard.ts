// ANTES — autenticación rota (OWASP API2:2023).
// El antipatrón real: "decodificamos el JWT para sacar el usuario". Se lee el payload sin verificar
// NADA — ni la firma, ni iss, ni aud, ni exp, ni el algoritmo. Cualquiera que fabrique un JWON con un
// "sub" dentro entra. Acepta: sin firma, alg=none, firmado con otra clave, confusión de claves
// (HS256 con la clave pública), expirado y hasta un ID token usado como access token.
import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../lib/principal';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = String(req.headers['authorization'] ?? '');
    const token = header.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('falta el token');
    // Solo se parte el token y se lee el segundo trozo. No hay verificación de ningún tipo.
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    req.principal = {
      sub: payload.sub,
      username: payload.preferred_username,
      roles: payload.realm_access?.roles ?? [],
    };
    return true;
  }
}
