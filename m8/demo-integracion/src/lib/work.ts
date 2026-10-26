// El trabajo lento que dispara un webhook de pago: avisar al ERP, mandar el correo de confirmación...
// Se simula con una espera uniforme entre WORK_MIN_MS y WORK_MAX_MS (por defecto 200-3000 ms).
// Es el mismo en src/antes/ y src/despues/: lo que cambia es DÓNDE se hace, no cuánto tarda.
import { sleep } from './config.ts';

const MIN = Number(process.env.WORK_MIN_MS ?? 200);
const MAX = Number(process.env.WORK_MAX_MS ?? 3000);

export async function slowSideEffects(_eventId: string) {
  await sleep(MIN + Math.random() * (MAX - MIN));
}
