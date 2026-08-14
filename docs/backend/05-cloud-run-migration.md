# Migración del backend: Vercel Services → Cloud Run

## Contexto y decisión (2026-08-14)

El backend corre hoy como Vercel Service (contenedor Go) bajo el modelo de
facturación **Fluid Compute**: se cobra CPU activa por request, y el plan Hobby
incluye **4 horas de CPU activa al mes**. Con el agente de chat en producción
(cada mensaje mantiene la instancia activa durante todo el stream SSE de
30–120s+) más los previews por PR con backend incluido, el team free
`alejandro-leons-projects` agotó el 100% del incluido y los proyectos quedan en
riesgo de pausa automática. Pro ($20/mes) es desproporcionado para el uso real
de la app.

Decisión: **el backend se muda a Cloud Run; el frontend se queda en Vercel**
(estático, costo cero, previews de frontend sin backend ya no queman CPU).
`docs/backend/04-operations.md` ya anticipaba esto: la imagen
`backend/Dockerfile` es portable y no asume plataforma — se redespliega sin
cambios de código Go.

Por qué Cloud Run y no otra cosa:

| Opción                 | Costo real                         | Veredicto                                           |
| ---------------------- | ---------------------------------- | --------------------------------------------------- |
| Vercel Pro             | $20/mes                            | 6x lo necesario; descartado                         |
| Cloud Run              | ~$0 (free tier 50h CPU activa/mes) | Elegido; scale-to-zero, contenedor ya existe        |
| VM e2-micro GCP        | $0 pero ops eterno                 | Descartado: TLS, systemd, updates, SSH              |
| VM cualquier proveedor | $5–7/mes                           | Descartado: pagas idle 24/7, peor que scale-to-zero |

Free tier de Cloud Run por mes: **2M requests, 180,000 vCPU-segundos,
360,000 GiB-segundos**. 180k vCPU-s = 50 horas de CPU activa — 12.5x lo que
Vercel Hobby incluía. Una estimación generosa (200 chats de agente/mes × 60s
CPU + tráfico API normal) consume <5% del free tier.

Nota: Cloud Run requiere **billing account habilitado** aunque el consumo
quede en $0. Se crea un budget alert de tripwire (ver sección Costos).

## Estado ejecutado (2026-08-14)

| Recurso           | Valor real                                                                   |
| ----------------- | ---------------------------------------------------------------------------- |
| Proyecto / número | `budg-505520` / `150836753552`                                               |
| Región            | `us-west1` (Supabase prod está en AWS `us-west-2`)                           |
| Artifact Registry | `us-west1-docker.pkg.dev/budg-505520/budg`                                   |
| Cloud Run         | `budg-api`, revisión `budg-api-00002-jmx`                                    |
| URL canónica      | `https://budg-api-6rdofbnp4q-uw.a.run.app`                                   |
| Runtime SA        | `budg-api-run@budg-505520.iam.gserviceaccount.com`                           |
| Deploy SA         | `budg-deployer@budg-505520.iam.gserviceaccount.com`                          |
| WIF               | `github-pool/github-provider`, limitado a `aleonsa/budg` + `refs/heads/main` |
| Secret Manager    | `budg-database-url`, `budg-openai-api-key`, `budg-agent-confirmation-secret` |
| Budget            | 100 MXN, alertas 50%/90%                                                     |

Smoke directo: `/readyz` → 200 (incluye conexión real a Supabase), `/v1/me`
sin JWT → 401. `/healthz` se intercepta con 404 por el proxy TLS local antes de
llegar a Cloud Run (no aparece en request logs); se valida desde GitHub Actions
durante cutover.

## Topología objetivo

```txt
Browser
  -> Vercel (frontend estático, mismo dominio que hoy)
       /v1/*, /healthz, /readyz  -> rewrite externo (proxy) -> Cloud Run budg-api
       /*                        -> Vite estático
  Cloud Run budg-api (contenedor Go, scale-to-zero, us-west1)
  -> Supabase Auth (JWT) y transaction pooler (Supavisor)  [sin cambios]
```

### Decisión de ruteo: proxy vía rewrite de Vercel (Opción A)

El `vercel.json` reescribe `/v1/*` a la URL pública de Cloud Run
(`https://budg-api-<hash>-<region>.a.run.app`). Los rewrites a URLs externas
son configuración de routing de Vercel — **no invocan funciones ni consumen
Fluid CPU** — y conservan las propiedades actuales:

- Frontend y backend siguen siendo **same-origin** para el navegador: CORS
  sigue siendo innecesario en producción (`backend.ts` sigue con base vacía,
  `VITE_API_BASE_URL` sigue sin setearse).
- Preview deployments de frontend funcionan sin config extra (cada dominio
  `*.vercel.app` hereda el rewrite).
- Cero cambios en el frontend.

Alternativa considerada (Opción B, fallback): apuntar el frontend directo a la
URL de `run.app` vía `VITE_API_BASE_URL` + `CORS_ALLOWED_ORIGINS` con el
dominio de Vercel. Ventaja: ningún intermediario para el stream SSE. Desventaja:
CORS/preflight en todo el tráfico, config por ambiente, y previews con dominio
distinto dejarían de funcionar sin lista dinámica de orígenes. **Solo se migra
a B si la validación de streaming del cutover falla** (ver Cutover).

Riesgo conocido de A: el proxy de Vercel debe transmitir el stream SSE sin
buffering. Validación explícita en el cutover; rollback instantáneo (revert del
commit de `vercel.json`).

## Infraestructura GCP a crear

Todo en un proyecto GCP dedicado (`budg-505520`), para aislar billing y IAM del
resto de la cuenta:

| Recurso                 | Nombre propuesto                                                                                       | Propósito                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Proyecto                | `budg-505520`                                                                                          | Contenedor de todo                                 |
| Billing account         | existente, vinculada                                                                                   | Requerido para Cloud Run; budget alert de tripwire |
| APIs                    | `run`, `artifactregistry`, `secretmanager`, `iamcredentials`, `cloudbuild` (solo primer deploy manual) | Mínimas                                            |
| Artifact Registry       | repo `budg`, formato docker, misma región que Cloud Run                                                | Imágenes del backend                               |
| Secret Manager          | `budg-database-url`, `budg-openai-api-key`, `budg-agent-confirmation-secret`                           | Secretos del runtime                               |
| Service account runtime | `budg-api-run@budg-505520.iam.gserviceaccount.com`                                                     | Identidad del servicio; lector de secretos         |
| Service account deploy  | `budg-deployer@budg-505520.iam.gserviceaccount.com`                                                    | Solo para CI (GitHub Actions)                      |
| WIF pool/provider       | `github-pool` / `github-provider`                                                                      | OIDC de GitHub Actions sin llaves estáticas        |
| Cloud Run service       | `budg-api`                                                                                             | El backend                                         |

Región: **la misma que el proyecto Supabase de producción** (ver Dashboard →
Settings → General → Region; p.ej. `aws-us-east-1` → región GCP `us-east1`).
La latencia API↔DB domina sobre la latencia browser↔API.

## Paso a paso

Placeholders: `<PROJECT_ID>` = id del proyecto GCP, `<REGION>` = región
elegida, `<SUPABASE_PROJECT_REF>` = ref del proyecto Supabase prod. Todos los
comandos asumen `gcloud` autenticado (`gcloud auth login`) con permisos de
owner en el billing account.

### 1. Proyecto y APIs

```bash
gcloud projects create budg-505520 --name="budg"
gcloud billing projects link budg-505520 --billing-account=015CFE-584F6C-C25E22
gcloud config set project budg-505520

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  cloudbuild.googleapis.com
```

`cloudbuild` solo se usa para el primer build manual; los deploys de CI compilan
con docker en el runner de GitHub (gratis) y hacen push directo a Artifact
Registry. `gcloud run deploy --source` no respetó este Dockerfile y usó
buildpacks (falló con `unable to find a valid buildable`), por eso el flujo
canónico compila la imagen explícitamente.

### 2. Artifact Registry

```bash
gcloud artifacts repositories create budg \
  --repository-format=docker \
  --location=<REGION> \
  --description="budg backend images"
```

### 3. Secret Manager

Vercel devuelve `[SENSITIVE]` al hacer `vercel env pull`; esos valores no son
recuperables. `DATABASE_URL` se reconstruyó con el role runtime y pooler de
Supabase prod, la key de OpenAI se obtuvo del gestor original y el secret de
confirmación se generó nuevo:

```bash
# DATABASE_URL: transaction pooler (6543) del proyecto prod, con
# sslmode=verify-full&sslrootcert=/app/certs/supabase-root-2021-ca.pem
# — idéntica a la que Vercel tiene hoy (ver docs/backend/04-operations.md).
printf '%s' "<DATABASE_URL_CON_SSLROOTCERT>" |
  gcloud secrets create budg-database-url --data-file=-

printf '%s' "<OPENAI_API_KEY>" |
  gcloud secrets create budg-openai-api-key --data-file=-

# >= 16 chars. OBLIGATORIO setearlo estable: con scale-to-zero el proceso
# reinicia constantemente, y con max-instances=2 un request puede caer en
# otra instancia — un secreto efímero invalidaría confirmaciones pendientes
# del agente en cada cold start (ver config.go AgentConfig).
openssl rand -base64 32 |
  gcloud secrets create budg-agent-confirmation-secret --data-file=-
```

El CA root de Supabase no va en Secret Manager: ya vive en la imagen
(`backend/certs/supabase-root-2021-ca.pem` → `/app/certs/...`), es público y
está versionado.

### 4. Service accounts e IAM

```bash
# Runtime: identidad del servicio, sin privilegios extra
gcloud iam service-accounts create budg-api-run \
  --display-name="budg-api runtime"

# Solo puede leer los 3 secretos, nada más
for SECRET in budg-database-url budg-openai-api-key budg-agent-confirmation-secret; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:budg-api-run@budg-505520.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# Deploy: la usa GitHub Actions vía WIF
gcloud iam service-accounts create budg-deployer \
  --display-name="budg CI deployer"

gcloud projects add-iam-policy-binding budg-505520 \
  --member="serviceAccount:budg-deployer@budg-505520.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding budg-505520 \
  --member="serviceAccount:budg-deployer@budg-505520.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
# Deploy necesita fijar la SA del servicio en cada deploy:
gcloud iam service-accounts add-iam-policy-binding \
  budg-api-run@budg-505520.iam.gserviceaccount.com \
  --member="serviceAccount:budg-deployer@budg-505520.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### 5. Workload Identity Federation (GitHub Actions sin llaves)

```bash
gcloud iam workload-identity-pools create github-pool \
  --location="global" \
  --display-name="GitHub Actions pool"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location="global" \
  --workload-identity-pool=github-pool \
  --display-name="budg GitHub" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == 'aleonsa/budg' && assertion.ref == 'refs/heads/main'"
```

Permitir que solo el Environment `production` impersonalice a `budg-deployer`:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  budg-deployer@budg-505520.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/150836753552/locations/global/workloadIdentityPools/github-pool/attribute.repository/aleonsa/budg"
```

(`gcloud projects describe budg-505520 --format='value(projectNumber)'` para el
número.) El provider también fija `refs/heads/main`; una PR no puede obtener
credenciales de deploy aunque modifique su workflow.

### 6. Primer deploy (manual, desde `main` verde)

```bash
cd backend
gcloud builds submit . \
  --project=budg-505520 \
  --region=us-west1 \
  --tag=us-west1-docker.pkg.dev/budg-505520/budg/backend:<GIT_SHA>

gcloud run deploy budg-api \
  --image=us-west1-docker.pkg.dev/budg-505520/budg/backend:<GIT_SHA> \
  --project=budg-505520 \
  --region=us-west1 \
  --service-account=budg-api-run@budg-505520.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --port=8080 \
  --timeout=300 \
  --min-instances=0 \
  --max-instances=2 \
  --cpu-boost \
  --set-secrets="DATABASE_URL=budg-database-url:latest,OPENAI_API_KEY=budg-openai-api-key:latest,AGENT_CONFIRMATION_SECRET=budg-agent-confirmation-secret:latest" \
  --set-env-vars="APP_ENV=production,LOG_LEVEL=info,CORS_ALLOWED_ORIGINS=http://localhost:5173,SUPABASE_JWT_ISSUER=https://mqnzxvspyehkrrtekppm.supabase.co/auth/v1,SUPABASE_JWKS_URL=https://mqnzxvspyehkrrtekppm.supabase.co/auth/v1/.well-known/jwks.json,SUPABASE_JWT_AUDIENCE=authenticated"
```

Racional de cada flag:

| Flag                      | Valor                 | Por qué                                                                                                                  |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `--allow-unauthenticated` | —                     | El backend ya autentica con JWT de Supabase (`internal/auth`); `/healthz` debe ser público para el proxy y el smoke test |
| `--timeout`               | `300`                 | El agente streamea hasta 120s+ (AGENT_TIMEOUT_SECONDS=60 + tool calls); margen holgado. Vercel Services daba menos       |
| `--min-instances`         | `0`                   | Scale-to-zero = $0 en idle; cold start ~2–4s aceptable para uso personal                                                 |
| `--max-instances`         | `2`                   | Cota dura de conexiones: MaxConns=4 del pgxpool × 2 instancias = 8 conexiones máx contra el pooler de Supabase           |
| `--cpu-boost`             | —                     | Acelera cold start; sin costo extra con billing por request                                                              |
| `--set-env-vars` CORS     | localhost             | Igual que hoy: defensa en profundidad para dev local; en prod el tráfico es same-origin vía proxy                        |
| Billing CPU               | por request (default) | Misma semántica que Fluid: CPU solo mientras hay request en vuelo, incluido el stream                                    |

`PORT` lo inyecta Cloud Run (default 8080, igual que el contenedor espera).
El graceful shutdown por SIGTERM ya implementado en `cmd/api/main.go` encaja
con el grace period de Cloud Run.

Deploy inicial desde un Apple Silicon local (alternativa a Cloud Build):

```bash
docker build --platform=linux/amd64 -t us-west1-docker.pkg.dev/budg-505520/budg/backend:manual-$(git rev-parse --short HEAD) .
docker push us-west1-docker.pkg.dev/budg-505520/budg/backend:manual-...
gcloud run deploy budg-api --image=<...>  # + mismos flags
```

### 7. Smoke test directo contra Cloud Run (antes de tocar Vercel)

```txt
GET https://budg-api-<hash>-<REGION>.a.run.app/healthz -> 200
GET https://budg-api-<hash>-<REGION>.a.run.app/readyz  -> 200
GET .../v1/me sin token    -> 401
GET .../v1/me con token    -> 200
POST .../v1/agent/chat con token -> stream SSE visible (validar ~60s)
```

Si el stream SSE funciona directo y `readyz` verifica el pool de DB contra
Supabase, la infra está sana.

### 8. Cambios en el repo

**`vercel.json`** — quitar solo el service backend, conservar el service
frontend y dejar el proxy externo:

```json
{
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  },
  "services": {
    "frontend": {
      "root": "frontend",
      "framework": "vite",
      "installCommand": "sh scripts/vercel-install.sh",
      "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
    }
  },
  "rewrites": [
    {
      "source": "/v1/(.*)",
      "destination": "https://budg-api-6rdofbnp4q-uw.a.run.app/v1/$1"
    },
    {
      "source": "/healthz",
      "destination": "https://budg-api-6rdofbnp4q-uw.a.run.app/healthz"
    },
    {
      "source": "/readyz",
      "destination": "https://budg-api-6rdofbnp4q-uw.a.run.app/readyz"
    },
    { "source": "/(.*)", "destination": { "service": "frontend" } }
  ]
}
```

- `services.backend` se elimina; `services.frontend` sigue igual, así no hay
  cambio de Root Directory ni del instalador de Vercel.
- Los previews quedan frontend-only, pero sus rewrites hablan contra API prod.
  No probar mutaciones destructivas desde una rama experimental; desarrollo
  integrado sigue siendo local (`make dev-up`).
- La URL de Cloud Run es fija y estable — sin hash por deploy — así que este
  archivo no cambia en cada release.

**`.github/workflows/migrate-prod.yml`** — añadir deploy Cloud Run antes del
Deploy Hook. El hook se conserva porque ahora construye solo el frontend; las
migraciones siguen precediendo ambos deploys:

```yaml
- name: Authenticate to GCP (WIF)
  uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3
  with:
    workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
    service_account: ${{ vars.GCP_DEPLOYER_SA }}

- name: Build and push image (once, by digest)
  run: |
    IMAGE_REPOSITORY="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/budg/backend"
    IMAGE="${IMAGE_REPOSITORY}:${DEPLOY_SHA}"
    gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
    docker build --platform=linux/amd64 --tag "${IMAGE}" backend
    docker push "${IMAGE}"
    DIGEST="$(gcloud artifacts docker images describe "${IMAGE}" --format='value(image_summary.digest)')"
    echo "BACKEND_IMAGE=${IMAGE_REPOSITORY}@${DIGEST}" >> "${GITHUB_ENV}"

- name: Deploy to Cloud Run (promote by digest)
  run: |
    gcloud run deploy budg-api \
      --project="${GCP_PROJECT_ID}" \
      --region="${GCP_REGION}" \
      --image="${BACKEND_IMAGE}" \
      --quiet

- name: Smoke test
  run: |
    URL="$(gcloud run services describe budg-api --region="${GCP_REGION}" --format='value(status.url)')"
    curl --fail "${URL}/healthz"; curl --fail "${URL}/readyz"
    test "$(curl -s -o /dev/null -w '%{http_code}' "${URL}/v1/me")" = "401"
```

Secretos nuevos en el GitHub Environment `production`:
`GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`, `GCP_PROJECT_ID`, `GCP_REGION` quedaron
como variables del GitHub Environment `production` (nada sensible — la
autenticación es por OIDC efímero). `VERCEL_DEPLOY_HOOK_URL` se conserva para
desplegar el frontend después de Cloud Run.

`MIGRATIONS_DATABASE_URL`, Goose y todo el gate de migraciones quedan
intactos: Cloud Run no ejecuta migraciones en su entrypoint (igual que
Vercel); Goose sigue siendo paso separado en el mismo workflow, antes del
deploy.

**`Makefile`** (opcional, para deploys manuales): targets `deploy-api-build`,
`deploy-api-push`, `deploy-api-release` replicando los pasos del workflow con
`DIGEST` explícito.

### 9. Cutover (orden sin downtime)

1. Infra GCP creada y `budg-api` desplegado desde el SHA de `main` vigente en
   producción (mismo código que sirve Vercel hoy — schema ya migrado).
2. Smoke test directo (paso 7) verde, incluido SSE.
3. PR con el `vercel.json` nuevo + workflow nuevo → merge. El workflow
   redeploya la misma imagen (no-op funcional) y Vercel redespliega el
   frontend con el rewrite externo.
4. Validar por el dominio de Vercel: `/healthz`, login, y **un chat completo
   del agente streameando por el proxy** (el riesgo de buffering de SSE vive
   aquí).
5. Verde → borrar del proyecto Vercel las variables del servicio backend
   (`DATABASE_URL`, `OPENAI_API_KEY`, `AGENT_CONFIRMATION_SECRET`, JWT config):
   dejar de residir secretos en dos plataformas.
6. Verificar en el dashboard Vercel que el usage de Fluid Active CPU dejó de
   crecer (solo debería registrar el resto de métricas, ~0).

**Rollback** en cualquier punto: revert del commit de `vercel.json` → el
dominio vuelve a enrutar al servicio backend de Vercel (mientras no se hayan
borrado sus env vars; por eso el paso 5 es el último). Cloud Run puede pausarse
con `gcloud run services update budg-api --no-allow-unauthenticated` si se
necesita cortar acceso público.

Si el paso 4 (SSE por proxy) falla por buffering: activar Opción B — setear
`VITE_API_BASE_URL` (Production) a la URL de Cloud Run, `CORS_ALLOWED_ORIGINS`
en Cloud Run con el dominio Vercel, y quitar los rewrites de API del
`vercel.json`. Es un cambio de config puro, sin código.

### 10. Costos y monitoreo

| Recurso                   | Free tier mensual   | Uso estimado budg          |
| ------------------------- | ------------------- | -------------------------- |
| Cloud Run requests        | 2M                  | miles                      |
| Cloud Run vCPU-s (activa) | 180,000 (~50h)      | <10,000 (≈5%)              |
| Cloud Run GiB-s           | 360,000             | «                          |
| Artifact Registry         | 0.5 GB              | imagen ~15MB × ~10 tags    |
| Secret Manager            | 6 versiones activas | 3                          |
| Cloud Build               | 2,500 min/día       | solo deploy manual inicial |
| Vercel                    | $0                  | frontend estático          |

Budget alert de tripwire:

```bash
gcloud billing budgets create \
  --billing-account=015CFE-584F6C-C25E22 \
  --display-name="budg-prod tripwire" \
  --budget-amount=100MXN \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9
```

Cualquier correo de este budget = algo mal configurado (p.ej. `min-instances`
subido por accidente), no uso normal.

Logs: `gcloud beta run services logs read budg-api --region=us-west1` o
Logs Explorer; el backend ya loguea con `slog` estructurado a stdout/stderr.
Métricas útiles: `run.googleapis.com/request_count`,
`container/cpu/utilizations`, `run.googleapis.com/instance_count` (confirmar
que escala a 0 en idle).

## Checklist de migración

- [x] Proyecto GCP + billing + APIs.
- [x] Artifact Registry en la misma región que Supabase prod.
- [x] 3 secretos en Secret Manager (DATABASE_URL con `sslrootcert` apuntando
      al path dentro del contenedor; AGENT_CONFIRMATION_SECRET estable y
      compartido).
- [x] SAs `budg-api-run` (solo secretAccessor) y `budg-deployer` (run.admin,
      AR writer, serviceAccountUser).
- [x] WIF pool/provider con `attribute-condition` que fija repo + main.
- [x] Deploy manual verde + smoke directo de DB/auth; falta validar SSE con JWT.
- [ ] PR: `vercel.json` sin service backend + rewrite externo.
- [x] Workflow preparado para Cloud Run; vars OIDC en Environment `production`.
- [ ] Validación por dominio Vercel incl. chat de agente streameado.
- [ ] Env vars del backend borradas de Vercel.
- [ ] Fluid Active CPU plano en dashboard Vercel.
- [x] Budget alert creado (100 MXN, 50%/90%).
- [ ] Actualizar `docs/backend/04-operations.md` (topología, flujo de deploy,
      checklist) para reflejar el estado post-migración.

## Qué NO cambia

- Supabase (auth, DB, pooler): cero cambios; misma DATABASE_URL.
- Migraciones Goose y su gating en `migrate-prod.yml`.
- Código Go: ningún cambio; la imagen es la misma.
- Dominio del frontend y Supabase client config.
- Smoke tests semánticos (healthz/readyz/me), solo cambia el host inicial.
