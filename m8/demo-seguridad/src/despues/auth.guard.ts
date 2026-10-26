// DESPUES — validación correcta del JWT (OWASP API2:2023).
// Se verifica la firma contra el JWKS del emisor, se fija el algoritmo y se comprueban iss, aud y exp.
import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { JWKS_URL, ISSUER, API_AUDIENCE } from '../lib/config';
import type { AuthedRequest } from '../lib/principal';

// CORRECCIÓN: la clave pública se descarga del JWKS del emisor y jose la cachea y la rota sola.
// Nunca se codifica una clave ni se confía en la que venga dentro del token.
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = String(req.headers['authorization'] ?? '');
    const token = header.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('falta el token');
    let payload;
    try {
      ({ payload } = await jwtVerify(token, JWKS, {
        // CORRECCIÓN: algoritmo FIJO. Cierra alg=none y la confusión de claves (HS256 con la
        // clave pública): jose ni siquiera intenta verificar con un algoritmo fuera de la lista.
        algorithms: ['RS256'],
        issuer: ISSUER,        // CORRECCIÓN: el token tiene que venir de nuestro emisor.
        audience: API_AUDIENCE, // CORRECCIÓN: tiene que ir dirigido a esta API (aud=orders-api).
        clockTolerance: 5,     // 5 s de margen de reloj; exp se comprueba siempre.
      }));
    } catch {
      throw new UnauthorizedException('token inválido');
    }
    // CORRECCIÓN: el backend nunca acepta un ID token como access token. El access token de
    // Keycloak lleva typ=Bearer; el ID token, typ=ID (y, además, aud=cliente, que ya falla arriba).
    if (payload.typ && payload.typ !== 'Bearer') throw new UnauthorizedException('no es un access token');
    req.principal = {
      sub: String(payload.sub),
      username: String(payload['preferred_username'] ?? ''),
      roles: (payload['realm_access'] as { roles?: string[] } | undefined)?.roles ?? [],
    };
    return true;
  }
}
