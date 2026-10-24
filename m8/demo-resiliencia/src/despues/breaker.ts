// DESPUÉS: circuit breaker con opossum 10 alrededor de la llamada a B.
import CircuitBreaker from 'opossum';

// CORRECCIÓN: con B caído, el circuito se abre y A deja de llamarlo: responde en ~1 ms en vez
// de esperar el timeout, y B no recibe tráfico mientras tanto (R5). Pasado `resetTimeout`, deja
// pasar UNA llamada de prueba (semiabierto): si sale bien, cierra; si falla, vuelve a abrir.
export function crearBreaker<A extends unknown[], R>(accion: (...args: A) => Promise<R>, ventanaMs: number, alCambiar: (evento: string) => void) {
  const cb = new CircuitBreaker<A, R>(accion, {
    timeout: false, // el plazo ya lo pone AbortSignal.timeout dentro de llamarB
    errorThresholdPercentage: 50, // abre si falla más del 50 % de las llamadas...
    volumeThreshold: 10, // ...con un mínimo de 10...
    rollingCountTimeout: ventanaMs, // ...en la ventana de los últimos `ventanaMs` ms (10 s por omisión en opossum)
    rollingCountBuckets: 10, // la ventana avanza de a 1/10
    resetTimeout: 2_000, // abierto 2 s antes de probar de nuevo
  });
  for (const ev of ['open', 'halfOpen', 'close']) cb.on(ev, () => alCambiar(ev));
  return cb;
}
