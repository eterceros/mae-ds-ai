// Punto de entrada 1: la API completa (pedidos + precios en proceso o por HTTP).
//   node dist/main.js        (en compose: el servicio "api")
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks(); // SIGTERM (docker stop) cierra en orden y apaga el breaker
  const puerto = Number(process.env.PORT ?? 3000);
  await app.listen(puerto, '0.0.0.0');
  const modo = process.env.PRECIOS_MODO === 'http' ? `http, a ${process.env.PRECIOS_URL}` : 'proceso';
  console.log(`API escuchando en el puerto ${puerto}; precios en modo ${modo}`);
}

bootstrap().catch((err) => {
  console.error('No se pudo arrancar la API:', err?.message ?? err);
  process.exit(1);
});
