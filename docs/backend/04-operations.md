# Despliegue y operación

## Decisión de hosting (2026-07-21)

Versiones anteriores de este documento planeaban Cloud Run. Se decidió
consolidar frontend y backend en un solo proyecto Vercel usando
[Services](https://vercel.com/docs/services) (Beta) en vez de Cloud Run, por:

- Cuenta Vercel ya existente; Cloud Run hubiera exigido proyecto GCP, IAM,
  Artifact Registry y Secret Manager nuevos solo para esto.
- Un solo dominio: frontend y backend comparten origin (ruteo por path vía
  `vercel.json`), eliminando CORS en producción por completo.
- Deploy automático nativo por push a `main`; no requiere workflow GitHub
  Actions custom para el backend.
- El backend corre igual como imagen de contenedor (`backend/Dockerfile`);
  nada en el código Go asume una plataforma específica. Si Vercel Services deja
  de convenir, la misma imagen se redespliega en Cloud Run u otro runtime de
  contenedores sin cambios.

Trade-off aceptado conscientemente: Services es Beta y corre bajo el modelo de
Vercel Functions (Fluid Compute) — escala a cero tras inactividad (5 min en
producción, 30s en preview) y no ofrece IP estática ni Secure Compute todavía.
Aceptable para app de uso personal de bajo tráfico.

## Topología

```txt
Browser
  -> Vercel (un dominio, un deployment)
       /v1/*, /healthz, /readyz -> service "backend" (contenedor Go)
       /*                       -> service "frontend" (Vite estático)
  -> Supabase Auth (JWT) y Supabase transaction pooler (Supavisor)
Supabase PostgreSQL
```

`vercel.json` en la raíz del repo define ambos servicios y las rewrites
públicas. Cada servicio se construye de forma independiente; el backend usa
`runtime: container` + `entrypoint: Dockerfile` explícitos porque el repo no
seguiría la convención de función serverless de Vercel para Go (esperaría
handlers exportados por archivo bajo `api/`, no un router `chi` con `main()`
persistente).

## Ambientes

| Ambiente | Propósito | Datos | Proyecto Supabase |
| --- | --- | --- | --- |
| Local | Desarrollo y pruebas | Supabase local o DB descartable | N/A |
| Development | Integración compartida | Proyecto Supabase no productivo | `development` |
| Production | Usuarios reales | Proyecto y secretos separados | proyecto dedicado, creado para producción |

Nunca se apunta test automatizado destructivo a producción. Development y
production no comparten passwords, JWT config ni proyecto Supabase.

## Variables de entorno

| Variable | Secreta | Servicio | Descripción |
| --- | --- | --- | --- |
| `APP_ENV` | No | backend | `development` o `production` |
| `PORT` | No | backend | Vercel inyecta el puerto del contenedor |
| `LOG_LEVEL` | No | backend | Nivel `slog` |
| `DATABASE_URL` | Sí | backend | Runtime transaction pooler, `sslmode=verify-full` |
| `SUPABASE_JWT_ISSUER` | No | backend | Issuer esperado |
| `SUPABASE_JWKS_URL` | No | backend | JWKS del proyecto Supabase |
| `SUPABASE_JWT_AUDIENCE` | No | backend | Audience esperada |
| `CORS_ALLOWED_ORIGINS` | No | backend | Orígenes de desarrollo local; en producción el frontend es same-origin |
| `VITE_SUPABASE_URL` | No | frontend | Proyecto Supabase (cliente público) |
| `VITE_SUPABASE_ANON_KEY` | No | frontend | Anon key (segura para browser) |
| `VITE_API_BASE_URL` | No | frontend | Sin setear en Production/Preview: default same-origin (ver `backend.ts`). Solo se usa en desarrollo local si el backend no corre en `localhost:8080` |

Password DB y service role jamás usan prefijo `VITE_`. `DATABASE_URL` hosted
exige TLS verificable (`sslmode=verify-full`); ver sección siguiente sobre el
CA root de Supabase.

## TLS del pooler de Supabase (`sslmode=verify-full`)

El certificado del pooler de Supabase (Supavisor, `*.pooler.supabase.com`) no
encadena a una CA públicamente confiada: la raíz (`Supabase Root 2021 CA`) es
autofirmada. Ningún trust store de sistema operativo (macOS, Debian/Linux) la
reconoce, así que `sslmode=verify-full` falla con error genérico de
verificación TLS en cualquier plataforma a menos que se le entregue esa CA
explícitamente vía el parámetro `sslrootcert`.

Confirmado a mano el 2026-07-21 contra el pooler transaccional del proyecto
`development`, tanto con `psql` como con el binario Go real (`pgx`) corriendo
dentro del contenedor Linux — ambos fallan sin `sslrootcert` y funcionan con
él.

`backend/certs/supabase-root-2021-ca.pem` es esa CA raíz (certificado público,
sin llave privada, versionado en el repo — ver `backend/certs/README.md`). El
Dockerfile la copia a `/app/certs/supabase-root-2021-ca.pem` en la imagen de
runtime. `DATABASE_URL` de producción debe incluir:

```
?sslmode=verify-full&sslrootcert=/app/certs/supabase-root-2021-ca.pem
```

## Contenedor

`backend/Dockerfile` (multi-stage, ~15MB final):

1. Compila en stage `golang:1.26.5-bookworm` con `CGO_ENABLED=0` (pgx y jwx son
   pure Go, sin dependencia cgo).
2. Runtime en `gcr.io/distroless/static-debian12:nonroot` — sin shell, sin
   package manager, corre como `nonroot` (uid 65532).
3. Copia solo el binario compilado y la CA de Supabase; nada de `.env`,
   `migrations/`, `scripts/` ni código fuente (`.dockerignore`).
4. Escucha `$PORT` (Vercel/Cloud Run/etc. lo inyectan; default local `8080`).
5. Recibe `SIGTERM` y cierra servidor/pool con gracia — ya implementado en
   `cmd/api/main.go` (`signal.Notify` + `srv.Shutdown` con timeout de 30s),
   coincide con el grace period que Vercel Services da a un contenedor antes
   de terminarlo forzosamente.

Pruebas no corren en el Dockerfile: CI (`make check-backend`) es el gate antes
de que cualquier commit llegue a un build de imagen; el Dockerfile solo
compila lo que ya pasó CI. La imagen no ejecuta migraciones en su entrypoint;
Goose corre como paso separado para que varias instancias arrancando a la vez
no compitan por el esquema.

## Flujo de despliegue

1. CI verde en `main` (`make check-frontend`, `make check-backend`,
   `make check-security`, migraciones).
2. Push a `main` dispara build nativo de Vercel para ambos servicios desde el
   mismo commit.
3. Migración Goose expand backward-compatible se aplica manualmente (o vía
   paso separado) antes de que el nuevo código dependa de ella.
4. Vercel construye y despliega ambos servicios; capa de contenedor del
   backend se reconstruye desde `backend/Dockerfile`.
5. Smoke test post-deploy (ver abajo).
6. Migración contract destructiva solo después de que ningún código viejo use
   la columna/tabla anterior.

## Ejecutar migraciones

Las URLs administrativas viven fuera de Git:

```txt
local/env/migrations.dev.env
local/env/migrations.prod.env
```

Formato de cada archivo:

```dotenv
BUDG_MIGRATION_ENV=development
MIGRATIONS_DATABASE_URL='postgresql://...'
```

Producción usa `BUDG_MIGRATION_ENV=production`. El wrapper valida esta marca
para reducir el riesgo de ejecutar contra el ambiente equivocado, agrega
`prefer_simple_protocol=true` para hacer Goose compatible con el transaction
pooler de Supabase y nunca imprime la URL.

Desde la raíz:

```bash
make migrate-dev-status
make migrate-dev-up
make migrate-prod-status
make migrate-prod-up CONFIRM_PRODUCTION=1
```

`migrate-prod-up` requiere confirmación explícita. El comando equivalente sin
Make es `backend/scripts/migrate.sh prod up --confirm-production`.

Smoke tests mínimos:

```txt
GET /healthz -> 200
GET /readyz -> 200
GET /v1/me sin token -> 401
GET /v1/me con token de prueba -> 200
GET /v1/categories con token -> 200
```

Si una migración falla, no se despliega código dependiente. En producción se
corrige con nueva migración forward; `down` automático puede destruir datos.

## CORS

En producción, frontend y backend comparten origin (mismo dominio Vercel,
ruteo por path), así que el navegador nunca envía preflight/CORS para tráfico
real. `CORS_ALLOWED_ORIGINS` sigue existiendo para desarrollo local
(`http://localhost:5173` hablándole a `localhost:8080`) y como defensa en
profundidad si el backend alguna vez se sirve desde otro origin.

Política:

- Métodos necesarios, no wildcard general.
- Headers `Authorization`, `Content-Type`, `Accept`.
- Credentials solo si realmente se usan cookies; Bearer token no las necesita.

CORS no autentica ni autoriza. Clientes no-browser pueden ignorarlo.

## Logs

Cada request debería registrar:

- Request ID.
- Método.
- Ruta templada cuando sea posible.
- Status.
- Duración.
- Ambiente.
- User ID solo si política de privacidad lo permite; preferir identificador
  correlacionable no sensible.

Nunca registrar:

- Header `Authorization`.
- Passwords o URLs completas con credenciales.
- Bodies financieros completos por defecto.
- SQL con valores sensibles.
- Stack traces enviados al cliente.

Logs nativos de Vercel (stdout/stderr del contenedor) son la fuente inicial.
Proveedor externo de observability se agrega solo cuando exista necesidad
operativa concreta.

## Backups y recuperación

- Habilitar estrategia disponible en plan Supabase elegido para el proyecto de
  producción.
- Confirmar retención y point-in-time recovery antes de datos reales.
- Probar restauración en proyecto no productivo.
- Exportación de usuario no sustituye backup de DB.
- Migraciones y restore deben documentar orden de recuperación.

## Seguridad operativa

- Secretos gestionados como variables de entorno "Sensitive" en el dashboard
  de Vercel, nunca en Git.
- DB role de API (`budg_api`) con privilegios solo sobre tablas/secuencias
  requeridas, `NOBYPASSRLS`.
- Dependencias actualizadas y escaneadas (`govulncheck`, `npm audit`,
  Dependabot).
- HTTPS obligatorio (Vercel lo provee por defecto en todo dominio).
- Signup público deshabilitado en Supabase Auth para producción (uso
  personal); único usuario creado manualmente desde el dashboard.
- Rate limiting se añade cuando exista exposición/abuso medible.
- Rotación de JWT keys y secretos probada antes de necesitarla.

## Costos y límites

- Vercel Services factura bajo el mismo modelo que Vercel Functions (Active
  CPU + Fluid Compute): se paga por CPU activa, no por tiempo ocioso.
- `MaxConns` pequeño en `pgxpool` evita tormenta de conexiones si varias
  instancias escalan a la vez; revisar contra el límite de conexiones del plan
  Supabase elegido.
- Queries paginadas limitan memoria y egress.
- Timeouts cortos liberan recursos.
- No se optimiza cold start hasta que afecte experiencia real medida.

## Checklist previo a producción

- Proyecto Supabase production separado del de development.
- Backups y restore comprobados.
- Migraciones reproducibles desde cero (`up -> down-to 0 -> up`).
- CA root de Supabase (`backend/certs/supabase-root-2021-ca.pem`) presente en
  la imagen; `DATABASE_URL` de producción usa `sslmode=verify-full` +
  `sslrootcert`.
- Secretos fuera de imagen y repositorio.
- `vercel.json` rutea `/v1/*`, `/healthz`, `/readyz` al backend y todo lo
  demás al frontend.
- JWT valida firma y claims.
- Tests de aislamiento entre usuarios (RLS) pasan.
- Signup público deshabilitado en Supabase Auth; usuario único creado.
- Health y readiness tienen semántica distinta.
- Logs no contienen secretos ni payload financiero completo.
- Smoke test post-deploy documentado y ejecutado.
