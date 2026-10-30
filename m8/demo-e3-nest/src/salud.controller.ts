// GET /salud: lo usa el healthcheck del contenedor. No toca a precios ni a nada externo.
import { Controller, Get } from '@nestjs/common';

@Controller('salud')
export class SaludController {
  @Get()
  salud() {
    return { ok: true };
  }
}
