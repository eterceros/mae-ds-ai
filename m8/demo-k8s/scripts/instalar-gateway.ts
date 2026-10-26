// Script del docente: deja preinstalado un controlador de Gateway API en el clúster kind para que en
// clase solo haya que escribir un Gateway y una HTTPRoute (despues/ruta.yaml o k8s/gateway.yaml del
// laboratorio). Cómo funciona el controlador NO es parte de la sesión.
//
// Controlador: Envoy Gateway v1.9.2. Su install.yaml trae los CRD de Gateway API y el controlador
// (sin Helm). Después se crea una GatewayClass llamada "eg".
// Uso: node --no-warnings scripts/instalar-gateway.ts
import { kubectl } from './lib/k8s.ts';

const VERSION = 'v1.9.2';
const URL = `https://github.com/envoyproxy/gateway/releases/download/${VERSION}/install.yaml`;

console.log(`Installing Envoy Gateway ${VERSION} (Gateway API CRDs + controller)...`);
// --server-side: los CRD son demasiado grandes para la anotación que escribe el apply del cliente.
kubectl(['apply', '--server-side', '--force-conflicts', '-f', URL]);
kubectl(['-n', 'envoy-gateway-system', 'wait', '--for=condition=Available', 'deployment/envoy-gateway', '--timeout=300s']);

kubectl(['apply', '-f', '-'], {
  input: `apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eg
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
`,
});
kubectl(['wait', '--for=condition=Accepted', 'gatewayclass/eg', '--timeout=120s']);
console.log('GatewayClass "eg" accepted. Demo: kubectl apply -f despues/ruta.yaml · Laboratorio: kubectl apply -f k8s/gateway.yaml');
