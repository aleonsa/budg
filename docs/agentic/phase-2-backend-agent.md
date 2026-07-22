# Fase 2: Backend Agentic con OpenAI

## Objetivo

Construir un harness pequeño y determinista que convierta mensajes financieros
en respuestas estructuradas o llamadas a tools seguras. OpenAI es el único
proveedor inicial. El harness controla límites, validación, autorización,
idempotencia y observabilidad; el modelo nunca controla esas políticas.

## Alcance inicial

Incluye:

- SDK oficial `github.com/openai/openai-go/v3`.
- Responses API con tool calling y structured outputs estrictos.
- Endpoint autenticado `POST /v1/agent/chat` con streaming SSE.
- Contexto de ruta y entidad visible proporcionado por frontend.
- Tools de lectura y movimientos financieros.
- Confirmación explícita para operaciones mutables durante el MVP.
- Evals deterministas contra datos sintéticos de development.

No incluye todavía:

- Segundo proveedor o routing entre modelos.
- MCP.
- RAG o embeddings.
- Imágenes, OCR o documentos.
- Persistencia de conversaciones.
- Notificaciones push.

## Dependencias

Se adopta SDK oficial OpenAI como transporte. No se adopta framework agentic.
El loop, policy engine y tool registry pertenecen a Budg porque son pequeños y
contienen reglas financieras propias.

Variables:

```dotenv
OPENAI_API_KEY=
AGENT_MODEL=gpt-5.4-nano
AGENT_MAX_STEPS=6
AGENT_MAX_TOOL_CALLS=8
AGENT_TIMEOUT_SECONDS=30
AGENT_MAX_OUTPUT_TOKENS=1200
```

`AGENT_MODEL` es configuración, no constante. Antes de habilitar un modelo se
verifica que soporte Responses API, strict tool schemas y structured output.
Si `gpt-5.4-nano` no cumple una capacidad requerida en la cuenta disponible, se
elige el modelo pequeño más nuevo que sí la cumpla, sin cambiar código.

## Paquetes previstos

```text
backend/internal/agent/
  provider.go       interfaz mínima de transporte
  openai.go         adapter del SDK oficial
  loop.go           máquina de estados y límites
  tools.go          registry y dispatch
  schemas.go        contratos estrictos
  policy.go         confirmaciones y permisos
  events.go         eventos SSE normalizados
  prompt.go         prompt versionado
```

No se crean interfaces por cada tipo. La abstracción de proveedor debe cubrir
solo la llamada necesaria por el loop actual. No se implementan adapters vacíos
para proveedores futuros.

## Máquina de estados

```text
received
  -> model_call
  -> validate_output
  -> tool_dispatch | confirmation_required | completed
  -> append_tool_result
  -> model_call
```

Estados terminales:

- `completed`
- `needs_input`
- `confirmation_required`
- `refused`
- `limit_reached`
- `failed`

El loop nunca depende de que el modelo decida detenerse correctamente.

## Límites anti-loop

| Límite | Valor inicial | Comportamiento |
| --- | ---: | --- |
| Deadline total | 30 segundos | Cancela proveedor y tools |
| Pasos de modelo | 6 | Termina con `limit_reached` |
| Tool calls totales | 8 | Termina con `limit_reached` |
| Tool call idéntica | 1 | Hash repetido detiene loop |
| Reparaciones de schema | 2 | Después falla de forma segura |
| Output del modelo | 1,200 tokens | Configurado en request |
| Tool result | 16 KiB | Trunca campos no esenciales |
| Tools mutables concurrentes | 1 | Ejecución serial |

El router actual tiene timeout global de 15 segundos. Antes de añadir el
endpoint agentic se deben aplicar timeouts por grupo: 15 segundos para API
normal y 30 segundos para agente. No se aumenta silenciosamente el timeout de
todas las rutas.

## Structured output

### Respuesta final

Toda respuesta final cumple este contrato:

```json
{
  "status": "completed",
  "message": "Registré el gasto.",
  "summary": "Gasto de MXN 100.00 en Tarjeta Banamex.",
  "artifacts": [
    {
      "type": "transaction",
      "id": "uuid"
    }
  ]
}
```

`status` permite `completed`, `needs_input`, `confirmation_required` y
`refused`. `additionalProperties` es `false` en todos los schemas.

### Tool input

Cada tool usa un struct Go dedicado y schema estricto. Ejemplo conceptual:

```go
type CreateTransactionInput struct {
    Type        string `json:"type"`
    AmountCents int64  `json:"amountCents"`
    AccountID   string `json:"accountId"`
    CategoryID  string `json:"categoryId"`
    Date        string `json:"date"`
    Description string `json:"description"`
    Merchant    string `json:"merchant,omitempty"`
}
```

El backend vuelve a decodificar con `json.Decoder.DisallowUnknownFields()` y
ejecuta validaciones de dominio. El schema del proveedor no sustituye la
validación local.

### Tool result

Todas las tools regresan el mismo envelope:

```json
{
  "status": "success",
  "summary": "1 movimiento encontrado",
  "data": {},
  "retryable": false,
  "nextActions": []
}
```

Errores internos, SQL y secretos nunca llegan al modelo.

## Tools iniciales

### Lectura

| Tool | Propósito |
| --- | --- |
| `list_accounts` | Resolver cuentas activas y saldos |
| `list_categories` | Resolver categorías por tipo y nombre |
| `search_transactions` | Buscar por periodo, cuenta, categoría, texto y monto |
| `get_financial_summary` | Resumen de ingresos, gastos, deuda y presupuestos |

### Mutación

| Tool | Propósito |
| --- | --- |
| `create_transaction` | Crear gasto, ingreso o transferencia |
| `update_transaction` | Corregir campos de un movimiento |
| `delete_transaction` | Eliminar un movimiento |

Las tools llaman servicios/repositorios Go directamente. No hacen HTTP contra
el mismo backend. El `user_id` siempre viene del JWT y nunca de argumentos del
modelo.

## Política de mutaciones

Durante el MVP, toda mutación requiere confirmación explícita antes de
ejecutarse. El primer tool call produce una propuesta normalizada y un token de
confirmación de vida corta. Un segundo request con ese token ejecuta exactamente
la operación propuesta.

Reglas:

- Token ligado a usuario, tool, argumentos y expiración.
- Cambio de argumentos invalida el token.
- `create_transaction` usa `idempotency_key` estable por confirmación.
- Update y delete verifican que el recurso siga en el estado esperado.
- Nunca se reintenta automáticamente una mutación después de enviar SQL.
- Operaciones ambiguas regresan `needs_input`, no eligen silenciosamente.

La confirmación puede relajarse más adelante para acciones explícitas y de bajo
riesgo, pero no forma parte de Fase 2.

## Request HTTP

```json
{
  "message": "Registra un gasto de 100 en Banamex; fui a un restaurante.",
  "conversation": [],
  "viewContext": {
    "route": "/accounts/uuid",
    "entityType": "account",
    "entityId": "uuid",
    "periodStart": "2026-07-01",
    "periodEnd": "2026-07-31"
  },
  "confirmationToken": null
}
```

El backend limita cantidad y longitud de mensajes. `viewContext` es una pista,
no autoridad: todo ID se valida de nuevo bajo scope del usuario.

## Eventos SSE

```text
response.started
response.delta
tool.started
tool.completed
confirmation.required
response.completed
error
```

Cada evento tiene `runId`, `sequence`, `type` y `data`. El frontend puede
reconstruir orden sin depender de eventos nativos de OpenAI.

## Retries y recuperación

- Se reintenta `429`, timeout de conexión y `5xx` antes de ejecutar una tool.
- Máximo dos retries con backoff y jitter dentro del deadline total.
- `4xx` de schema/configuración no se reintenta.
- Tool read-only puede reintentarse una vez si declara `retryable: true`.
- Tool mutable nunca se reintenta automáticamente.
- Cancelación del cliente cancela stream, request del proveedor y queries.

## Observabilidad y privacidad

Logs estructurados mínimos:

- `run_id`
- usuario pseudonimizado
- modelo
- latencia
- input/output tokens
- pasos
- tools invocadas
- stop reason
- código de error seguro

No se registran prompts completos, imágenes, descripciones financieras, tokens,
outputs crudos ni argumentos completos de tools.

## Evals de aceptación

Casos mínimos contra development:

1. Consultar gasto de transporte del mes.
2. Resolver `Banamex` a una sola cuenta.
3. Proponer gasto de MXN 100.00 en restaurante.
4. Pedir aclaración ante dos cuentas ambiguas.
5. Rechazar monto cero, negativo o flotante.
6. Confirmar creación exactamente una vez.
7. Repetir confirmación sin duplicar movimiento.
8. Proponer corrección del último movimiento.
9. Exigir confirmación para update y delete.
10. Detener tool call repetida.
11. Detener loop al llegar al límite.
12. No acceder a recursos de otro usuario.
13. No ejecutar tool si structured output es inválido.
14. Cancelar toda ejecución al expirar deadline.

Métricas iniciales:

- 100% outputs válidos o error controlado.
- 100% mutaciones confirmadas e idempotentes.
- 0 acceso cross-user.
- 0 loops fuera de límites.
- Tool y argumentos correctos en al menos 95% de casos dorados.

## Orden de implementación

1. Añadir configuración y SDK oficial OpenAI. Hecho.
2. Definir schemas, eventos, límites y provider interface. Hecho.
3. Implementar adapter OpenAI y fake provider para tests. Hecho.
4. Implementar loop acotado con registry de tools read-only. Hecho.
5. Conectar tools read-only a las stores (accounts, categories, transactions, summary). Hecho.
6. Crear evals deterministas y pasar quality gates. Hecho para el alcance
   read-only; evals de mutaciones se añaden junto con esas tools en el paso 7.
7. Añadir propuestas y confirmación de mutaciones.
8. Exponer endpoint SSE autenticado.
9. Ejecutar smoke test contra OpenAI con modelo configurado.

Cada paso debe mantener `go test ./...` y `go vet ./...` verdes.

## Estado de implementación

Completado en `backend/internal/agent`:

- `contracts.go`: contratos estrictos, validación de schema `additionalProperties:false`,
  `DecodeStrict` que rechaza campos desconocidos y JSON múltiple, y `Provider`.
- `openai.go`: adapter real sobre Responses API con structured output, tools
  estrictas, streaming de deltas y normalización de tool calls y usage.
- `tools.go`: `ToolRegistry` que rechaza nombres duplicados y schemas no estrictos.
- `loop.go`: `Runner` con límites duros de pasos y tool calls, detección de tool
  call duplicada por hash, reparación de output inválido acotada, y estados
  terminales `completed`, `limit_reached`, `failed`.

- `tools_read.go`: tools read-only (`list_accounts`, `list_categories`,
  `search_transactions`, `get_financial_summary`) sobre una interfaz `ReadStore`
  angosta, con schemas de input estrictos, `user_id` capturado del JWT en
  closures, y errores de store convertidos en resultados seguros retryables.
- `prompt.go`: system prompt versionado e invariante más bloque opcional de
  `ViewContext` (solo pista, no autoridad).
- `service.go`: `Service` que arma un runner user-scoped por request.
- `eval_test.go`: 10 evals deterministas de aceptación contra `Service`
  (el mismo punto de entrada que usará el endpoint HTTP), con proveedor
  guionado y store falso. Cubren: responder con datos reales de una consulta
  por categoría/periodo, resolver un nombre parcial de cuenta a una sola
  coincidencia, pedir aclaración ante cuentas ambiguas (`needs_input`),
  detener tool call duplicada, detener el loop al límite de pasos, rechazar
  que el modelo suplante la identidad del usuario vía argumentos de tool,
  recuperarse de argumentos de tool inválidos sin ejecutar la tool ni
  detener la conversación, fallar cerrado ante un nombre de tool desconocido,
  cancelar la ejecución al expirar el deadline, y fallar cerrado ante output
  final persistentemente inválido. No cubren los escenarios de mutación del
  spec (creación/edición/borrado con confirmación): esas tools no existen
  todavía y sus evals se añaden junto con ellas en el paso 7. No reemplazan
  el smoke test manual contra el modelo real del paso 9: aquí el "modelo" es
  guionado, así que validan el harness, no el juicio del LLM.

Pendiente inmediato: endpoint SSE autenticado con grupo de timeout de 30s.
