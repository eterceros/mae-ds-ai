// Arranque de la API NestJS mínima. MODE elige qué módulo (antes/despues) se monta.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MODE, API_PORT } from './config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = MODE === 'antes'
  ? require('../antes/app.module')
  : require('../despues/app.module');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(API_PORT, '127.0.0.1');
  console.log(`RESULT ${JSON.stringify({ mode: MODE, port: API_PORT })}`);
}
bootstrap().catch((e) => { console.error(e); process.exit(1); });
