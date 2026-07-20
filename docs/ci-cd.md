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
- `npm run lint` con Oxlint.
- `npm run build`, que ejecuta TypeScript y Vite.

Frontend todavía no tiene scripts separados de typecheck, format o tests, y sus
tsconfig no declaran `strict: true`. Oxlint actual puede terminar exitosamente
con warnings; Fase 0 debe resolverlos o registrar baseline antes de convertir
warnings nuevos en fallo. No existe configuración GitHub Actions. Backend nuevo
todavía no tiene baseline canónico.

## Archivos planeados

```txt
.github/
  workflows/
    ci.yml
    deploy-frontend.yml       # se activa al elegir hosting
    deploy-backend.yml        # se activa al crear Cloud Run
  dependabot.yml
Makefile                       # entrypoint local/CI, sin ocultar comandos
docs/
  development-rules.md
  ci-cd.md
frontend/
  package.json
  package-lock.json
  test setup                  # Vitest + Testing Library
backend/
  go.mod                       # creado y activado en Fase 1
  go.sum
```

No se crean workflows de deploy falsos antes de existir destino. Fase 0 deja
CI frontend/security activo, gate Go definido y estrategia CD documentada.
Workflows de deploy se agregan cuando infraestructura correspondiente existe.

## Toolchains reproducibles

Durante setup se fijan, no se adivinan:

- Node compatible con Vite actual, registrado en `engines` y archivo de versión.
- npm correspondiente y `package-lock.json` versionado.
- Versión Go objetivo fijada en CI; Fase 1 la declara en `go.mod` y Fase 9 fija
  misma versión en Dockerfile.
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
workflow_dispatch
```

Política:

- Permisos default `contents: read`.
- Sin secretos para validación de PR.
- `concurrency` cancela ejecución anterior de misma rama.
- Jobs corren en paralelo cuando son independientes.
- Monorepo pequeño ejecuta frontend siempre. Gate backend comprueba que no haya
  `.go` nuevo antes del módulo canónico; desde Fase 1 ejecuta suite Go completa.
  Optimización por paths se evalúa solo si tiempo/costo lo justifican.
- Un job agregador estable `ci` depende de todos y se configura como required
  check para branch protection.

## Job frontend-quality

Working directory: `frontend/`.

Orden planeado:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Fase 0 agrega scripts explícitos:

- `typecheck`: TypeScript sin emitir.
- `format` y `format:check`: formatter elegido y fijado.
- `test` y `test:coverage`: Vitest.
- Testing Library para comportamiento React, no snapshots masivos.
- `strict: true` explícito en configs de aplicación y tooling.
- `build`: solo Vite; typecheck queda como gate separado sin ejecutarse dos veces.

Build no sustituye typecheck separado: ambos permanecen visibles en CI. Warnings
Oxlint existentes se resuelven o registran y luego warnings nuevos fallan CI.

## Job backend-quality

Working directory: `backend/`.

Orden planeado:

```bash
test -z "$(gofmt -l .)"
go mod verify
go vet ./...
go test -race -coverprofile=coverage.out ./...
go build ./cmd/api
```

`gofmt -l` solo detecta en CI; developer ejecuta `gofmt -w`. Coverage se publica
como artefacto/resumen.

Fase 0 configura job, pero no finge build sin código. Mientras módulo canónico
no exista, job falla si detecta nuevos `.go` destinados al backend y reporta
`backend not initialized`; de otro modo termina verde. Fase 1 reemplaza
experimento ignorado, crea `go.mod`, `/healthz` y tests en mismo cambio que
activa comandos completos. Ninguna línea Go nueva entra sin gate Go.

## Job migrations

Se agrega en Fase 2 cuando existe primera migración:

1. Arrancar Supabase local descartable con versión fijada.
2. Crear rol runtime de prueba.
3. Ejecutar `goose validate`.
4. Ejecutar `goose up`.
5. Ejecutar integración Go y pruebas de aislamiento.
6. Ejecutar `goose down-to 0` solo en DB descartable.
7. Ejecutar `goose up` otra vez.

Nunca apunta a development compartido ni production. CI no recibe credenciales
production.

## Job security

Gates mínimos:

- Secret scan del diff y repositorio.
- Dependency review para nuevas dependencias cuando plan GitHub lo soporte.
- `govulncheck` para código Go alcanzable.
- Audit de dependencias npm runtime.
- Actions sin permisos de escritura innecesarios.
- Ningún workflow `pull_request_target` ejecutando código de PR.

Escaneos más costosos pueden correr programados, pero findings críticos siguen
bloqueando releases.

Dependency Review Action requiere repositorio público o GitHub Code
Security/GHAS en repositorio privado. Fase 0 detecta capacidad. Si no existe,
usa Dependabot alerts, revisión de lockfile y audits, documentando control
reducido sin bloquear CI por feature no disponible.

## Job ci

Job final sin lógica de aplicación:

```txt
ci needs frontend-quality, backend-quality, security
ci also needs migrations cuando exista
ci uses if: always()
ci succeeds only if every required needs.<job>.result is success
```

Branch protection exige solo nombre estable `ci`. Internamente puede crecer sin
reconfigurar protección cada vez. Agregador siempre corre aunque dependencia
falle/cancele; trata `failure`, `cancelled` y `skipped` inesperado como fallo.
Jobs todavía no aplicables terminan explícitamente `success`, no se saltan a
nivel job.

## Branch protection

Cuando remoto GitHub exista:

- PR requerido para `main`.
- Required check `ci`.
- Conversations resueltas.
- Force push y delete deshabilitados.
- Administradores no omiten reglas salvo emergencia documentada.
- Merge commit/squash se elige una vez y se mantiene consistente.

Si proyecto sigue con una sola persona, review humana obligatoria puede esperar;
CI y protección contra push directo no.

Strict branch freshness queda desactivado inicialmente para evitar reruns sin
valor. Se habilita merge queue o strict mode cuando haya PRs concurrentes.

## Flujo local equivalente

Comandos locales deben ser mismos que workflow. `Makefile` raíz ofrece entrypoint
coordinado con targets pequeños y transparentes:

```txt
make check
make check-frontend
make check-backend
```

Targets muestran y ejecutan comandos ya documentados; no añaden lógica de
build. CI invoca mismos targets. No se necesita convertir repo en workspace JS.

Antes de push se ejecutan checks del área cambiada. Antes de merge se ejecuta
suite completa en CI limpio.

Pre-commit hooks pueden acelerar feedback, pero nunca son source of truth porque
pueden omitirse. CI sí es gate.

## Coverage

Fase 0 mide baseline. No se inventa porcentaje que obligue a escribir tests sin
valor para frontend existente.

Política inicial:

- Reportar coverage frontend/backend.
- No permitir caída no explicada.
- Exigir tests para código nuevo crítico.
- Fijar threshold por paquete/capa después de baseline.
- Elevar threshold progresivamente.

Auth, ownership, dinero, idempotencia y migraciones no se aprueban solo por
porcentaje; necesitan casos explícitos de fallo.

## CD frontend

Se activa al elegir Cloudflare Pages o Vercel:

1. CI verde.
2. Construir bundle por ambiente desde SHA aprobado, porque variables `VITE_*`
   se embeben en build; ejecutar mismos gates antes del deploy.
3. Preview por PR si plataforma lo soporta sin exponer secretos sensibles.
4. Deploy production desde `main` y environment protegido.
5. Smoke test de carga/rutas.
6. Rollback a deployment anterior documentado.

## CD backend

Se activa en Fase 9:

1. CI completo verde.
2. Construir una vez imagen multi-stage desde SHA verde.
3. Escanear imagen y publicar por digest/SHA en Artifact Registry.
4. Autenticar GitHub con Workload Identity Federation/OIDC; no JSON key larga.
5. Condicionar provider por repositorio y ref/environment confiable; permisos
   job `contents: read` e `id-token: write` solamente.
6. Usar service accounts separadas para publicar/desplegar y migrar DB, sin
   roles básicos Owner/Editor.
7. Ejecutar Goose expand migration como job único y separado.
8. Desplegar nueva revisión Cloud Run sin todo tráfico cuando cambio sea riesgoso.
9. Ejecutar `/healthz`, `/readyz` y smoke auth/API.
10. Mover tráfico y observar métricas.
11. Ejecutar contract migration solo cuando revisiones viejas estén retiradas.

Production usa GitHub Environment con aprobación manual inicialmente. Auto
deploy puede evaluarse cuando rollback y observabilidad estén probados.

Workflow production usa `concurrency` exclusiva con `cancel-in-progress: false`.
Solo ese workflow ejecuta migraciones, con timeout acotado y una identidad de
migración. Antes de migrar verifica backup/PITR disponible. Fallo de Goose corta
pipeline antes del deploy. Esta serialización es obligatoria; no asumimos que
Goose resuelva carreras entre dos despliegues.

## Orden de setup de Fase 0

1. Medir baseline actual frontend: install, lint y build.
2. Resolver fallos existentes o registrarlos antes de endurecer gates.
3. Fijar Node/npm, habilitar `strict: true` y agregar scripts
   format/typecheck/test.
4. Instalar/configurar Vitest y primeras pruebas de infraestructura crítica.
5. Crear `ci.yml`, Makefile raíz, security checks y coverage frontend.
6. Definir gate Go que impide código nuevo hasta módulo canónico.
7. Configurar Dependabot y capacidad real de dependency review.
8. Crear remoto/protección de branch si falta.
9. Obtener CI frontend/security verde desde checkout limpio.
10. En Fase 1, crear módulo + `/healthz` + tests y activar suite Go en mismo PR.

## Criterio de salida

- Checkout limpio reproduce frontend.
- CI TypeScript/security pasa en PR y `main`.
- Gate Go está definido y bloquea código antes de activación en Fase 1.
- Checks required no pueden omitirse normalmente.
- Secret/dependency checks básicos están activos.
- Coverage frontend baseline queda visible; backend comienza en Fase 1.
- Versiones de toolchain están fijadas.
- CD tiene estrategia de artefacto, permisos y environments documentada.
- No existe lógica backend nueva antes de baseline verde.
