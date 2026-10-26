// ANTES — api llama a precios SIN autenticarse. Un servicio interno "de confianza" que, de hecho,
// no comprueba quién llama. Cualquiera que alcance la red interna llama a precios igual que api.
import { PRECIOS_URL } from '../lib/config';

export async function fetchPrecio(item: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${PRECIOS_URL}/precio?item=${encodeURIComponent(item)}`);
  return { status: r.status, body: r.ok ? await r.json() : await r.text() };
}
