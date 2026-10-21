# Costo de serializar y decodificar (solo CPU de Node)

Milisegundos por operacion, promedio de 300 repeticiones tras calentar.

| Respuesta | JSON.stringify | protobuf codificar | JSON.parse | protobuf decodificar |
|---|---:|---:|---:|---:|
| 50 estudiantes | 0.007 | 0.027 | 0.010 | 0.019 |
| 2000 estudiantes | 0.295 | 0.847 | 0.354 | 0.455 |

