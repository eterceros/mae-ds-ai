// El contrato del módulo de precios: lo ÚNICO que el resto de la API conoce de él.
//
// REGLA DE FRONTERA: fuera de precios/, solo se importa este archivo y precios.module.ts.
// Nunca una clase interna (PreciosService, PreciosHttp, ...): después de extraer el módulo,
// esas clases viven en otro proceso y el import ya no tendría a qué apuntar.
// `npm run frontera` (scripts/chequear-frontera.mjs) lo revisa en cada build.

export interface Precio {
  productoId: number;
  monto: number;
  moneda: string;
}

// deadline = el plazo de quien llama: una señal que avisa «se acabó el tiempo, cancela».
// En proceso se ignora (la respuesta llega en microsegundos); por la red, sin plazo, una
// llamada colgada retendría la petición para siempre. Va en la firma desde el primer día.
export interface PreciosPort { precioDe(id: number, deadline: AbortSignal): Promise<Precio>; }

// El token con el que NestJS entrega la implementación elegida (ver precios.module.ts).
export const PRECIOS = Symbol('PRECIOS');

// Los errores también son parte del contrato: quien llama los distingue sin saber
// si el módulo corre en el mismo proceso o en otro contenedor.

/** El producto no existe (un 404, no una falla del módulo). */
export class PrecioNoEncontrado extends Error {}

/** El módulo no respondió a tiempo, está caído o el circuito está abierto. */
export class PreciosNoDisponible extends Error {
  constructor(readonly motivo: string, opciones?: { cause?: unknown }) {
    super(`precios no disponible: ${motivo}`, opciones);
  }
}
