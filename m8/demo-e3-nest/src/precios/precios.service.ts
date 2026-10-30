// El dominio del módulo de precios. En esta plantilla es una tabla en memoria, sin base de
// datos, para que el ejemplo sea corto. En su proyecto, aquí van el repositorio y las tablas
// propias del módulo (las que nadie más toca), llenadas con su seed (ver «Datos para la carga»
// en el README).
import { Injectable } from '@nestjs/common';
import { PrecioNoEncontrado, type Precio } from './precios.port';

// Cuántos productos hay. Determinista: siempre los mismos ids (1..N) y los mismos montos,
// en las dos formas y en cada corrida. k6 elige ids de este rango (N_PRODUCTOS en k6/carga.js).
export const N_PRODUCTOS = 1000;

@Injectable()
export class PreciosService {
  private readonly tabla = new Map<number, Precio>(
    Array.from({ length: N_PRODUCTOS }, (_, i): [number, Precio] => {
      const id = i + 1;
      // Sin Math.random: el mismo id da siempre el mismo monto (entre 10 y 509,5 BOB).
      return [id, { productoId: id, monto: 10 + ((id * 37) % 1000) / 2, moneda: 'BOB' }];
    }),
  );

  precioDe(id: number): Precio {
    const precio = this.tabla.get(id);
    if (!precio) throw new PrecioNoEncontrado(`no hay precio para el producto ${id}`);
    return precio;
  }
}
