package umss.m8.students;

import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.locks.LockSupport;

// Espera de ~1 ms precisa en Windows.
// Medido en esta maquina (JDK 26, 300 esperas de 1 ms): Thread.sleep(1) tarda ~2,0 ms (p50) y hasta 3,3 ms (p99);
// LockSupport.parkNanos(1 ms) ~1,5 ms; un temporizador de alta resolucion de Windows (via FFM) ~1,65 ms.
// Ninguno sirve para una "consulta de 1 ms". Solo esperar activamente da 1,00 ms, pero hacerlo en cada hilo
// gastaria un nucleo por consulta en curso (hasta DB_POOL nucleos).
// Solucion: UN solo hilo temporizador mira la hora mientras haya esperas pendientes (cediendo el nucleo con
// Thread.yield) y despierta a cada hilo cuando le toca; los hilos que esperan estan dormidos (park) sin gastar CPU.
// Sin esperas pendientes, el temporizador duerme. Es lo mismo que hace la version Node con setImmediate.
// Con DB_WAIT=sleep se usa Thread.sleep (impreciso) para comparar.
final class PreciseSleeper {

    private static final class Waiter {
        final long readyAt;
        final Thread thread = Thread.currentThread();
        volatile boolean done;

        Waiter(long readyAt) {
            this.readyAt = readyAt;
        }
    }

    private final boolean plainSleep;
    private final ConcurrentLinkedQueue<Waiter> queue = new ConcurrentLinkedQueue<>();
    private final Thread timer;
    private volatile boolean running = true;

    PreciseSleeper(boolean plainSleep) {
        this.plainSleep = plainSleep;
        this.timer = Thread.ofPlatform().daemon().name("db-timer").start(this::loop);
    }

    void sleep(long nanos) {
        if (plainSleep) {
            try {
                Thread.sleep(nanos / 1_000_000, (int) (nanos % 1_000_000));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return;
        }
        Waiter w = new Waiter(System.nanoTime() + nanos);
        queue.add(w);
        LockSupport.unpark(timer);
        // Todas las esperas duran lo mismo, asi que la cola sale en orden de vencimiento.
        while (!w.done) LockSupport.park(this);
    }

    private void loop() {
        while (running) {
            Waiter head = queue.peek();
            if (head == null) {
                LockSupport.park(this);
                continue;
            }
            long left = head.readyAt - System.nanoTime();
            if (left <= 0) {
                queue.poll();
                head.done = true;
                LockSupport.unpark(head.thread);
            } else if (left > 3_000_000) {
                LockSupport.parkNanos(this, left - 2_000_000); // espera larga (DB_LATENCY_MS alto): dormir casi todo
            } else {
                Thread.yield();
            }
        }
    }

    void close() {
        running = false;
        LockSupport.unpark(timer);
    }
}
