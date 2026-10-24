// Código compartido por antes/ y despues/. GET mínimo con node:http. Usamos node:http (y no fetch) por dos razones de la demo:
//  1) controlar el pool de conexiones salientes (R6 comparte un pool de 20 conexiones), y
//  2) abrir una conexión TCP por llamada (keepAlive: false): Toxiproxy decide la falla
//     por conexión, así que una conexión nueva por llamada = una falla decidida por llamada.
// fetch acepta el mismo `signal`, así que el timeout se escribe igual con fetch.
import http from 'node:http';

export interface Respuesta {
  status: number;
  body: string;
}

export function get(url: string, agent: http.Agent, signal?: AbortSignal, headers?: Record<string, string>): Promise<Respuesta> {
  return new Promise((resolve, reject) => {
    // `signal` cubre TODO: esperar un socket libre del pool, conectar, enviar y leer la respuesta.
    const req = http.get(url, { agent, signal, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (trozo: string) => (body += trozo));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    // Detalle de node:http medido en R6: si la petición espera un socket libre del pool y la
    // señal se aborta, el error recién se emite cuando el pool le asigna un socket (pueden ser
    // segundos). Por eso rechazamos nosotros apenas se aborta la señal: el plazo es de verdad total.
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** B respondió, pero con un 5xx. */
export class ErrorDeB extends Error {
  status: number;
  constructor(status: number) {
    super(`B respondió ${status}`);
    this.status = status;
  }
}
