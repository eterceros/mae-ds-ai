// DESPUES — defensa contra SSRF (OWASP API7:2023).
// Antes de descargar una URL dada por el usuario: (1) solo http/https; (2) se resuelve el host a sus
// direcciones IP y se rechaza si alguna es de loopback, "esta red" (0.0.0.0/8 y ::), privada, CGNAT,
// enlace-local (incluida la de metadatos 169.254.169.254), única-local IPv6 o reservada. Resolver y comprobar la IP cierra el truco de un
// nombre de dominio que apunta a 127.0.0.1 o a 169.254.169.254.
import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';

const blocked = new BlockList();
blocked.addSubnet('127.0.0.0', 8, 'ipv4');       // loopback
// CORRECCIÓN: 0.0.0.0/8 ("esta red"). En Linux y macOS, conectar a 0.0.0.0 llega al servicio que
// escucha en 127.0.0.1; sin esta regla, http://0.0.0.0:18630/ (o http://0/) salta la lista.
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');        // privada
blocked.addSubnet('172.16.0.0', 12, 'ipv4');     // privada
blocked.addSubnet('192.168.0.0', 16, 'ipv4');    // privada
blocked.addSubnet('169.254.0.0', 16, 'ipv4');    // enlace-local (metadatos de la nube)
blocked.addSubnet('100.64.0.0', 10, 'ipv4');     // CGNAT (espacio compartido, RFC 6598)
// CORRECCIÓN: otros rangos IPv4 reservados que nunca son un destino público legítimo.
blocked.addSubnet('192.0.0.0', 24, 'ipv4');      // asignaciones del protocolo IETF
blocked.addSubnet('198.18.0.0', 15, 'ipv4');     // pruebas de rendimiento de red
blocked.addSubnet('224.0.0.0', 4, 'ipv4');       // multicast
blocked.addSubnet('240.0.0.0', 4, 'ipv4');       // reservada, incluye 255.255.255.255 (difusión)
blocked.addAddress('::1', 'ipv6');               // loopback IPv6
// CORRECCIÓN: '::' (no especificada) es el 0.0.0.0 de IPv6: en Linux y macOS llega a la máquina local.
blocked.addAddress('::', 'ipv6');
// Las IPv4 escritas como IPv6 (::ffff:127.0.0.1 = ::ffff:7f00:1) ya caen: BlockList las compara contra
// las reglas IPv4 de arriba. CORRECCIÓN: NAT64 (64:ff9b::/96) envuelve una IPv4 que la pasarela
// traduce; se bloquea entera para no tener que desempaquetarla.
blocked.addSubnet('64:ff9b::', 96, 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');          // única-local IPv6
blocked.addSubnet('fe80::', 10, 'ipv6');         // enlace-local IPv6

export class BlockedUrlError extends Error {}

export async function assertSafeUrl(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new BlockedUrlError('URL mal formada'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedUrlError(`esquema no permitido: ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  for (const ip of addrs) {
    const fam = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (blocked.check(ip, fam)) throw new BlockedUrlError(`destino interno bloqueado: ${host} -> ${ip}`);
  }
}
