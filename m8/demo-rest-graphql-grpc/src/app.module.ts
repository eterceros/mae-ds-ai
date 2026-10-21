import { Module } from '@nestjs/common';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginCacheControlDisabled } from '@apollo/server/plugin/disabled';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'path';
import { DataService } from './data.service';
import { StudentsController } from './students.controller';
import { StudentsGrpcController } from './students.grpc';
import { StudentsResolver } from './students.resolver';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: [join(process.cwd(), 'src/schema.graphql')],
      path: '/graphql',
      // Un objeto nuevo por peticion: ahi vive el dataloader de esa peticion.
      context: () => ({}),
      introspection: true,
      // Apollo instala por defecto un plugin de control de cache que ejecuta codigo en CADA campo de la
      // respuesta; con listas grandes duplica el tiempo de GraphQL. Esta demo no usa cache de Apollo, asi que
      // se desactiva (APOLLO_CACHE_CONTROL=on lo deja como viene de fabrica, para ver la diferencia).
      plugins: process.env.APOLLO_CACHE_CONTROL === 'on' ? [] : [ApolloServerPluginCacheControlDisabled()],
    }),
  ],
  controllers: [StudentsController, StudentsGrpcController],
  providers: [DataService, StudentsResolver],
})
export class AppModule {}
