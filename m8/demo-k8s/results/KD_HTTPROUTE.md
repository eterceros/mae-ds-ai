# KD · HTTPRoute con un controlador preinstalado

Medido el 2026-10-26 09:44 UTC · 12th Gen Intel(R) Core(TM) i9-12900H (20 hilos), 64 GB · Windows_NT 10.0.26200 · Node v24.19.0 · kubectl v1.36.1 · Kubernetes v1.37.0 (kind, contexto kind-s11-demo)

Controlador: Envoy Gateway v1.9.2, instalado antes por `scripts/instalar-gateway.ts` (no se explica en clase). Rutas: [`despues/ruta.yaml`](../despues/ruta.yaml). Script: `node --no-warnings scripts/kd-ruta.ts`. kind no tiene balanceador: al Service del Gateway (`envoy-s11-demo-f00b91ca`, tipo LoadBalancer) se llega con `kubectl port-forward` en `127.0.0.1:18520`.

- HTTPRoute `api`: Accepted=True, ResolvedRefs=True (en 0,3 s)
- Gateway `demo`: Accepted=True (Accepted), Programmed=False (AddressNotAssigned). En kind es lo esperado: no hay balanceador que le dé una dirección externa, y aun así enruta (tabla de abajo).

| Petición | Se espera | Respuestas | Pods distintos que respondieron | Muestra |
|---|---|---|---|---|
| `GET /cotizacion?producto=p2` × 100 | api (que llama a precios) | 200: 100 | 2 | `{"producto":"p2","precio":85,"moneda":"BOB","pod":"api-5b65bd6f8-vtxr9"}` |
| `GET /precios/p3` × 100 | precios | 200: 100 | — | `{"producto":"p3","precio":42}` |
| `GET /salud/vivo` × 20 | sin ruta: 404 del Gateway | 404: 20 | — | `` |
| `GET /otra-cosa` × 20 | sin ruta: 404 del Gateway | 404: 20 | — | `` |

Solo se verificó que enruta. No se midió latencia ni nada del controlador.
