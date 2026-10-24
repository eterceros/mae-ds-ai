// DESPUÉS: bulkhead (compartimento estanco) como un limitador de concurrencia simple.

/** El limitador está lleno: se rechaza sin esperar. */
export class ErrorLleno extends Error {}

// CORRECCIÓN: como mucho `max` llamadas a la vez a esta dependencia. La que sobra se rechaza
// al instante (no se encola), así una dependencia lenta no acapara las conexiones que comparte
// con otras rutas sanas (R6).
export class LimiteConcurrencia {
  enCurso = 0;
  rechazadas = 0;
  readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async ejecutar<T>(fn: () => Promise<T>): Promise<T> {
    if (this.enCurso >= this.max) {
      this.rechazadas++;
      throw new ErrorLleno(`más de ${this.max} llamadas en curso`);
    }
    this.enCurso++;
    try {
      return await fn();
    } finally {
      this.enCurso--;
    }
  }
}
