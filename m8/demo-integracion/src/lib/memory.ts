// Memoria del propio proceso: pico de RSS (memoria que el sistema operativo le asignó) y pico del
// heap de JavaScript, muestreados cada 25 ms; el RSS se compara además con el máximo que informa
// el sistema operativo (process.resourceUsage().maxRSS).
export function startMemorySampler() {
  let peakRss = 0, peakHeap = 0;
  const sample = () => {
    const m = process.memoryUsage();
    if (m.rss > peakRss) peakRss = m.rss;
    if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
  };
  sample();
  const t = setInterval(sample, 25);
  t.unref();
  return () => {
    sample();
    clearInterval(t);
    const maxRssOs = process.resourceUsage().maxRSS * 1024;   // KB -> bytes
    return { peakRssMB: Math.round(Math.max(peakRss, maxRssOs) / 2 ** 20), peakHeapMB: Math.round(peakHeap / 2 ** 20) };
  };
}

// Línea final que leen los scripts de medición.
export function printResult(r: object) {
  console.log('RESULT ' + JSON.stringify(r));
}
