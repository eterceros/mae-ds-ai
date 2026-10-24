import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule, POOL } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  // Como hacen TypeORM o Prisma al iniciar: si la base no responde, el proceso
  // termina con error. Es lo que deja ver el escenario K5 (arranque sin healthcheck).
  const pool = app.get<Pool>(POOL);
  await pool.query('SELECT 1');

  // SIGTERM (docker stop) cierra el servidor y el pool en orden (visto en la S02).
  app.enableShutdownHooks();

  const puerto = Number(process.env.PORT ?? 3000);
  await app.listen(puerto, '0.0.0.0');
  console.log(`API escuchando en el puerto ${puerto}`);
}

bootstrap().catch((err) => {
  console.error('No se pudo arrancar la API:', err.message ?? err);
  process.exit(1);
});
