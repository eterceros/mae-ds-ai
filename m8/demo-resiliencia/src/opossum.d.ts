// Tipos mínimos de opossum 10 (el paquete no trae los suyos; @types/opossum describe la v8).
declare module 'opossum' {
  import { EventEmitter } from 'node:events';
  export default class CircuitBreaker<A extends unknown[] = unknown[], R = unknown> extends EventEmitter {
    constructor(accion: (...args: A) => Promise<R>, opciones?: Record<string, unknown>);
    fire(...args: A): Promise<R>;
    shutdown(): void;
    readonly opened: boolean;
    readonly halfOpen: boolean;
    readonly stats: Record<string, number>;
  }
}
