# Fase 1: fundación y primer endpoint

## Propósito

La primera fase prueba el proceso HTTP completo sin Supabase, PostgreSQL ni
JWT. Aislar esas dependencias permite aprender fundamentos de Go y detectar
errores de servidor antes de sumar red y persistencia.

El primer endpoint será `GET /healthz`, no un recurso financiero.

## Qué se configura primero

Orden recomendado:

1. Confirmar versión de Go con `go version`.
2. Definir nombre definitivo del módulo Go.
3. Vaciar o reemplazar explícitamente el experimento actual de `backend/`.
4. Inicializar `go.mod`.
5. Agregar únicamente `chi/v5`.
6. Crear router, handler de salud y `main`.
7. Escribir prueba HTTP con `httptest`.
8. Agregar timeouts y apagado ordenado.
9. Activar gate `backend-quality` ya definido en Fase 0.
10. Verificar localmente y en CI.

La DB se configura en Fase 2. Auth se configura en Fase 3.

## Decisión pendiente antes de escribir Go

`go.mod` necesita un module path estable. Si habrá repositorio remoto, debe
usarse su ruta, por ejemplo:

```txt
github.com/<owner>/budg/backend
```

Si todavía no existe remoto, puede usarse temporalmente `budg/backend`, pero
cambiarlo después modifica todos los imports internos. Conviene decidirlo al
inicio de Fase 1.

## Dependencia inicial

Solo router:

```txt
github.com/go-chi/chi/v5
```

`chi` implementa `http.Handler`. No reemplaza servidor, request, response,
contexto ni middleware de la biblioteca estándar.

## Árbol de Fase 1

```txt
backend/
  cmd/api/main.go
  internal/httpapi/router.go
  internal/httpapi/router_test.go
  internal/httpapi/health.go
  go.mod
  go.sum
```

No se crean todavía `auth`, `store`, migraciones ni Dockerfile.

## Responsabilidad de cada archivo

### `cmd/api/main.go`

- Lee configuración mínima.
- Construye router.
- Configura `http.Server`.
- Arranca proceso.
- Escucha señales de cierre.
- Ejecuta `Shutdown` con timeout.

No contiene handlers ni reglas financieras.

### `internal/httpapi/router.go`

- Construye `chi.Router`.
- Registra middleware.
- Conecta método y path con handler.
- Devuelve `http.Handler` para servidor y pruebas.

### `internal/httpapi/health.go`

- Responde estado del proceso.
- No consulta DB.
- No requiere auth.
- No revela versión, secretos ni configuración interna.

### `internal/httpapi/router_test.go`

- Crea router en memoria.
- Envía request con `httptest`.
- Comprueba status, content type y JSON.
- No abre puerto real.

## Primer contrato HTTP

Request:

```http
GET /healthz HTTP/1.1
Accept: application/json
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

`/healthz` indica que proceso puede responder HTTP. No garantiza acceso a DB.
Esa diferencia es intencional:

- `GET /healthz`: liveness, sin dependencias.
- `GET /readyz`: readiness de DB, agregado en Fase 2.

## Flujo que debe poder explicarse

```txt
socket HTTP
  -> http.Server
  -> chi.Router
  -> middleware
  -> health handler
  -> http.ResponseWriter
  -> JSON al cliente
```

Conceptos Go de esta fase:

- `package` e `import`.
- `func`.
- structs y valores cero.
- interfaces `http.Handler` y `http.ResponseWriter`.
- punteros usados por `http.Request` y `http.Server`.
- manejo explícito de `error`.
- `context.Context` para cancelación.
- canales y señales solo para shutdown.
- `defer` para liberar recursos temporales.

## Configuración mínima

Variables planeadas:

| Variable | Requerida | Default local | Uso |
| --- | --- | --- | --- |
| `PORT` | No | `8080` | Puerto HTTP; Cloud Run la provee |
| `APP_ENV` | No | `development` | Ajusta política operativa, no lógica de negocio |
| `LOG_LEVEL` | No | `info` | Nivel de logs |

No se agrega librería `.env` inicialmente. Shell o herramienta de ejecución
carga variables. `.env.example` documentará nombres cuando aparezcan secretos.

## Timeouts iniciales

`http.Server` debe declarar al menos:

- `ReadHeaderTimeout`: limita clientes lentos al enviar headers.
- `ReadTimeout`: limita lectura total cuando aplique.
- `WriteTimeout`: evita responses bloqueadas indefinidamente.
- `IdleTimeout`: limita conexiones keep-alive ociosas.

Valores exactos se eligen al implementar y se justifican en documento de fase.
No deben copiarse sin entender interacción con timeout de Cloud Run.

## Middleware inicial

Orden sugerido:

1. Request ID.
2. IP real solo si proxy confiable está definido.
3. Recovery ante `panic`.
4. Timeout de request.
5. Logging de método, path, status y duración.

Puede usarse middleware de `chi` cuando comportamiento sea suficiente. CORS y
auth llegan más tarde para mantener primera fase pequeña.

## Pruebas mínimas

| Caso | Resultado |
| --- | --- |
| `GET /healthz` | `200`, JSON y `status=ok` |
| Método no permitido | `405` |
| Ruta inexistente | `404` |
| Handler produce JSON | `Content-Type: application/json` |

No se prueba implementación interna; se prueba comportamiento observable.

## Verificación planeada

Desde `backend/`:

```bash
gofmt -w .
go mod verify
go test ./...
go test -race ./...
go vet ./...
go build ./cmd/api
go run ./cmd/api
```

Desde raíz, `make check-backend` ejecuta mismos gates usados por CI.

En otra terminal:

```bash
curl -i http://localhost:8080/healthz
```

## Qué no entra en Fase 1

- Supabase.
- PostgreSQL.
- JWT.
- CORS.
- Endpoints `/v1`.
- Docker.
- ORM.
- Framework de configuración.
- Helpers genéricos anticipados.

## Criterio de salida

- Cada línea Go puede explicarse.
- Proceso arranca y cierra limpiamente.
- Pruebas no necesitan red externa.
- `go test -race` y `go vet` pasan.
- `go mod verify`, build y job `backend-quality` pasan.
- Endpoint real responde contrato documentado.
- No existe código muerto preparado para fases futuras.
