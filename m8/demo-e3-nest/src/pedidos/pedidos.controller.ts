// Pedidos: la parte de la API que NECESITA precios (/pedidos/:id) y una que no (/catalogo).
//
// REGLA DE FRONTERA: de precios/ solo se importa el contrato (precios.port.ts) y, en
// pedidos.module.ts, el módulo. Nada de '../precios/precios.service' ni otras clases internas.
// `npm run frontera` falla si aparece uno de esos imports.
import { Controller, Get, Inject, NotFoundException, Param, ParseIntPipe, ServiceUnavailableException } from '@nestjs/common';
import { PRECIOS, PrecioNoEncontrado, PreciosNoDisponible, type PreciosPort } from '../precios/precios.port';
import { CATALOGO, PEDIDOS } from './pedidos.datos';

// Plazo total de GET /pedidos/:id: lo que esta ruta está dispuesta a esperar a precios,
// con todos sus reintentos. Mayor que el plazo de un intento (PRECIOS_PLAZO_INTENTO_MS).
const PLAZO_TOTAL_MS = Number(process.env.PEDIDOS_PLAZO_MS ?? 800);

@Controller()
export class PedidosController {
  // Pide el token PRECIOS y recibe PreciosEnProceso o PreciosHttp sin saber cuál.
  constructor(@Inject(PRECIOS) private precios: PreciosPort) {}

  @Get('pedidos/:id')
  async pedido(@Param('id', ParseIntPipe) id: number) {
    const pedido = PEDIDOS.get(id);
    if (!pedido) throw new NotFoundException(`no existe el pedido ${id}`);
    // El plazo se crea aquí, donde empieza la petición, y viaja hasta precios.
    const deadline = AbortSignal.timeout(PLAZO_TOTAL_MS);
    try {
      const precio = await this.precios.precioDe(pedido.productoId, deadline);
      return { ...pedido, precioUnitario: precio.monto, total: precio.monto * pedido.cantidad, moneda: precio.moneda };
    } catch (err) {
      if (err instanceof PrecioNoEncontrado) throw new NotFoundException(err.message);
      // Precios caído, colgado o con el circuito abierto: 503 con un cuerpo que dice por qué.
      // La API sigue viva; solo esta ruta depende de precios.
      const motivo = err instanceof PreciosNoDisponible ? err.motivo : 'error inesperado';
      throw new ServiceUnavailableException({ statusCode: 503, error: 'Precios no disponible', motivo, pedido: id });
    }
  }

  // Ruta de control: NO usa precios. Si falla cuando falla precios, la caída arrastra al resto.
  @Get('catalogo')
  catalogo() {
    return CATALOGO;
  }
}
