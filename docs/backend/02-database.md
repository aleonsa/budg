# Modelo de datos y migraciones

## Objetivo

Definir esquema objetivo completo sin obligarnos a crearlo de una vez. Cada
tabla se agrega cuando su endpoint entra en desarrollo. Así cada migración es
pequeña, explicable y verificable.

## Convenciones

- Tablas y columnas: `snake_case`.
- JSON: `camelCase`.
- IDs: `uuid`, generados por DB con `gen_random_uuid()`.
- Ownership: `user_id uuid not null` tomado de `auth.users.id`.
- Dinero: `bigint` en centavos.
- Fecha financiera: `date`.
- Timestamp técnico: `timestamptz` en UTC.
- Estados pequeños: `text` + `check`, no tipos enum de PostgreSQL inicialmente.
- Timestamps: `created_at` y `updated_at` con default `now()`.
- Actualizaciones: API asigna `updated_at = now()`; no hay trigger inicial.

`bigint` permite rangos grandes, pero cada columna monetaria también lleva
constraint dentro del entero seguro de JavaScript:

```txt
-9007199254740991 <= valor <= 9007199254740991
```

Campos no negativos combinan ese máximo con su límite inferior. API repite
validación para devolver error útil; constraint protege importaciones y SQL
administrativo.

## Invariante de usuario

Todas las tablas financieras contienen:

```txt
id uuid primary key
user_id uuid not null references auth.users(id) on delete cascade
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (user_id, id)
```

`unique (user_id, id)` permite foreign keys compuestas. Una relación entre dos
recursos se define como `(user_id, resource_id)`, impidiendo que fila de usuario
A apunte accidentalmente a recurso de usuario B.

La API además agrega `WHERE user_id = $1` a cada consulta. Constraint y query
se complementan; ninguna reemplaza a otra.

## Acceso y RLS

Modelo inicial:

1. Frontend usa Supabase solo para Auth.
2. Frontend no consulta tablas financieras mediante Data API.
3. RLS se habilita y no se crean policies para `anon` o `authenticated`.
4. Rol dedicado `budg_api` accede por conexión PostgreSQL y no se expone al
   browser.
5. API verifica JWT y filtra cada operación por `user_id`.
6. Pruebas de integración comprueban aislamiento entre dos usuarios.

`budg_api` nunca es owner y no recibe DDL, role management ni acceso a schema
`auth`. Bootstrap reproducible crea rol `LOGIN BYPASSRLS`, mientras migraciones
administrativas otorgan únicamente `USAGE` de schema y DML por tabla/secuencia.
Password se inyecta fuera de SQL versionado. Grants para tablas futuras forman
parte de cada migración y se prueban desde rol runtime.

Usar bypass de RLS aumenta impacto de una query mal escrita. Esta primera
versión acepta aislamiento a nivel aplicación, compensado con privilegios
mínimos, foreign keys compuestas, queries explícitas y tests entre usuarios. Un
modelo posterior puede propagar identidad a RLS por transacción, pero no se
simula defensa en profundidad que realmente esté desactivada.

## Tablas objetivo

### `categories`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `name` | `text` | No vacío |
| `kind` | `text` | `expense` o `income` |
| `color` | `text` | Clave permitida por frontend |
| `icon` | `text` | Nombre de icono, no vacío |
| `parent_id` | `uuid null` | Categoría del mismo usuario |
| `is_system` | `boolean` | Default `false` |
| `system_key` | `text null` | Clave estable para seeds sistémicos |
| `sort_order` | `integer` | Default `0`, no negativo |

Constraints relevantes:

- Parent pertenece al mismo usuario.
- `parent_id <> id`.
- Backend evita ciclos de más de un nivel y cambios a categorías sistémicas.
- `system_key` es único por usuario cuando no es null; onboarding usa esta
  clave para ser idempotente sin depender de nombre traducido.
- Nombre debería ser único por usuario y tipo sin importar mayúsculas; se
  implementa con índice sobre `lower(name)` cuando entren escrituras.

Primer índice de lectura:

```txt
(user_id, sort_order, id)
```

### `accounts`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `name` | `text` | No vacío |
| `type` | `text` | `debit` o `credit` |
| `institution` | `text` | No vacío |
| `last4` | `text` | Cuatro dígitos |
| `currency` | `text` | Solo `MXN` en v1 |
| `balance_cents` | `bigint null` | Solo débito; puede ser negativo |
| `credit_limit_cents` | `bigint null` | Solo crédito, no negativo |
| `available_credit_cents` | `bigint null` | Entre cero y límite |
| `statement_cut_day` | `smallint null` | Solo crédito, 1 a 28 |
| `payment_due_day` | `smallint null` | Solo crédito, 1 a 28 |
| `is_active` | `boolean` | Default `true` |

Fase de lectura preserva snapshots del frontend: `balance_cents` y
`available_credit_cents`. Todavía no se recalculan desde transacciones. Antes de
habilitar escrituras debe elegirse y documentarse una sola política:

- Saldos derivados de un ledger y balance inicial; opción más consistente.
- Snapshots actualizados atómicamente con cada transacción; opción más simple,
  pero requiere reconciliación.

No se borran cuentas con historia; se desactivan.

V1 es deliberadamente monomoneda (`MXN`). El frontend conserva unión de tipos
para evolución futura, pero API rechaza escrituras USD y constraint de DB evita
mezcla silenciosa. Soportar USD requiere amounts por moneda, tipos de cambio y
transferencias con monto origen/destino; será migración explícita.

### `transactions`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `account_id` | `uuid` | Cuenta origen del mismo usuario |
| `type` | `text` | `expense`, `income` o `transfer` |
| `amount_cents` | `bigint` | Mayor que cero |
| `category_id` | `uuid null` | Categoría del mismo usuario |
| `transaction_date` | `date` | Fecha financiera |
| `description` | `text` | No vacío |
| `merchant` | `text null` | Opcional |
| `transfer_to_account_id` | `uuid null` | Cuenta destino del mismo usuario |
| `msi_purchase_id` | `uuid null` | Se agrega después de tabla MSI |
| `is_reconciled` | `boolean` | Default `false` |

Transferencia requiere destino distinto del origen y categoría nula. Otros
tipos no aceptan cuenta destino. Compatibilidad entre tipo de categoría y tipo
de transacción se valida en backend.

Índice principal:

```txt
(user_id, transaction_date desc, id desc)
```

Índices adicionales se agregan solo cuando queries reales los necesitan:

- `(user_id, account_id, transaction_date desc)`.
- `(user_id, category_id, transaction_date desc)`.

### `budgets`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `category_id` | `uuid null` | Null representa presupuesto global |
| `amount_cents` | `bigint` | Mayor que cero |
| `period` | `text` | `weekly`, `monthly` o `yearly` |
| `start_date` | `date` | Ancla del ciclo |

Índice de lectura: `(user_id, start_date desc, id)`.

### `savings_goals`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `name` | `text` | No vacío |
| `target_amount_cents` | `bigint` | Mayor que cero |
| `current_amount_cents` | `bigint` | No negativo |
| `target_date` | `date null` | Opcional |
| `account_id` | `uuid null` | Cuenta del mismo usuario |
| `is_completed` | `boolean` | Default `false` |
| `sort_order` | `integer` | No negativo |

Una contribución futura usa transacción SQL y no permite resultado negativo.
Se permite superar monto objetivo; `is_completed` debe quedar consistente.

### `msi_purchases`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `account_id` | `uuid` | Cuenta de crédito del mismo usuario |
| `description` | `text` | No vacío |
| `merchant` | `text null` | Opcional |
| `total_amount_cents` | `bigint` | Mayor que cero |
| `installment_amount_cents` | `bigint` | Mayor que cero |
| `installment_count` | `smallint` | Mayor que cero |
| `installments_paid` | `smallint` | Entre cero y total |
| `start_date` | `date` | Primera mensualidad |
| `next_installment_date` | `date null` | Null cuando termina |
| `category_id` | `uuid null` | Categoría del mismo usuario |
| `status` | `text` | `active` o `completed` |

Backend verifica que cuenta sea de crédito y que estado sea coherente con
mensualidades pagadas. Última mensualidad puede absorber residuo de división.

### `rules`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `field` | `text` | `merchant` o `description` |
| `operator` | `text` | `contains` o `starts_with` |
| `value` | `text` | No vacío |
| `category_id` | `uuid` | Categoría del mismo usuario |
| `is_active` | `boolean` | Default `true` |
| `priority` | `integer` | Mayor que cero |

API traduce operador SQL `starts_with` a JSON `startsWith`.

### `profiles` (posterior)

No es necesaria para verificar JWT. Se agrega cuando ajustes de perfil dejen de
ser locales.

| Columna | Tipo | Regla |
| --- | --- | --- |
| `user_id` | `uuid primary key` | Referencia `auth.users`, cascade |
| `display_name` | `text` | No vacío |
| `base_currency` | `text` | Default `MXN` |
| `locale` | `text` | Default `es-MX` |
| `time_zone` | `text` | Zona IANA |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Default `now()` |

### `idempotency_keys` (antes de escrituras financieras)

| Columna | Tipo | Regla |
| --- | --- | --- |
| `user_id` | `uuid` | Usuario autenticado |
| `key` | `uuid` | Clave enviada por cliente |
| `request_hash` | `text` | Hash de método, path y body canónico |
| `response_status` | `integer` | Status original |
| `response_body` | `jsonb` | Response segura para replay |
| `created_at` | `timestamptz` | Default `now()` |

Primary key compuesta `(user_id, key)`. Registro y cambio financiero se
confirman en misma transacción. Job futuro elimina claves después de ventana de
retención documentada; no se borran antes de máximo periodo de retry.

## Orden de migraciones

Orden planeado, sujeto a una migración Goose por corte vertical:

```txt
00001_create_categories.sql
00002_create_accounts.sql
00003_create_transactions.sql
00004_create_budgets.sql
00005_create_savings_goals.sql
00006_create_msi_purchases.sql
00007_link_transactions_to_msi_purchases.sql
00008_create_rules.sql
00009_create_idempotency_keys.sql
00010_create_profiles.sql
```

Cada cambio vive en un solo archivo. `Up` aparece primero y `Down` después:

```sql
-- +goose Up
CREATE TABLE categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- +goose Down
DROP TABLE categories;
```

Reglas:

- Cada archivo contiene exactamente una anotación `-- +goose Up`.
- Cada archivo incluye `-- +goose Down` salvo que irreversibilidad se explique.
- Statements terminan en punto y coma para que Goose los separe correctamente.
- Goose ejecuta cada archivo dentro de una transacción por default.
- `-- +goose NO TRANSACTION` se usa solo para operaciones que PostgreSQL no
  permite en transacción, como `CREATE INDEX CONCURRENTLY`, y se explica en el
  archivo.
- Producción usa nuevas migraciones hacia adelante para corregir problemas.
- Archivo aplicado nunca se edita.
- DDL y backfills de datos van separados.
- No se permiten migraciones Go en primera versión.
- Tabla `goose_db_version` pertenece a Goose y no se modifica manualmente.
- No se usa `-allow-missing`; conflictos de numeración secuencial se resuelven
  antes de merge y antes de aplicar migraciones.

## Herramienta y conexiones

Runtime y migraciones tienen URLs distintas:

| Variable | Modo | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Transaction pooler | API serverless |
| `MIGRATIONS_DATABASE_URL` | Directa o session pooler | Migraciones y locks |

Bootstrap de roles/grants vive en script administrativo versionado y repetible;
no contiene password. Migraciones de tabla incluyen grants a `budg_api`.

Goose no corre dentro de API. Se ejecuta manualmente en desarrollo y como
job/paso controlado antes de desplegar versión que necesita esquema nuevo.

Variables CLI evitan repetir driver, URL y directorio:

```bash
export GOOSE_DRIVER=postgres
export GOOSE_DBSTRING="$MIGRATIONS_DATABASE_URL"
export GOOSE_MIGRATION_DIR=./migrations
```

Comandos base desde `backend/`:

```bash
goose -env=none -s create create_categories sql
goose -env=none validate
goose -env=none status
goose -env=none up
goose -env=none down
goose -env=none down-to 0
goose -env=none version
```

`-s` crea numeración secuencial. `-env=none` evita que Goose cargue un `.env`
implícito y apunte por accidente a otra DB. `GOOSE_DBSTRING` debe usar
`MIGRATIONS_DATABASE_URL`, nunca transaction pooler de runtime.

## Pool serverless inicial

Valores conservadores para primera versión:

- `MinConns = 0`.
- `MaxConns = 4` por instancia Cloud Run.
- `MaxConnIdleTime` corto para liberar conexiones ociosas.
- Timeout corto para adquirir conexión y ejecutar health check.
- `max instances = 2` al inicio.

Presupuesto inicial máximo aproximado: `4 conexiones x 2 instancias = 8`, más
migraciones y herramientas administrativas. Valores se ajustan contra límite
real mostrado por Supabase.

Supabase transaction pooler no soporta prepared statements de sesión. Después
de `pgxpool.ParseConfig`, runtime debe fijar explícitamente:

```go
config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
```

Fase 2 debe probar esta configuración contra pooler real. No se deja default de
pgx porque prepara statements automáticamente.

Conexiones hosted usan TLS con verificación de hostname (`sslmode=verify-full`)
y CA soportada por Supabase. Production rechaza DSNs sin TLS verificable.

## Pruebas de esquema

Por migración:

1. Crear stack Supabase CLI limpio; PostgreSQL plano no contiene `auth.users`.
2. Ejecutar bootstrap administrativo de `budg_api` con secreto local efímero.
3. Ejecutar `goose -env=none validate`.
4. Aplicar todas las migraciones con `goose -env=none up`.
5. Verificar tablas, constraints, índices y grants desde rol runtime.
6. Ejecutar `goose -env=none down-to 0` solo en ambiente local descartable;
   esto prueba todos los bloques `Down` y destruye schema/datos de ese ambiente.
7. Volver a aplicar `goose -env=none up` para comprobar reconstrucción completa.
8. Crear usuario A y usuario B mediante API Admin/Auth soportada en entorno
   local, no insertando filas internas de Auth manualmente.
9. Probar que referencias cruzadas fallan.
10. Probar checks de dinero, tipo y fechas.

## Estado: completado (setup local)

Fase 2 implementó base de datos local y pipeline de migraciones:

- `supabase/config.toml` habilitó pooler transaction y deshabilitó migraciones
  y seeds automáticos de Supabase.
- Creada migración Goose 00001 para `categories` con FK a `auth.users`, índices,
  constraints CHECK y FORCE RLS.
- Creado `bootstrap-runtime-role.sql` idempotente para inyectar password y crear
  `budg_api` sin privilegios DDL.
- Pipeline CI ejecuta ciclo destructivo `up -> down-to 0 -> up` sobre DB local
  descartable en cada PR.
- `GET /readyz` agregado con 2s timeout que usa pgxpool `Ping()` contra DB.
- Prueba de integración local `TestPostgresPoolIntegration` verifica conexión
  por Supavisor transaction pooler en puerto 54329.

Nota: Supavisor cachea el password inicial de `budg_api`. Si el script bootstrap
rota el password usando `ALTER ROLE`, Supavisor rechazará conexiones nuevas hasta
que el contenedor `supabase_pooler_budg` sea reiniciado. El flujo local/CI
requiere inicializar rol antes del primer intento de conexión.

Falta setup de proyecto alojado (Hosted Development) y verificación de TLS contra
pooler real; esto requiere intervención del administrador de proyecto.

## Decisiones aplazadas intencionalmente

- Ledger canónico contra snapshots de saldo.
- Conversión MXN/USD y transferencias cross-currency.
- Soft delete general; por ahora solo cuentas usan `is_active`.
- Auditoría histórica de cambios.
- Importaciones idempotentes y deduplicación bancaria.
