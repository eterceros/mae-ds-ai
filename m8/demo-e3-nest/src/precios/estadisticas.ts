// Contadores que exponen las dos implementaciones (GET /stats de la API).
// k6 los lee al empezar, en cada cambio de fase y al terminar, para contar las llamadas
// al módulo por fase. No son parte del contrato que usa Pedidos.
export interface Estadisticas {
  modo: 'proceso' | 'http';
  llamadas: number; // llamadas al módulo (en http: intentos que salieron por la red, reintentos incluidos)
  reintentos?: number;
  rechazadasPorBreaker?: number; // con el circuito abierto: no salieron por la red
  aperturasDelBreaker?: number;
  breaker?: 'cerrado' | 'abierto' | 'semiabierto';
}

export interface ConEstadisticas {
  estadisticas(): Estadisticas;
}
