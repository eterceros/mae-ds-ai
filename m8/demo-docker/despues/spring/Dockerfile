# Dockerfile multi-stage de referencia para un servicio Spring Boot (Maven).
# NO MEDIDO en esta demo: es una plantilla para quienes trabajan con Java.
# Supone un proyecto Maven estandar con el wrapper (mvnw) y Spring Boot >= 3.3
# (el modo "tools" del jar ejecutable para extraer capas) [por verificar con la
# version de Spring Boot de cada proyecto].
# Imagenes fijadas por digest (indice multi-arquitectura, consultado el
# 2026-10-24 con "docker buildx imagetools inspect"); la etiqueta exacta del
# parche de Java queda [por verificar]: conviene reemplazar "25-jdk"/"25-jre"
# por la etiqueta completa (p. ej. 25.0.x_y-jre) al copiar este archivo.

# 1) Compilar. La cache de ~/.m2 se monta solo durante el build (no queda en la imagen).
FROM eclipse-temurin:25-jdk@sha256:2d5d5e9b533342a565907c84f47a2ec298c40cde7b13a3ca85d4950fa456a641 AS build
WORKDIR /src
# Primero lo que define las dependencias: si solo cambia el codigo, esta capa sale de la cache.
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN --mount=type=cache,target=/root/.m2 ./mvnw -q dependency:go-offline
COPY src src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -q package -DskipTests

# 2) Separar el jar en capas (dependencias, loader, snapshots, aplicacion):
# las dependencias cambian poco y quedan en su propia capa de la imagen final.
FROM eclipse-temurin:25-jdk@sha256:2d5d5e9b533342a565907c84f47a2ec298c40cde7b13a3ca85d4950fa456a641 AS layers
WORKDIR /work
COPY --from=build /src/target/*.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --launcher --destination extracted

# 3) Imagen final: solo el JRE (sin compilador ni Maven) y usuario sin privilegios.
FROM eclipse-temurin:25-jre@sha256:dbb43d81099eec91e0800226ed2296d03146ee7857165b95112372ad0d67e87f AS runtime
# Usuario de sistema propio (uid fijo para que coincida con permisos de volumenes).
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /app
COPY --from=layers /work/extracted/dependencies/ ./
COPY --from=layers /work/extracted/spring-boot-loader/ ./
COPY --from=layers /work/extracted/snapshot-dependencies/ ./
COPY --from=layers /work/extracted/application/ ./
USER app
EXPOSE 8080
# Forma exec: la JVM es el PID 1 y recibe SIGTERM (apagado ordenado, S02).
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
