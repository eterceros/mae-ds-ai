// Dos tipos de prueba, a proposito separados:
//  - saturate: bucle cerrado con N trabajadores; mide el MAXIMO de llamadas por segundo (rendimiento).
//  - openLoop: llegadas a ritmo fijo; mide la LATENCIA con la maquina sin saturar. El tiempo se cuenta desde
//    el instante en que la llamada debio salir (no desde que salio), asi una cola no se esconde.
// Con un bucle cerrado de 10 usuarios, p50 ~= 10 / (llamadas por segundo): se mide la cola, no la latencia.

export const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN);

export async function saturate(call, { workers = 10, warmupS = 2, seconds = 4 } = {}) {
  const start = performance.now() + warmupS * 1000;
  const end = start + seconds * 1000;
  let measured = 0;
  let errors = 0;
  const worker = async () => {
    while (performance.now() < end) {
      const began = performance.now();
      try {
        await call();
        if (began >= start) measured += 1;
      } catch {
        if (began >= start) errors += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return { rps: measured / seconds, errors };
}

export function openLoop(call, { rate, warmupS = 2, seconds = 8, maxInflight = 2000 }) {
  return new Promise((resolve) => {
    const interval = 1000 / rate;
    const t0 = performance.now();
    const start = t0 + warmupS * 1000;
    const end = start + seconds * 1000;
    const latencies = [];
    let next = t0;
    let inflight = 0;
    let errors = 0;
    let dropped = 0;
    let launching = true;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      latencies.sort((a, b) => a - b);
      resolve({
        p50: pct(latencies, 0.5),
        p95: pct(latencies, 0.95),
        p99: pct(latencies, 0.99),
        completedPerS: latencies.length / seconds,
        errors,
        dropped,
      });
    };

    const pump = () => {
      const now = performance.now();
      while (next <= now && next < end) {
        const scheduled = next;
        next += interval;
        if (inflight >= maxInflight) {
          if (scheduled >= start) dropped += 1;
          continue;
        }
        inflight += 1;
        call()
          .then(() => {
            if (scheduled >= start) latencies.push(performance.now() - scheduled);
          })
          .catch(() => {
            if (scheduled >= start) errors += 1;
          })
          .finally(() => {
            inflight -= 1;
            if (!launching && inflight === 0) finish();
          });
      }
      if (next >= end) {
        launching = false;
        if (inflight === 0) finish();
        return;
      }
      setImmediate(pump);
    };
    pump();
  });
}
