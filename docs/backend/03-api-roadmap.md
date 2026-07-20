# Contrato HTTP y fases de API

## Objetivo

Implementar API en cortes pequeños compatibles con
`frontend/src/lib/api/client.ts`. Cada corte cambia un recurso mock por HTTP sin
obligar a migrar aplicación completa.

Contrato campo por campo vive en [../api-contract.md](../api-contract.md).

## Convenciones HTTP

- Prefijo versionado: `/v1`.
- Recursos: nombres plurales y kebab-case.
- JSON: `camelCase`.
- Colecciones pequeñas: array JSON directo para conservar cliente actual.
- Transacciones: objeto paginado `{ "items": [], "nextCursor": null }`.
- Creación: `201 Created`, recurso y header `Location`.
- Actualización: `200 OK` y recurso actualizado.
- Eliminación: `204 No Content`.
- Recurso ajeno: `404`, no `403`, para no revelar existencia.
- JSON desconocido en escrituras: rechazado.

Error canónico:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "request body is invalid"
  }
}
```

`code` es estable para frontend. `message` es segura para usuario/desarrollo y
nunca contiene SQL, stack trace, token o secreto.

## Rutas de infraestructura

| Orden | Método y path | Auth | Dependencia | Motivo |
| --- | --- | --- | --- | --- |
| 1 | `GET /healthz` | No | Proceso | Verifica wiring HTTP |
| 2 | `GET /readyz` | No | PostgreSQL | Verifica capacidad de servir datos |
| 3 | `GET /v1/me` | Sí | JWT | Verifica identidad antes de datos |

`readyz` no devuelve detalles de conexión. Si DB falla responde `503` con
error genérico.

## Orden de recursos de lectura

| Orden | Endpoint | Razón |
| --- | --- | --- |
| 1 | `GET /v1/categories` | Tabla y respuesta simples; prueba aislamiento |
| 2 | `GET /v1/accounts` | Alimenta dashboard y define política de saldos |
| 3 | `GET /v1/transactions` | Añade filtros, paginación e índices |
| 4 | `GET /v1/budgets` | Depende de categorías |
| 5 | `GET /v1/savings-goals` | Recurso aislado, cuenta opcional |
| 6 | `GET /v1/msi-purchases` | Depende de cuenta de crédito y categoría |
| 7 | `GET /v1/rules` | Depende de categorías |

No se crea endpoint de dashboard al inicio. Frontend puede derivar vistas desde
recursos base mientras volumen sea pequeño.

## Primer corte vertical real: categorías

Antes de este corte, Fase 3 conecta `@supabase/supabase-js`, restaura/refresca
sesión, añade token vigente al cliente API y habilita CORS exacto para
`http://localhost:5173`. Fase 3.5 llama onboarding idempotente para crear
categorías sistémicas del usuario.

Flujo:

```txt
useCategories()
  -> api.getCategories()
  -> fetch GET /v1/categories
  -> Authorization Bearer token
  -> auth middleware
  -> categories handler
  -> store.ListCategories(ctx, userID)
  -> SQL WHERE user_id = $1 ORDER BY sort_order, id
  -> Category[] JSON
```

Casos mínimos:

| Caso | Resultado |
| --- | --- |
| Token válido y categorías | `200` + array ordenado |
| Token válido sin categorías | `200` + `[]` |
| Token ausente | `401` |
| Token inválido/expirado | `401` |
| DB no disponible | `500` genérico y error interno logueado |
| Usuario A consulta | Nunca recibe filas de usuario B |

Integración frontend cambia solo implementación de `getCategories()`. Resto de
funciones sigue usando store mock. Esto valida migración gradual.

## Autenticación

Cada request protegida:

1. Lee header `Authorization`.
2. Exige esquema `Bearer` y un solo token.
3. Verifica firma con clave pública obtenida desde JWKS de Supabase.
4. Verifica `iss`, `aud`, `exp` y algoritmo permitido.
5. Convierte `sub` a UUID.
6. Guarda principal tipado en `request.Context()`.
7. Handler obtiene usuario desde contexto.

Proyecto debe usar signing key asimétrica, no secreto HS256 legacy. Fase 3 usa
`github.com/lestrrat-go/jwx/v3` para JWT/JWKS en vez de implementar criptografía
o cache manual. Algoritmo exacto se allow-list y se prueba. JWKS se cachea y
refresca al rotar clave; no se descarga en cada request. Fallo temporal de
refresh no invalida claves cacheadas todavía válidas.

No se usa Supabase `service_role` como token del browser. No se registra access
token completo.

Frontend define variables públicas exactas:

```txt
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL
```

Cliente obtiene sesión actual antes de request y maneja refresh con SDK. Un
`401` después de refresh válido termina sesión; no entra en retry infinito.

## Onboarding

```txt
POST /v1/onboarding
```

Endpoint protegido e idempotente crea categorías sistémicas dentro de una
transacción. Usa claves estables de seed y unique constraint por usuario para
`INSERT ... ON CONFLICT DO NOTHING`. Repetir request devuelve `204` sin
duplicados. No sobrescribe nombres, orden o categorías personalizadas.

## Paginación de transacciones

Orden estable:

```txt
transaction_date DESC, id DESC
```

Cursor codifica última tupla `(date, id)` y es opaco para frontend. Consulta de
siguiente página usa comparación keyset, no `OFFSET`.

Reglas:

- Default `limit=50`.
- Mínimo 1, máximo 100.
- Cursor inválido: `400`.
- Filtros deben conservarse al pedir siguiente página.
- Se consulta `limit + 1` para saber si existe página siguiente.
- Cursor debe tener versión para permitir cambiar formato después.

Mientras hooks actuales calculen totales desde `Transaction[]`, implementación
temporal de `getTransactions()` debe seguir `nextCursor` hasta llegar a null y
reunir todas las páginas. Nunca desempaqueta solo primera página. Antes de volumen
productivo se separan query paginada de historial y endpoint/resumen canónico
para dashboard.

## Filtros iniciales de transacciones

```txt
from=YYYY-MM-DD
to=YYYY-MM-DD
account_id=<uuid>
category_id=<uuid>
type=expense|income|transfer
limit=50
cursor=<opaque>
```

Validaciones:

- `from <= to`.
- UUIDs válidos.
- Cuenta/categoría filtrada no necesita consulta previa; `user_id` mantiene
  aislamiento.
- Parámetro desconocido se rechaza para detectar typos.

## Orden de escrituras

### Transacciones

```txt
POST   /v1/transactions
PATCH  /v1/transactions/{id}
DELETE /v1/transactions/{id}
```

Primero resuelve política de saldos. Transferencias y cambios de saldo deben
ser una sola transacción SQL. IDs relacionados deben pertenecer al mismo
usuario.

### Cuentas

```txt
POST  /v1/accounts
PATCH /v1/accounts/{id}
DELETE /v1/accounts/{id}
```

`DELETE` físico se permite solo para cuenta sin historia; si hay referencias
responde `409`. Flujo normal usa `PATCH { "isActive": false }`.

### Presupuestos

```txt
POST   /v1/budgets
PATCH  /v1/budgets/{id}
DELETE /v1/budgets/{id}
```

### Metas

```txt
POST   /v1/savings-goals
PATCH  /v1/savings-goals/{id}
POST   /v1/savings-goals/{id}/contributions
DELETE /v1/savings-goals/{id}
```

Contribución es acción explícita porque representa evento de dominio, no simple
reemplazo arbitrario de `currentAmount`.

### Categorías

```txt
POST   /v1/categories
PATCH  /v1/categories/{id}
DELETE /v1/categories/{id}
```

Categorías `isSystem` no se editan ni borran. Categorías referenciadas requieren
decisión explícita: rechazar `409` o reasignar; primera versión rechaza.

### Reglas

```txt
POST   /v1/rules
PATCH  /v1/rules/{id}
DELETE /v1/rules/{id}
```

Toggle frontend se traduce a `PATCH { "isActive": boolean }`; no necesita ruta
especial. Cliente actual que envía solo ID debe cambiar a DTO con boolean.

## Idempotencia financiera

`POST /v1/transactions` y `POST /v1/savings-goals/{id}/contributions` exigen
header `Idempotency-Key` UUID generado por cliente. Tabla `idempotency_keys`
guarda por usuario key, hash de request, status y response segura.

Misma key y mismo request repite response original. Misma key con body distinto
responde `409`. Registro y cambio financiero ocurren en misma transacción SQL.
Esto evita duplicar dinero cuando cliente reintenta tras timeout.

Frontend genera `operationId` una vez al crear variables de mutación y lo usa
como `Idempotency-Key`. Retries automáticos y reintento manual tras resultado
ambiguo conservan mismo `operationId`; solo una intención nueva genera otro.
Firmas de `createTransaction` y `contributeToSavingsGoal` deben recibirlo de
forma explícita, no generarlo dentro de cada llamada HTTP.

## Validación

Orden en handler:

1. Limitar tamaño de body.
2. Exigir `Content-Type: application/json` para bodies.
3. Decodificar exactamente un objeto JSON.
4. Rechazar campos desconocidos.
5. Validar forma y rangos.
6. Ejecutar regla de dominio/DB.
7. Mapear error a status seguro.

No se agrega librería de validación en primera versión. Métodos `Validate()` o
funciones pequeñas mantienen reglas visibles. Si repetición crece, se evalúa
dependencia después.

## Matriz de pruebas por endpoint

- Método y path correctos.
- Status y JSON felices.
- Content type.
- Auth ausente, inválida y válida.
- Input mal formado.
- Campos desconocidos.
- Valores fuera de rango.
- Recurso inexistente.
- Recurso de otro usuario tratado como inexistente.
- Error DB no filtra detalle.
- Orden determinista.
- Cancelación de request llega a query.

Handlers usan `httptest`. SQL requiere pruebas de integración contra PostgreSQL
real; mocks no validan sintaxis, constraints ni semántica de Postgres.

## Cambios frontend por etapa

1. Agregar cliente base con `VITE_API_URL` y token Supabase.
2. Agregar parser común de error.
3. Migrar una función `getX` cada vez.
4. Mantener query keys y hooks mientras contrato no cambie.
5. Validar responses en runtime antes de confiar en TypeScript.
6. Eliminar mock de recurso solo cuando lectura y escrituras usadas estén listas.

## Inconsistencias detectadas y resolución

### `Transaction.createdAt`

Frontend lo tipa `ISODate`, pero valor real es timestamp RFC 3339. Debe crearse
alias `ISOTimestamp` antes de validación runtime.

### Operadores de reglas

Frontend permite `contains` y `startsWith`. API conserva ambos. DB usa
`starts_with`; mapper HTTP traduce nombres.

### Campos de presentación de regla

Frontend `Rule` no contiene nombre/color de categoría. API devuelve shape base
y frontend resuelve categoría con su mapa existente. No se duplican campos.

### Monedas

V1 acepta únicamente MXN aunque tipo frontend sea forward-compatible con USD.
Soporte multimoneda requiere migración y contrato nuevos; backend no inventará
conversión.

### Utilización de crédito

Frontend actual calcula `availableCredit / creditLimit` pero lo llama
`utilizationRate`. Utilización real de deuda es
`(creditLimit - availableCredit) / creditLimit`. Debe corregirse antes de usar
esta métrica con datos reales.

### Saldos

Frontend usa snapshots en cuenta y transacciones independientes. Lecturas
pueden conservar esto temporalmente; escrituras esperan decisión de ledger.

## Cuándo crear endpoint de dashboard

Solo cuando ocurra al menos una condición:

- Transferir todas las transacciones es costoso.
- Distintos clientes necesitan exactamente mismos cálculos.
- Reglas de periodo se vuelven canónicas y complejas.
- Medición demuestra latencia o payload problemáticos.

Hasta entonces, endpoints base reducen superficie y facilitan aprendizaje.
