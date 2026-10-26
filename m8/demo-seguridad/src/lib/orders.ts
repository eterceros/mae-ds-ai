// Datos de pedidos en memoria. Bob tiene 5 pedidos; Alice, 2. El escenario SA (BOLA) mide
// cuántos pedidos de Bob puede leer o modificar Alice. "owner" es el "sub" del dueño (el id del
// usuario en Keycloak, fijo en el realm importado); en un sistema real sería una columna con ese id.
// No se guarda el nombre de usuario: preferred_username no es único ni estable (OIDC Core §5.7).
import { USERS } from './config';

export type Order = { id: string; owner: string; item: string; amountCents: number };

const ALICE = USERS.alice.sub;
const BOB = USERS.bob.sub;

const SEED: Order[] = [
  { id: 'ord-a-1', owner: ALICE, item: 'Teclado mecánico', amountCents: 12000 },
  { id: 'ord-a-2', owner: ALICE, item: 'Ratón', amountCents: 4500 },
  { id: 'ord-b-1', owner: BOB, item: 'Monitor 27"', amountCents: 89000 },
  { id: 'ord-b-2', owner: BOB, item: 'Webcam', amountCents: 23000 },
  { id: 'ord-b-3', owner: BOB, item: 'Auriculares', amountCents: 15000 },
  { id: 'ord-b-4', owner: BOB, item: 'Dock USB-C', amountCents: 32000 },
  { id: 'ord-b-5', owner: BOB, item: 'SSD 2 TB', amountCents: 41000 },
];

export class OrderStore {
  private map = new Map<string, Order>();
  constructor() { for (const o of SEED) this.map.set(o.id, { ...o }); }
  get(id: string): Order | undefined { return this.map.get(id); }
  setItem(id: string, item: string): Order | undefined {
    const o = this.map.get(id);
    if (o) o.item = item;
    return o;
  }
  idsOwnedBy(sub: string): string[] {
    return [...this.map.values()].filter((o) => o.owner === sub).map((o) => o.id);
  }
}

export const store = new OrderStore();
