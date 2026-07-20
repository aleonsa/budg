# Plan maestro del backend

## Estado y alcance

Este documento gobierna la construcción del backend de `budg`. El frontend en
`frontend/` es la referencia funcional y visual. Sus tipos son un punto de
partida, no una obligación de conservar decisiones incorrectas.

El contenido actual de `backend/` se considera experimental y no participa en
este diseño. Cuando comience la implementación se decidirá explícitamente qué
archivos se reemplazan. Este plan no modifica código Go.

Documentos de apoyo:

- [Reglas de desarrollo](development-rules.md)
- [Plan de CI/CD](ci-cd.md)
- [Fase 0: entorno y decisiones](backend/00-environment.md)
- [Fundación y primer endpoint](backend/01-foundation.md)
- [Modelo de datos y migraciones](backend/02-database.md)
- [Contrato HTTP y fases de API](backend/03-api-roadmap.md)
- [Despliegue y operación](backend/04-operations.md)
- [Contrato HTTP detallado](api-contract.md)

## Objetivo

Construir una API pequeña, segura y fácil de explicar línea por línea:

- Go para el servicio.
- `chi` para rutas y middleware.
- Supabase Auth para identidad.
- Supabase PostgreSQL para persistencia.
- SQL versionado para migraciones.
- Cloud Run para ejecución serverless.
- React/Vite existente como cliente principal.

No buscamos arquitectura empresarial. Buscamos un monolito modular con pocas
dependencias, flujo HTTP visible y decisiones financieras explícitas.

## Principios

1. Una fase entrega un corte vertical verificable.
2. Cada dependencia debe resolver un problema concreto.
3. SQL permanece visible; no se usa ORM inicialmente.
4. No se crean capas, interfaces o abstracciones antes de necesitarlas.
5. Cada consulta financiera incluye el usuario autenticado.
6. Dinero usa enteros en centavos; nunca `float`.
7. Fechas financieras usan `date`; eventos técnicos usan `timestamptz`.
8. Migraciones desplegadas son inmutables.
9. El proceso de la API nunca ejecuta migraciones al arrancar.
10. Cada fase documenta conceptos, código, pruebas y comandos antes de avanzar.
11. `main` permanece verde; CI completo es requisito de merge.

## Stack decidido

| Área | Elección | Motivo |
| --- | --- | --- |
| Lenguaje | Go | Binario pequeño, inicio rápido, biblioteca HTTP sólida |
| Router | `github.com/go-chi/chi/v5` | API mínima sobre `net/http`, middleware composable |
| HTTP | `net/http` | Mantener visibles fundamentos de Go |
| PostgreSQL | Supabase Postgres | Servicio administrado y compatible con SQL estándar |
| Driver | `github.com/jackc/pgx/v5/pgxpool` | Driver PostgreSQL idiomático y pool configurable |
| Migraciones | `github.com/pressly/goose/v3` CLI + SQL | `Up` y `Down` juntos, sin acoplar migraciones al binario |
| Auth | Supabase Auth + JWT asimétrico verificado por API | Identidad administrada; autorización sigue en Go |
| Logs | `log/slog` | Biblioteca estándar, salida estructurada |
| Pruebas | `testing`, `httptest` | Sin framework adicional al inicio |
| Empaque | Docker multi-stage | Artefacto reproducible para Cloud Run |
| Hosting | Google Cloud Run | Escala a cero y ejecuta servicio HTTP Go normal |

No se incorporan por ahora ORM, framework de inyección, generador OpenAPI,
Redis, cola, microservicios, GraphQL ni Kubernetes.

## Arquitectura objetivo

```txt
Navegador
  -> React/Vite
  -> Supabase Auth: login y refresh de sesión
  -> Authorization: Bearer <access token>
  -> Cloud Run: API Go + chi
       -> middleware de request ID, logs, CORS y recuperación
       -> middleware de autenticación
       -> handlers HTTP
       -> consultas SQL con pgxpool
  -> Supabase PostgreSQL
```

Supabase Auth responde quién es el usuario. La API decide qué puede leer o
modificar. El `user_id` siempre nace del claim `sub`; nunca del body, query o
path enviado por el cliente.

## Estructura Go planeada

```txt
backend/
  cmd/
    api/
      main.go                 # composición y ciclo de vida del proceso
  internal/
    auth/
      middleware.go           # validación JWT y usuario en context
    config/
      config.go               # variables de entorno tipadas
    httpapi/
      router.go               # rutas y middleware
      health.go               # /healthz y /readyz
      errors.go               # respuesta de error canónica
      categories.go           # handlers; se agrega en su fase
    store/
      postgres.go             # creación y cierre de pgxpool
      categories.go           # SQL; se agrega en su fase
  migrations/                 # un archivo SQL Goose por cambio
  .env.example                # nombres y ejemplos no secretos
  Dockerfile
  go.mod
  go.sum
```

La estructura crecerá por necesidad. No habrá inicialmente directorios
`service`, `repository`, `domain`, `pkg` ni `utils`. Si una fase demuestra que
una regla necesita una capa de servicio, se agrega y se documenta entonces.

## Roadmap

### Fase 0: gobierno, CI/CD y entorno

Objetivo: fijar reglas, automatización, herramientas y ambientes antes de
escribir lógica backend.

Entregables:

- Documentación actual revisada.
- Reglas de desarrollo versionadas y Definition of Done común.
- CI frontend/security verde y gate Go definido antes de código backend.
- Toolchains, lockfiles y GitHub Actions fijados.
- Branch protection exige check estable `ci`, PR y linear history.
- Estrategia CD, artefactos, permisos y environments definida.
- Destino Cloud Run documentado; proyecto GCP se crea en Fase 9.
- Versiones Node/npm y versión Go objetivo registradas.
- Variables de entorno nombradas, sin secretos en Git.

Detalle ejecutable: [Fase 0: entorno y decisiones](backend/00-environment.md).

Criterio de salida: checkout limpio obtiene frontend/security verde, gate Go
rechaza código prematuro y branch protection exige `ci`; cualquier persona puede
explicar reglas, topología, límites de seguridad y orden de implementación.

### Fase 1: proceso HTTP mínimo

Objetivo: arrancar un servidor Go con `chi` y probarlo sin DB ni auth.

Entregables:

- Módulo Go limpio.
- Gate backend CI activado en mismo cambio.
- Configuración de puerto y timeouts.
- `GET /healthz`.
- Prueba con `httptest`.
- Apagado ordenado ante `SIGINT`/`SIGTERM`.
- Logs estructurados de inicio y cierre.

Criterio de salida: `gofmt`, `go vet`, `go test -race`, build, CI y petición real
pasan.

### Fase 2: PostgreSQL y migraciones

Objetivo: conectar Supabase de forma segura y aplicar primera migración.

Entregables:

- `pgxpool` con límites conservadores.
- Proyecto Supabase development y estrategia local/hosted elegidos.
- Versiones Docker, Supabase CLI y Goose fijadas.
- CLI de migraciones documentada.
- Bootstrap reproducible del rol runtime `budg_api`.
- Primera tabla: `categories`.
- `GET /readyz` que comprueba DB con timeout corto.
- Prueba de migración `up`, `down-to 0`, `up` en DB local descartable.

Criterio de salida: esquema puede reconstruirse desde cero sin SQL manual.

### Fase 3: identidad

Objetivo: sustituir confianza implícita por identidad Supabase verificable.

Entregables:

- Validación de firma, issuer, audience y expiración del JWT.
- Signing key asimétrica y JWKS de Supabase confirmados; no se acepta HS256.
- Usuario tipado guardado en `request.Context()`.
- `GET /v1/me` protegido.
- Supabase Auth real conectado en frontend, incluido refresh de sesión.
- CORS local configurado para requests con `Authorization`.
- Casos de prueba: token ausente, inválido, expirado y válido.

Criterio de salida: ningún handler protegido acepta identidad enviada por el
cliente. Browser puede completar preflight y enviar token renovado.

### Fase 3.5: onboarding mínimo

Objetivo: asegurar estado inicial útil antes de reemplazar categorías mock.

Entregables:

- `POST /v1/onboarding`, protegido e idempotente.
- Categorías sistémicas insertadas por usuario dentro de una transacción.
- Llamada frontend después del primer login válido.
- Repetir request no duplica categorías ni modifica personalizaciones.

Criterio de salida: usuario nuevo puede abrir categorías sin recibir una app
vacía e irrecuperable.

### Fase 4: primer recurso vertical, categorías

Objetivo: recorrer router, auth, handler, SQL, DB y frontend con el recurso más
simple.

Entregables:

- `GET /v1/categories` ordenado por `sort_order, id`.
- Toda consulta filtrada por `user_id`.
- Prueba de aislamiento entre dos usuarios.
- Cliente frontend real para categorías, con validación de respuesta.
- Estados loading, error y vacío verificados en UI.

Criterio de salida: frontend deja de leer categorías mock sin afectar demás
recursos mock.

### Fase 5: cuentas

Objetivo: persistir cuentas y preparar datos requeridos por dashboard.

Entregables:

- Migración de `accounts`.
- `GET /v1/accounts`.
- Validación por tipo debit/credit.
- Tratamiento explícito de moneda y snapshots de saldo.
- Integración frontend aislada.

### Fase 6: transacciones de lectura

Objetivo: exponer historial filtrable y paginado.

Entregables:

- Migración de `transactions`.
- `GET /v1/transactions` con filtros y cursor.
- Índice que soporta `user_id, date DESC, id DESC`.
- Pruebas de cursor, límites y aislamiento.
- Integración frontend sigue cursores hasta completar datos requeridos por las
  métricas actuales; no descarta silenciosamente registros después de página 1.

### Fase 7: recursos secundarios de lectura

Objetivo: completar dashboard actual sin crear endpoints analíticos.

Orden:

1. `budgets`.
2. `savings_goals`.
3. `msi_purchases`.
4. `rules`.

Cada recurso tiene migración, consulta, handler, pruebas e integración frontend
separados. Dashboard sigue calculando resúmenes de presentación localmente.

### Fase 8: escrituras esenciales

Objetivo: persistir cambios ya disponibles en UI.

Orden:

1. Crear, editar y borrar transacciones.
2. Crear, editar, desactivar y borrar cuentas sin historia.
3. Crear, editar y borrar presupuestos.
4. Crear, editar, contribuir y borrar metas.
5. Crear, editar y borrar categorías no sistémicas sin referencias.
6. Crear, activar/desactivar y borrar reglas.

Antes de habilitar escrituras de transacciones debe resolverse cómo se
sincronizan saldos de cuenta. Ninguna operación financiera multi-tabla se
implementa sin transacción SQL.

### Fase 9: despliegue

Objetivo: construir imagen una vez desde SHA validado y promover mismo digest
entre ambientes.

Entregables:

- Docker multi-stage y usuario no root.
- Artifact Registry y Cloud Run.
- Secretos fuera de imagen.
- CORS con orígenes explícitos.
- Límites de instancias y conexiones coordinados.
- Migración ejecutada como paso separado antes del tráfico.
- Smoke tests de salud, identidad y categorías.

### Fase 10: funcionalidades posteriores

Fuera del camino crítico inicial:

- Importación CSV con vista previa.
- Aplicación automática de reglas.
- Resúmenes canónicos del dashboard.
- Exportación y eliminación de cuenta.
- Métricas, alertas y rate limiting distribuido si el uso lo exige.

## Primeros pasos concretos

1. Ejecutar Fase 0: reglas, toolchains, CI frontend/security y gate Go definido.
2. Ejecutar Fase 1 y entender servidor, handler, router, request, response,
   contexto y prueba HTTP antes de conectar servicios externos.
3. Crear ambiente Supabase de desarrollo y ejecutar una sola migración:
   `categories`.
4. Implementar identidad, onboarding idempotente y luego categorías como
   primer corte completo.

No conviene comenzar creando las ocho tablas, todos los endpoints o auth y DB
en una misma entrega. Eso dificulta aprender y localizar errores.

## Protocolo de aprendizaje y documentación

Antes de cada fase se crea `docs/backend/phases/NN-nombre.md` con:

1. Problema que resuelve.
2. Conceptos Go/HTTP/SQL nuevos.
3. Archivos que se crearán o modificarán.
4. Código en bloques pequeños.
5. Explicación línea por línea o por unidad sintáctica inseparable.
6. Pruebas y por qué existen.
7. Comandos exactos de verificación.
8. Errores esperados y cómo diagnosticarlos.
9. Checklist de salida.
10. Decisiones nuevas y deuda deliberada.

No se avanza de fase con código no explicado, pruebas fallando o contrato
desactualizado.

## Definición de terminado para cada endpoint

- Ruta y método documentados.
- Autenticación definida como pública o requerida.
- Input y output definidos.
- Errores esperados definidos.
- Query siempre acotada por usuario cuando corresponda.
- Validación de datos aplicada.
- Prueba feliz y pruebas de error relevantes.
- `go test ./...` y `go vet ./...` pasan.
- Logs no exponen token, contraseña, URL de DB ni información sensible.
- Frontend integra estados de carga, error y vacío cuando endpoint tiene
  consumidor UI.
- Documentación refleja implementación real.
- CI completo está verde desde checkout limpio.

## Riesgos que deben permanecer visibles

- Una consulta sin `user_id` puede filtrar datos entre usuarios.
- Cada instancia serverless abre su propio pool; escalar API puede agotar DB.
- Cloud Run puede tener cold starts; salud no debe depender de trabajo pesado.
- JWT validado solo por decodificación, sin firma o claims, no autentica nada.
- Mezclar MXN y USD sin tipo de cambio produce totales falsos.
- Saldos almacenados y transacciones pueden divergir si no existe una regla
  transaccional explícita.
- Contrato TypeScript y JSON pueden divergir porque TypeScript no valida en
  runtime.
