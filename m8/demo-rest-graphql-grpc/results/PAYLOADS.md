# Tamano de las respuestas, peticiones y consultas a la base

Bytes de **cuerpo** (sin cabeceras HTTP ni de gRPC). "gzip" es el mismo cuerpo comprimido, para comparar justo con REST/GraphQL comprimidos.

## A. Un estudiante (el cliente solo necesita el nombre)

| Estilo | Peticiones | Bytes | Bytes con gzip | Consultas a la base |
|---|---:|---:|---:|---:|
| REST | 1 | 101 | 106 | 1 |
| GraphQL | 1 | 47 | 64 | 1 |
| gRPC | 1 | 68 | 82 | 1 |

## B. Lista de 2000 estudiantes (id, nombre, correo, carrera)

| Estilo | Peticiones | Bytes | Bytes con gzip | Consultas a la base |
|---|---:|---:|---:|---:|
| REST | 1 | 213,080 | 17,534 | 1 |
| GraphQL | 1 | 213,103 | 17,566 | 1 |
| gRPC | 1 | 146,059 | 17,445 | 1 |

## C. 50 estudiantes con sus cursos

| Estilo | Peticiones | Bytes | Bytes con gzip | Consultas a la base |
|---|---:|---:|---:|---:|
| REST ingenuo (1 lista + 50 llamadas a /courses) | 51 | 16,501 | 5,621 | 51 |
| REST con ?expand=courses | 1 | 17,051 | 1,984 | 2 |
| GraphQL con dataloader | 1 | 17,074 | 2,002 | 2 |
| GraphQL sin dataloader (N+1) | 1 | 17,324 | 2,008 | 51 |
| gRPC | 1 | 10,609 | 1,996 | 2 |

