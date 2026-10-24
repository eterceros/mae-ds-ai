// Token de inyeccion del pool de Postgres (en su propio archivo para evitar
// una importacion circular entre el modulo y el controlador).
export const POOL = Symbol('POOL');
