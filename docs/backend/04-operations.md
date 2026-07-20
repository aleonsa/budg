# Despliegue y operación serverless

## Topología inicial

```txt
Cloudflare Pages o Vercel
  -> HTTPS
Google Cloud Run, región cercana a usuarios y Supabase
  -> Supabase transaction pooler
Supabase PostgreSQL

Browser
  -> Supabase Auth
  -> token JWT enviado a Cloud Run
```

Cloud Run se elige sobre funciones individuales porque API Go sigue siendo un
servicio HTTP normal: un binario, un router, un pool y un despliegue. Escala a
cero sin fragmentar cada endpoint.

## Ambientes

| Ambiente | Propósito | Datos |
| --- | --- | --- |
| Local | Desarrollo y pruebas | Supabase local o DB descartable |
| Development | Integración compartida | Proyecto Supabase no productivo |
| Production | Usuarios reales | Proyecto y secretos separados |

Nunca se apunta test automatizado destructivo a producción. Development y
production no comparten passwords, JWT config ni proyecto Supabase.

## Variables de entorno planeadas

| Variable | Secreta | Descripción |
| --- | --- | --- |
| `APP_ENV` | No | `development` o `production` |
| `PORT` | No | Puerto, proporcionado por Cloud Run |
| `LOG_LEVEL` | No | Nivel `slog` |
| `DATABASE_URL` | Sí | Runtime transaction pooler |
| `MIGRATIONS_DATABASE_URL` | Sí | Direct/session para Goose, fuera de API |
| `SUPABASE_URL` | No | Proyecto usado para issuer/JWKS |
| `SUPABASE_JWT_AUDIENCE` | No | Audience esperada |
| `CORS_ALLOWED_ORIGINS` | No | Lista explícita de frontends |

Frontend solo recibe valores públicos, por ejemplo URL de Supabase, anon key y
URL de API. Password DB, migration URL y service role jamás usan prefijo
`VITE_`.

`DATABASE_URL` hosted exige TLS verificable (`sslmode=verify-full`) y CA
recomendada por Supabase. Servicio rechaza configuración production insegura.

## Contenedor

Dockerfile final debe:

1. Compilar en stage de Go con versiones fijadas.
2. Ejecutar pruebas fuera o antes de construir release.
3. Copiar solo binario y certificados necesarios a imagen runtime.
4. Ejecutar como usuario no root.
5. No copiar `.env`, source innecesario ni credenciales.
6. Escuchar `PORT`.
7. Recibir `SIGTERM` y cerrar servidor/pool.

Imagen no ejecuta migraciones en entrypoint. Varias instancias arrancando al
mismo tiempo no deben competir por schema.

## Configuración inicial de Cloud Run

Punto de partida, no tuning final:

- Minimum instances: `0`.
- Maximum instances a nivel servicio: `2`, no `2` por revisión.
- Concurrency: `20`.
- CPU: `1`.
- Memory: `256 MiB` o `512 MiB` según medición.
- Request timeout: corto para API interactiva.
- Ingress público con auth de aplicación mediante JWT.
- Startup/liveness probe: `/healthz`.

Con `MaxConns=4`, dos instancias consumen hasta ocho conexiones runtime. Límite
Supabase debe conservar margen adicional para migraciones, administración y
transiciones entre revisiones. Si plataforma no ofrece límite máximo a nivel
servicio, rollout reduce límites por revisión para que suma posible no supere
presupuesto. Antes de aumentar instancias se recalcula todo el presupuesto.

## Flujo de despliegue

1. Ejecutar format, tests, race detector y vet.
2. Construir imagen inmutable.
3. Aplicar migración Goose expand backward-compatible con revisión todavía activa.
4. Desplegar revisión Cloud Run sin mover todo tráfico si cambio es riesgoso.
5. Ejecutar smoke tests.
6. Mover tráfico y retirar revisiones antiguas cuando sea seguro.
7. Aplicar migración contract destructiva solo después de que ningún código
   antiguo use columna/tabla anterior.
8. Observar errores y latencia.

Smoke tests mínimos:

```txt
GET /healthz -> 200
GET /readyz -> 200
GET /v1/me sin token -> 401
GET /v1/me con token de prueba -> 200
GET /v1/categories con token -> 200
```

Si migración falla, no se despliega código dependiente. Toda migración previa a
rollout debe ser compatible con revisión actual y rollback. En producción se
corrige con nueva migración forward; `down` automático puede destruir datos.

## CORS

Producción permite solo orígenes frontend conocidos. Desarrollo permite URL
local exacta, por ejemplo `http://localhost:5173`.

Política inicial:

- Métodos necesarios, no wildcard general.
- Headers `Authorization`, `Content-Type`, `Accept`.
- Credentials solo si realmente se usan cookies; Bearer token no las necesita.
- Preflight cacheado por tiempo moderado.

CORS no autentica ni autoriza. Clientes no-browser pueden ignorarlo.

## Logs

Cada request debería registrar:

- Request ID.
- Método.
- Ruta templada cuando sea posible.
- Status.
- Duración.
- Ambiente y revisión.
- User ID solo si política de privacidad lo permite; preferir identificador
  correlacionable no sensible.

Nunca registrar:

- Header `Authorization`.
- Passwords o URLs completas con credenciales.
- Bodies financieros completos por defecto.
- SQL con valores sensibles.
- Stack traces enviados al cliente.

## Métricas iniciales

- Requests por status.
- Latencia p50/p95/p99.
- Errores de DB.
- Tiempo esperando conexión del pool.
- Número de conexiones adquiridas/ociosas.
- Cold starts y conteo de instancias.
- Fallos de validación JWT.

Primero usar métricas y logs nativos de Cloud Run. Agregar proveedor externo
solo cuando exista necesidad operativa concreta.

## Backups y recuperación

- Habilitar estrategia disponible en plan Supabase elegido.
- Confirmar retención y point-in-time recovery antes de datos reales.
- Probar restauración en proyecto no productivo.
- Exportación de usuario no sustituye backup de DB.
- Migraciones y restore deben documentar orden de recuperación.

## Seguridad operativa

- Secretos gestionados por Secret Manager/Cloud Run, no Git.
- IAM mínimo para deploy y runtime.
- DB role de API con privilegios solo sobre tablas/secuencias requeridas.
- Dependencias actualizadas y escaneadas.
- HTTPS obligatorio.
- Rate limiting se añade cuando exista exposición/abuso medible; auth y límites
  de Cloud Run no sustituyen control de costos.
- Rotación de JWT keys y secretos probada antes de necesitarla.

## Costos y límites

Serverless reduce costo ocioso, no elimina límites. Principales controles:

- `max instances` evita crecimiento inesperado y protege DB.
- Pool pequeño evita tormenta de conexiones.
- Queries paginadas limitan memoria y egress.
- Timeouts cortos liberan recursos.
- Índices responden patrones observados.
- No mantener minimum instances hasta que cold start afecte experiencia real.

## Checklist previo a producción

- Proyecto Supabase production separado.
- Backups y restore comprobados.
- Migraciones reproducibles desde cero.
- Secretos fuera de imagen y repositorio.
- CORS exacto.
- JWT valida firma y claims.
- Tests de aislamiento entre usuarios pasan.
- Pool e instancias respetan presupuesto DB.
- Health y readiness tienen semántica distinta.
- Logs no contienen secretos ni payload financiero completo.
- Smoke test y rollback de revisión documentados.
