package umss.m8.students;

import io.grpc.Server;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.util.concurrent.TimeUnit;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

@SpringBootApplication
public class StudentsApplication {

    public static void main(String[] args) {
        SpringApplication.run(StudentsApplication.class, args);
        String host = env("HOST", "127.0.0.1");
        System.out.println("REST     http://" + host + ":" + env("HTTP_PORT", "3000") + "/students/1");
        System.out.println("gRPC     " + host + ":" + env("GRPC_PORT", "50051") + "  (../proto/students.proto)");
    }

    static String env(String name, String def) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? def : v;
    }

    // Servidor gRPC (grpc-java sobre Netty) arrancado y parado junto con Spring. Ejecutor por defecto de
    // grpc-java (un hilo por llamada en curso), igual que Tomcat para REST: los dos bloquean un hilo durante
    // la consulta simulada.
    @Component
    static class GrpcServerLifecycle implements SmartLifecycle {
        private final StudentsGrpcService service;
        private final DataService data;
        private Server server;

        GrpcServerLifecycle(StudentsGrpcService service, DataService data) {
            this.service = service;
            this.data = data;
        }

        @Override
        public void start() {
            String host = env("HOST", "127.0.0.1");
            int port = Integer.parseInt(env("GRPC_PORT", "50051"));
            try {
                server = NettyServerBuilder.forAddress(new InetSocketAddress(host, port)).addService(service).build().start();
            } catch (IOException e) {
                throw new UncheckedIOException("No se pudo abrir gRPC en " + host + ":" + port, e);
            }
        }

        @Override
        public void stop() {
            if (server != null) {
                server.shutdown();
                try {
                    server.awaitTermination(2, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            data.shutdown();
        }

        @Override
        public boolean isRunning() {
            return server != null && !server.isShutdown();
        }
    }
}
