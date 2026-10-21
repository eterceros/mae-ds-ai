import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const httpPort = Number(process.env.HTTP_PORT ?? 3000);
  const grpcPort = Number(process.env.GRPC_PORT ?? 50051);
  const host = process.env.HOST ?? '127.0.0.1'; // 0.0.0.0 dentro de un contenedor

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'students',
      protoPath: join(process.cwd(), 'proto/students.proto'),
      url: `${host}:${grpcPort}`,
    },
  });

  // Node cierra las conexiones persistentes tras 5 s sin uso; un cliente que justo la reutiliza recibe un
  // ECONNRESET. Se sube para que las pausas entre pruebas no produzcan errores falsos.
  app.getHttpServer().keepAliveTimeout = 65_000;

  // gzip solo para los clientes HTTP que lo piden (Accept-Encoding). Se usa en la prueba con red limitada.
  if (process.env.HTTP_COMPRESSION === 'on') app.use(compression());

  await app.startAllMicroservices();
  await app.listen(httpPort, host);
  console.log(`REST     http://127.0.0.1:${httpPort}/students/1`);
  console.log(`GraphQL  http://127.0.0.1:${httpPort}/graphql`);
  console.log(`gRPC     127.0.0.1:${grpcPort}  (proto/students.proto)`);
}

bootstrap();
