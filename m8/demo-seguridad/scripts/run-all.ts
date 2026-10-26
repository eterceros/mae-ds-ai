// Corre los cinco escenarios en orden y deja los resultados en results/. Requiere que Keycloak esté
// arriba (docker compose up -d --wait) y la API compilada (npm run build).
import { spawnSync } from 'node:child_process';

const scripts = ['sa-bola', 'sb-tokens', 'sr-refresh', 'sc-ratelimit', 'sd-ssrf', 'se-servicios'];
for (const s of scripts) {
  console.log(`\n===== ${s} =====`);
  const r = spawnSync(process.execPath, ['--no-warnings', `scripts/${s}.ts`], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) { console.error(`falló ${s}`); process.exit(r.status ?? 1); }
}
console.log('\nListo. Revisa results/.');
