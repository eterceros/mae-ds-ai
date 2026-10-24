// Lector minimo de archivos tar (formato ustar), suficiente para recorrer lo
// que produce "docker save" y las capas que contiene. Solo stdlib.
import { gunzipSync } from 'node:zlib';

export function* entradas(buf) {
  let off = 0;
  let nombreLargo = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    let nombre = str(0, 100);
    const prefijo = str(345, 500);
    if (prefijo) nombre = `${prefijo}/${nombre}`;
    const tam = parseInt(str(124, 136).trim() || '0', 8);
    const tipo = String.fromCharCode(h[156] || 48);
    const datos = buf.subarray(off + 512, off + 512 + tam);
    off += 512 + Math.ceil(tam / 512) * 512;
    if (tipo === 'L') { nombreLargo = datos.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (tipo === 'x' || tipo === 'g') {
      const m = datos.toString('utf8').match(/\d+ path=([^\n]*)\n/);
      if (m) nombreLargo = m[1];
      continue;
    }
    if (nombreLargo) { nombre = nombreLargo; nombreLargo = null; }
    yield { nombre, tipo, datos };
  }
}

// Si el blob es un tar (comprimido con gzip o no), lo devuelve descomprimido; si no, null.
export function comoTar(datos) {
  let b = datos;
  if (b[0] === 0x1f && b[1] === 0x8b) {
    try { b = gunzipSync(b); } catch { return null; }
  }
  return b.length >= 512 && b.subarray(257, 262).toString() === 'ustar' ? b : null;
}
