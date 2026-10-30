// Circuit breaker con opossum 10, con el mismo patrón que demo-resiliencia/src/despues/breaker.ts.
import CircuitBreaker from 'opossum';

// Con el módulo caído o colgado, el circuito se abre y la API deja de llamarlo: responde en
// ~1 ms en vez de esperar el plazo, y el módulo no recibe tráfico mientras tanto (R5 de la demo).
// Pasado `resetTimeout`, deja pasar UNA llamada de prueba (semiabierto): si sale bien, cierra;
// si falla, vuelve a abrir.
export function crearBreaker<A extends unknown[], R>(
  accion: (...args: A) => Promise<R>,
  o: { ventanaMs: number; resetMs: number; noEsFalla: (err: unknown) => boolean },
) {
  return new CircuitBreaker<A, R>(accion, {
    timeout: false, // el plazo ya lo pone AbortSignal dentro de la acción
    errorThresholdPercentage: 50, // abre si falla más del 50 % de las llamadas...
    volumeThreshold: 10, // ...con un mínimo de 10...
    rollingCountTimeout: o.ventanaMs, // ...en la ventana de los últimos `ventanaMs` ms
    rollingCountBuckets: 10, // la ventana avanza de a 1/10
    resetTimeout: o.resetMs, // tiempo abierto antes de la llamada de prueba
    errorFilter: o.noEsFalla, // true = este error NO cuenta como falla (p. ej. un 404)
  });
}
