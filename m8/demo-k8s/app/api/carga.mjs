// Generador de carga de los scripts de medición. Corre DENTRO del clúster (como Pod) y llama a la
// api por su Service, como lo haría otro servicio. No es parte de la api.
// Uso: node carga.mjs <url> <requests-per-second> <seconds>
const [url, rps = '10', secs = '60'] = process.argv.slice(2);
const total = Number(rps) * Number(secs);
const t0 = Date.now();
const perSecond = []; // [{ s, ok, fail }]
let ok = 0, fail = 0;
const reasons = {};

async function one(i) {
  const s = Math.floor((Date.now() - t0) / 1000);
  perSecond[s] ??= { s, ok: 0, fail: 0 };
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    await r.arrayBuffer();
    if (r.status === 200) { ok++; perSecond[s].ok++; return; }
    reasons[`http ${r.status}`] = (reasons[`http ${r.status}`] ?? 0) + 1;
  } catch (e) {
    const k = e?.cause?.code ?? e?.name ?? 'error';
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  fail++; perSecond[s].fail++;
}

const pending = [];
for (let i = 0; i < total; i++) {
  const due = t0 + (i * 1000) / Number(rps);
  const wait = due - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  pending.push(one(i));
}
await Promise.all(pending);
for (const p of perSecond) if (p) console.log('SEC ' + JSON.stringify(p));
console.log('RESULT ' + JSON.stringify({ url, total, ok, fail, reasons }));
