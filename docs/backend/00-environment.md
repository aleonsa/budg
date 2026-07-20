# Fase 0: gobierno, CI/CD, entorno y decisiones

## Propósito

Preparar repositorio antes de backend: reglas, CI verde, toolchains y secretos.
Fase 0 no construye API ni crea tablas; elimina decisiones ambiguas y hace
calidad verificable.

## Orden exacto

1. Confirmar estado del repositorio y baseline frontend.
2. Adoptar [reglas de desarrollo](../development-rules.md).
3. Ejecutar [setup CI/CD](../ci-cd.md) para TypeScript y Go.
4. Definir identidad canónica GitHub `<owner>/budg`, aunque remoto se cree luego.
5. Decidir module path de Go desde esa identidad.
6. Registrar/fijar versiones de herramientas.
7. Proteger archivos de secretos.
8. Documentar variables sin guardar valores.
9. Exigir CI frontend/security verde y recién entonces empezar Fase 1.

Proyecto GCP, Artifact Registry y Cloud Run no se configuran todavía. Son
necesarios en Fase 9, no para aprender HTTP o conectar DB.

## Decisiones que requieren respuesta

### Module path

Preferido después de decidir identidad canónica del remoto:

```txt
github.com/<owner>/budg/backend
```

Alternativa temporal:

```txt
budg/backend
```

Aunque remoto todavía no exista físicamente, se define owner/repo antes del
módulo para usar ruta final. `budg/backend` temporal solo se acepta si usuario
decide explícitamente posponer identidad; cambiarlo después modifica imports.

### PostgreSQL local o hosted

Opción recomendada: Supabase CLI local.

Ventajas:

- PostgreSQL y Auth cercanos a producción.
- Base descartable.
- Migraciones Goose pueden probar `up/down-to 0/up` sin riesgo.
- No requiere internet para cada iteración una vez instaladas imágenes.

Costos:

- Requiere Docker.
- Consume más recursos locales.
- Añade Supabase CLI al entorno.

Opción simple alternativa: proyecto Supabase development hosted.

Ventajas:

- Menos setup local.
- Prueba pooler y red reales.

Costos:

- Más lento.
- `down` y datos de prueba afectan ambiente compartido.
- Requiere disciplina para no confundir development con production.

No se usa proyecto production para desarrollo. La elección se registra al
iniciar Fase 2.

### Región

Supabase development/production y Cloud Run futuro deben estar en regiones
cercanas. Distancia entre API y DB afecta cada query. Región exacta depende de
disponibilidad de Supabase y ubicación esperada de usuarios; no debe elegirse
Cloud Run antes de conocer región de DB.

## Herramientas

Requeridas en primeras fases:

| Herramienta | Fase | Verificación |
| --- | --- | --- |
| Git | 0 | `git --version` |
| Go | 1 | `go version` |
| curl | 1 | `curl --version` |
| Docker | 2 local | `docker version` |
| Supabase CLI | 2 local | `supabase --version` |
| Goose CLI | 2 | `goose -version` |

GCloud CLI se instala/verifica en Fase 9. No se necesita Node adicional para
backend; frontend conserva su toolchain actual.

Versiones se anotan en documento de fase cuando se ejecute, no se inventan en
este plan. Go debe fijarse en `go.mod` y Dockerfile para reproducibilidad.

Goose puede instalarse con Homebrew o `go install`. En Fase 2 se fija una
versión concreta; no se usa `@latest` en automatización reproducible:

```bash
brew install goose
# o, reemplazando <version> por versión fijada:
go install github.com/pressly/goose/v3/cmd/goose@<version>
```

Solo se usa CLI y migraciones SQL. No se importará Goose en binario de API, no
se usarán migraciones Go y no se ejecutarán migraciones al arrancar servidor.

## Higiene de secretos

Antes de crear `.env`, `.gitignore` debe cubrir:

```gitignore
.env
.env.*
!.env.example
```

`backend/.env.example` contiene solo nombres o valores no sensibles:

```dotenv
APP_ENV=development
PORT=8080
LOG_LEVEL=info
DATABASE_URL=
SUPABASE_URL=
SUPABASE_JWT_AUDIENCE=authenticated
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

`MIGRATIONS_DATABASE_URL` puede documentarse en archivo separado de operación
porque API runtime no debe recibirlo.

Reglas:

- No pegar secretos en Markdown, issues, logs ni comandos que queden en shell
  history si puede evitarse.
- No usar password production en local.
- No exponer `service_role`, DB password o migration URL con prefijo `VITE_`.
- Si un secreto entra en Git, borrarlo del archivo no basta: debe rotarse.

## Proyecto Supabase development

Datos que deben registrarse fuera de secretos:

- Nombre y referencia de proyecto.
- Región.
- URL pública del proyecto.
- Issuer JWT esperado.
- Audience esperada.
- URL de JWKS.
- Algoritmo de signing key activo; debe ser asimétrico (`ES256` o `RS256`).
- Límite de conexiones del plan.
- Datos de transaction pooler y session/direct connection.

Datos secretos se guardan en gestor de secretos/password manager:

- Password de DB.
- `DATABASE_URL` completa.
- `MIGRATIONS_DATABASE_URL` completa.
- Service role si alguna tarea administrativa futura la necesita.

Frontend puede conocer URL y anon key; eso no autoriza acceso a tablas si RLS
y grants están correctamente configurados.

## Requisito de signing key

Backend se diseña para verificar JWT mediante JWKS. Proyectos Supabase legacy
pueden seguir usando secreto compartido `HS256`, que no aparece en JWKS y
obligaría a distribuir mismo secreto al backend.

Antes de Fase 3:

1. Confirmar algoritmo activo en configuración de Auth.
2. Migrar proyecto development a signing key asimétrica si aún usa HS256.
3. Allow-list solo algoritmo elegido en backend.
4. Registrar issuer, audience y JWKS exactos.
5. Planear misma configuración, con claves distintas, para production.

API no acepta simultáneamente algoritmos simétricos y asimétricos. Esto evita
confusión de algoritmo y mantiene rotación mediante JWKS.

## Ambientes y nombres

Convención sugerida:

```txt
budg-local
budg-development
budg-production
```

Local puede ser stack Supabase CLI. Development y production son proyectos
separados. No se copian datos financieros reales a development.

## Qué se valida al terminar Fase 0

- Reglas de desarrollo y Definition of Done están versionadas.
- Frontend pasa format, lint, strict typecheck, tests y build en CI.
- Gate backend está definido y bloquea `.go` nuevo antes de módulo canónico.
- Required check `ci` protege `main` cuando exista remoto.
- Coverage frontend baseline y security checks básicos son visibles.
- Module path decidido.
- Versión Go disponible.
- `.env` quedará ignorado y `.env.example` sí versionado.
- Nadie necesita credenciales para leer documentación.
- GCP queda explícitamente fuera hasta Fase 9.
- Checkout limpio reproduce mismo resultado verde.

## Qué sigue

Solo con Fase 0 verde, Fase 1 crea módulo, servidor, `GET /healthz`, tests y
activa suite CI Go en mismo cambio, sin variables Supabase. DB se elige antes de
Fase 2; signing key/JWKS se confirman antes de Fase 3.
