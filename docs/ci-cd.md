# Plan de CI/CD

## Objetivo

Automatizar reglas de desarrollo para frontend TypeScript y backend Go. Setup
de repositorio será trabajo dedicado de Fase 0, antes de primera línea de lógica
Go. Fase 0 instala pipeline completo, pero gate Go se activa atómicamente en
Fase 1 junto con módulo limpio, primer paquete y sus pruebas.

CI y CD son workflows separados:

- CI valida cada pull request y push a `main`.
- CD solo usa commit que pasó CI. Backend construye una imagen una vez y la
  promueve por digest; frontend puede construir por ambiente porque Vite embebe
  variables, pero siempre desde mismo SHA verde y repitiendo validación.

## Estado actual

Frontend ya tiene:

- `npm ci` reproducible mediante lockfile.
- Prettier con `format` y `format:check`.
- Oxlint sin warnings permitidos.
- TypeScript 7 con `strict: true` y gate `typecheck` separado.
- Vitest, Testing Library y coverage visible.
- Build Vite separado de typecheck.

CI, Makefile, Dependabot, secret scanning, audit completo de dependencias npm y
gate backend están implementados. Backend canónico sigue reservado para Fase 1.
Repositorio es público y `main` exige PR, check `ci`, conversaciones resueltas y
linear history; force push/delete y bypass administrativo están bloqueados.

## Archivos implementados y futuros

```txt
.github/
  workflows/
    ci.yml
  dependabot.yml
Makefile                       # entrypoint local/CI, sin ocultar comandos
docs/
  development-rules.md
  ci-cd.md
frontend/
  package.json
  package-lock.json
  src/test/setup.ts           # Vitest + Testing Library
backend/
  go.mod                       # creado y activado en Fase 1
  go.sum
  Dockerfile                   # imagen del backend, agregada en Fase 11
vercel.json                    # servicios frontend+backend, agregado en Fase 11
```

No se crean workflows de deploy falsos antes de existir destino. Fase 0 dejó
CI frontend/security activo y gate Go definido. Fase 11 decidió no necesitar
`deploy-frontend.yml`/`deploy-backend.yml`: Vercel Services despliega ambos
servicios nativamente desde `vercel.json` sin workflow GitHub Actions propio.

## Toolchains reproducibles

Versiones investigadas y seleccionadas están en
[`toolchain-versions.md`](toolchain-versions.md). Durante setup se fijan, no se
adivinan:

- Node 24.18.0 LTS, registrado en `engines` y `.node-version`.
- npm 12.0.1 compatible, `engine-strict=true` y `package-lock.json` versionado.
- Go 1.26.5 fijado en `.go-version`; Fase 1 lo declara en `go.mod` y CI, y
  Fase 9 fija misma versión en Dockerfile.
- Goose fijado a versión concreta en CI de migraciones.
- Supabase CLI fijada cuando entren tests de integración.
- GitHub Actions fijadas a commit SHA con comentario de versión humana.

Renovaciones llegan por Dependabot en PRs separados. Lockfiles no se editan a
mano.

## Workflow CI

Triggers:

```txt
pull_request -> main
push -> main
```

Política:

- Permisos default `contents: read`.
- Repository settings permiten solo Actions de GitHub y exigen commit SHA.
- Sin secretos para validación de PR.
- `concurrency` cancela ejecución anterior de misma rama/PR; no existe trigger
  manual capaz de cancelar o eludir comparación backend.
- Jobs corren en paralelo cuando son independientes.
- Monorepo pequeño ejecuta frontend siempre. Gate backend comprueba que no haya
  `.go` nuevo antes del módulo canónico; desde Fase 1 ejecuta suite Go completa.
  Optimización por paths se evalúa solo si tiempo/costo lo justifican.
- Un job agregador estable `ci` depende de todos y se configura como required
  check para branch protection.

## Job frontend-quality

Working directory: `frontend/`.

Orden implementado:

```bash
npm install --global npm@12.0.1
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Scripts instalados:

- `typecheck`: TypeScript sin emitir.
- `format` y `format:check`: formatter elegido y fijado.
- `test` y `test:coverage`: Vitest.
- Testing Library para comportamiento React, no snapshots masivos.
- `strict: true` explícito en configs de aplicación y tooling.
- `build`: solo Vite; typecheck queda como gate separado sin ejecutarse dos veces.

Build no sustituye typecheck separado: ambos permanecen visibles en CI. Los 13
warnings Oxlint del baseline fueron resueltos y `--deny-warnings` hace fallar
cualquier warning nuevo.

## Job backend-quality

Working directory: `backend/`.

Orden implementado desde Fase 1:

```bash
go mod download
go mod verify
gofmt -l .  # debe estar vacío
go vet ./...
go test -race -coverprofile=coverage.out -covermode=atomic ./...
go build ./cmd/api
go install golang.org/x/vuln/cmd/govulncheck@v1.4.0
govulncheck ./...
```

`gofmt -l` solo detecta en CI; developer ejecuta `gofmt -w`. Coverage se publica
como artefacto. `actions/setup-go@v7.0.0` lee `.go-version` y cachea módulos
usando `backend/go.sum`.

Fase 0 congeló `backend/` mediante `scripts/check-backend-phase0.sh`. Fase 1
eliminó ese script y reemplazó el experimento ignorado por módulo canónico
`github.com/aleonsa/budg/backend` con router `chi`, `GET /healthz`, tests
`httptest` y suite Go completa. Ninguna línea Go nueva entra sin gate Go.

## Job migrations

Activo desde Fase 2 para garantizar que reconstrucción de esquema nunca falle:

1. Instala Supabase CLI y Goose fijados.
2. Arranca Supabase local descartable (sólo DB).
3. Ejecuta script de bootstrap para rol runtime `budg_api`.
4. Ejecuta `goose validate`.
5. Ejecuta ciclo destructivo: `goose up -> goose down-to 0 -> goose up`.

Job usa base local efímera; no afecta development ni production. Prueba Go de
integración se documenta como validación local contra pooler porque CI separa DB
de la suite unitaria.

## Job security

Gates mínimos:

- Secret scan del diff y repositorio.
- Dependency review para nuevas dependencias cuando plan GitHub lo soporte.
- `govulncheck` para código Go alcanzable.
- Audit de todas las dependencias npm, incluidas herramientas de build/test.
- Actions sin permisos de escritura innecesarios.
- Ningún workflow `pull_request_target` ejecutando código de PR.

Escaneos más costosos pueden correr programados, pero findings críticos siguen
bloqueando releases.

Dependency Review Action está activo en PR porque repositorio es público. Gates
complementarios usan Dependabot, lockfile, `npm audit` completo, Gitleaks 8.30.1
con binario/checksum fijados y `govulncheck v1.4.0` instalado vía `go install`
en el job `backend-quality`.

Dependabot vulnerability alerts y automated security fixes están habilitados en
settings del repositorio. Version updates quedan activas al publicar
`.github/dependabot.yml`.

## Job ci

Job final sin lógica de aplicación:

```txt
ci needs frontend-quality, backend-quality, migrations, security
ci uses if: always()
ci succeeds only if every required needs.<job>.result is success
```

Branch protection exige solo nombre estable `ci`. Internamente puede crecer sin
reconfigurar protección cada vez. Agregador siempre corre aunque dependencia
falle/cancele; trata `failure`, `cancelled` y `skipped` inesperado como fallo.
Jobs todavía no aplicables terminan explícitamente `success`, no se saltan a
nivel job.

## Branch protection

Configuración objetivo:

- PR requerido para `main`.
- Required check `ci`.
- Conversations resueltas.
- Force push y delete deshabilitados.
- Administradores no omiten reglas salvo emergencia documentada.
- Merge commit/squash se elige una vez y se mantiene consistente.

Si proyecto sigue con una sola persona, review humana obligatoria puede esperar;
CI y protección contra push directo no.

Estado actual: repositorio público, PR requerido, check `ci`, conversaciones
resueltas y linear history activos. Enforcement incluye administradores; force
push y delete están deshabilitados. Reviews humanas obligatorias permanecen en
cero mientras proyecto tenga una sola persona.

Strict branch freshness queda desactivado inicialmente para evitar reruns sin
valor. Se habilita merge queue o strict mode cuando haya PRs concurrentes.

## Flujo local equivalente

Comandos locales deben ser mismos que workflow. `Makefile` raíz ofrece entrypoint
coordinado con targets pequeños y transparentes:

```txt
make check
make check-frontend
make check-backend
make check-security
```

Targets muestran y ejecutan comandos ya documentados; no añaden lógica de
build. CI invoca mismos targets. No se necesita convertir repo en workspace JS.

Antes de push se ejecutan checks del área cambiada. Antes de merge se ejecuta
suite completa en CI limpio.

Pre-commit hooks pueden acelerar feedback, pero nunca son source of truth porque
pueden omitirse. CI es gate autoritativo mediante branch protection.

## Coverage

Baseline Fase 0 medido el 20 de julio de 2026: 2.87% statements, 1.91%
branches, 1.79% functions y 3.20% lines. Es bajo porque frontend existente nació
sin suite; se publica sin disfrazarlo ni inventar tests de bajo valor.

Política vigente desde el 20 de julio de 2026:

- Reportar coverage frontend/backend.
- Exigir mínimo global de 80% en statements, branches, functions y lines; Vitest
  falla y bloquea CI si cualquier métrica baja del umbral.
- No permitir caída no explicada aunque total permanezca sobre 80%.
- Exigir tests para código nuevo crítico.
- Elevar threshold progresivamente.
- Priorizar comportamiento observable, reglas de negocio, errores y límites; no
  usar snapshots masivos, assertions de estilos ni tests que solo ejecutan código.

Primera ampliación aplica 270 pruebas sobre stores, API mock, hooks, componentes,
navegación, formularios y páginas financieras. Resultado medido: 98.17%
statements, 93.32% branches, 96.74% functions y 99.20% lines. Componentes
dashboard sin ningún consumidor fueron eliminados en vez de añadir tests
artificiales.

Auth, ownership, dinero, idempotencia y migraciones no se aprueban solo por
porcentaje; necesitan casos explícitos de fallo.

## CD (decisión 2026-07-21: Vercel Services, no Cloud Run)

Este documento planeaba originalmente backend en Cloud Run con Workload
Identity Federation, Artifact Registry y rollout canary. Se decidió consolidar
frontend y backend en un solo proyecto Vercel usando
[Services](https://vercel.com/docs/services) en su lugar — ver
`docs/backend/04-operations.md` para la topología y el razonamiento completo.
Esto reemplaza toda la sección de CD backend enterprise de abajo: no hay
workflow GitHub Actions custom de deploy, no hay GCP, no hay WIF ni Artifact
Registry.

1. CI verde en `main` (`ci` agregador).
2. Vercel construye ambos servicios nativamente desde el mismo commit (git
   integration, sin workflow propio).
3. Backend se construye desde `backend/Dockerfile` (`runtime: container` en
   `vercel.json`); mismo binario/imagen serviría igual en Cloud Run u otro
   runtime de contenedores si Vercel Services deja de convenir.
4. Preview deployment automático por PR con ambos servicios juntos
   (full-stack), sin exponer secretos de producción (env vars de preview
   separadas de producción en el dashboard).
5. Deploy a producción automático en cada push a `main` — proyecto de uso
   personal, sin aprobación manual por ahora.
6. Smoke test post-deploy: `/healthz`, `/readyz`, `/v1/me` sin y con token.
7. Migraciones Goose corren como paso manual/separado, nunca desde el
   entrypoint del contenedor; nunca automáticas dentro del deploy de Vercel.
8. Rollback: re-promover el deployment anterior desde el dashboard de Vercel.

Secretos (`DATABASE_URL`, etc.) viven como variables de entorno "Sensitive" en
el dashboard de Vercel, con valores distintos entre Preview y Production.

## Estado de setup de Fase 0

1. Completado: baseline frontend y fallos previos resueltos.
2. Completado: Node/npm/Go fijados, TypeScript strict y scripts explícitos.
3. Completado: Vitest, Testing Library, pruebas iniciales y coverage.
4. Completado: `ci.yml`, Makefile, Gitleaks, npm audit y agregador fail-closed.
5. Completado: gate que congela `backend/` hasta módulo canónico.
6. Completado: Dependabot y fallback por Dependency Review no disponible.
7. Completado: repo público y branch protection con required check `ci`.
8. Completado: workflow ejecutado verde desde checkout remoto.
9. Completado Fase 1: módulo `github.com/aleonsa/budg/backend`, router `chi`,
   `GET /healthz`, tests `httptest`, suite Go/govulncheck activa en CI.

## Criterio de salida

- Checkout limpio reproduce frontend y backend localmente.
- CI TypeScript/Go/security pasa en PR desde checkout remoto.
- Required check `ci` no puede omitirse normalmente.
- Secret/dependency checks básicos están activos.
- Coverage frontend supera y aplica umbral global de 80%; backend inicia con
  100% en `internal/httpapi` y `0%` en `cmd/api` (entrada sin lógica testeable).
- Versiones de toolchain están fijadas.
- CD tiene estrategia de artefacto, permisos y environments documentada.
- No existe lógica backend nueva antes de baseline verde.
