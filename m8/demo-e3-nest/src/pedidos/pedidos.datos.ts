// Datos propios del módulo de pedidos, en memoria y deterministas (en su proyecto: sus tablas,
// llenadas por el seed). Pedido i = producto i, así todo pedido tiene precio.
export interface Pedido {
  id: number;
  productoId: number;
  cantidad: number;
}

const N_PEDIDOS = 1000; // el mismo rango que N_PRODUCTOS en precios y que k6/carga.js

export const PEDIDOS = new Map<number, Pedido>(
  Array.from({ length: N_PEDIDOS }, (_, i): [number, Pedido] => [i + 1, { id: i + 1, productoId: i + 1, cantidad: (i % 5) + 1 }]),
);

// El catálogo (nombres, sin precios) también es de pedidos: GET /catalogo no necesita a precios.
// Devuelve la primera página (50), como haría una ruta paginada.
export const CATALOGO = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, nombre: `Producto ${i + 1}` }));
