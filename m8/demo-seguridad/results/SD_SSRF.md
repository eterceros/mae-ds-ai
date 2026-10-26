# SD — SSRF (descargar una URL del usuario)

Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Keycloak 26.8.1 (start-dev), realm importado. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0). Emisor: http://127.0.0.1:18600/realms/demo. API, precios, servicio interno y scripts en el anfitrión.

La API recibe `POST /fetch {url}` y descarga esa URL. Solo hay un servicio interno real escuchando (127.0.0.1:18630, solo IPv4), que devuelve un "secreto". Cinco destinos apuntan a ese servicio escrito de cinco maneras (IP de loopback, `localhost`, `0.0.0.0`, `[::]` y la IPv4 mapeada `[::ffff:127.0.0.1]`); los demás destinos internos no tienen servidor vivo, así que miden si la API **intenta** alcanzarlos (antes) o los **bloquea antes de pedir** (despues). Qué formas llegan de verdad depende del sistema operativo y de la familia en la que escucha el servicio (aquí, solo IPv4); la tabla de antes muestra lo que pasó en esta máquina (`win32`).

## antes (descarga cualquier URL)

| Destino | Clase | Resultado |
|---|---|---|
| servicio interno simulado (IP loopback) | interno | **secreto filtrado** |
| servicio interno (nombre localhost) | interno | **secreto filtrado** |
| servicio interno (0.0.0.0) | interno | **secreto filtrado** |
| servicio interno (IPv6 no especificada [::]) | interno | no alcanzado |
| servicio interno (IPv4 mapeada [::ffff:127.0.0.1]) | interno | **secreto filtrado** |
| metadatos de la nube | interno | no alcanzado |
| IP privada | interno | no alcanzado |
| esquema file:// | interno | no alcanzado |
| destino público (IP literal) | público | no alcanzado |

- Secreto interno filtrado: **4** destino(s). Bloqueados antes de pedir: **0** de 8.

## despues (valida esquema y destino)

| Destino | Clase | Resultado |
|---|---|---|
| servicio interno simulado (IP loopback) | interno | bloqueado (400) |
| servicio interno (nombre localhost) | interno | bloqueado (400) |
| servicio interno (0.0.0.0) | interno | bloqueado (400) |
| servicio interno (IPv6 no especificada [::]) | interno | bloqueado (400) |
| servicio interno (IPv4 mapeada [::ffff:127.0.0.1]) | interno | bloqueado (400) |
| metadatos de la nube | interno | bloqueado (400) |
| IP privada | interno | bloqueado (400) |
| esquema file:// | interno | bloqueado (400) |
| destino público (IP literal) | público | no alcanzado |

- Secreto interno filtrado: **0**. Destinos internos bloqueados antes de pedir: **8** de 8. El destino público **no** se bloquea (pasa la validación; aquí no se alcanza porque la demo no tiene salida a internet): la defensa bloquea lo interno, no todo.

Corrección en `src/despues/orders.controller.ts` (`fetch`) + `src/despues/safe-url.ts`: solo `http`/`https`, se resuelve el host a IP y se rechaza loopback, «esta red» (`0.0.0.0/8` y `::`), privadas, CGNAT, enlace-local (metadatos 169.254.169.254), única-local IPv6, NAT64 y rangos reservados. Las IPv4 mapeadas (`::ffff:a.b.c.d`) caen por las reglas IPv4.
