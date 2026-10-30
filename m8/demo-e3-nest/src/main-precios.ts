// Punto de entrada 2: SOLO el módulo de precios, como servicio aparte (forma extraída).
//   node dist/main-precios.js   (en compose: el servicio "precios", misma imagen, otro comando)
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PreciosServicioModule } from './precios/precios-servicio.module';

async function bootstrap() {
  const app = await NestFactory.create(PreciosServicioModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  const puerto = Number(process.env.PORT ?? 3001);
  await app.listen(puerto, '0.0.0.0');
  console.log(`Servicio de precios escuchando en el puerto ${puerto}`);
}

bootstrap().catch((err) => {
  console.error('No se pudo arrancar el servicio de precios:', err?.message ?? err);
  process.exit(1);
});
