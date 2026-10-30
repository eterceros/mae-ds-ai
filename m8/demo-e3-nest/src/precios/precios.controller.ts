// La ruta del servicio extraído: GET /precios/:id. Solo la publica main-precios.ts.
// Es la que llama PreciosHttp desde la API (a través de Toxiproxy).
import { Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { PrecioNoEncontrado } from './precios.port';
import { PreciosService } from './precios.service';

@Controller('precios')
export class PreciosController {
  constructor(private readonly dominio: PreciosService) {}

  @Get(':id')
  precio(@Param('id', ParseIntPipe) id: number) {
    try {
      return this.dominio.precioDe(id);
    } catch (err) {
      if (err instanceof PrecioNoEncontrado) throw new NotFoundException(err.message);
      throw err;
    }
  }
}
