# Reglas de desarrollo

## Propósito

Estas reglas aplican a frontend, backend, base de datos, documentación e
infraestructura. Su objetivo es mantener `main` desplegable, cambios fáciles de
revisar y comportamiento financiero correcto.

No dependen de quién escribe el código. Persona o agente debe cumplir mismos
gates y explicar decisiones no evidentes.

## Regla principal: main siempre verde

`main` debe compilar, pasar checks y estar en estado desplegable.

- No se integra código con CI rojo.
- No se desactiva un check para hacer pasar un cambio.
- No se reducen reglas, cobertura o validaciones sin justificarlo en el cambio.
- No se aceptan tests flaky como normales ni se ocultan con retries ilimitados.
- Un fallo existente se corrige o se documenta como baseline antes de añadir
  trabajo que dependa de él.
- Force push y commits directos a `main` están bloqueados por branch protection.

Excepción urgente requiere razón escrita, aprobación explícita y cambio de
seguimiento. Problema de producción no convierte CI rojo en estado aceptable.

## Antes de escribir código

Todo cambio responde estas preguntas:

1. ¿Qué comportamiento observable cambia?
2. ¿Qué contrato, tipo, tabla o endpoint afecta?
3. ¿Cuál es prueba mínima que fallaría sin cambio?
4. ¿Hay riesgo de seguridad, datos, dinero o compatibilidad?
5. ¿Cómo se verifica localmente y en CI?
6. ¿Documentación queda desactualizada?

Si cambio toca múltiples fases o recursos, se divide salvo que atomicidad sea
necesaria para mantener repositorio funcionando.

## Tamaño y claridad

- Preferir cambio correcto más pequeño.
- No agregar abstracción por posibilidad futura.
- Nombres describen dominio, no patrón genérico.
- Comentarios explican por qué; código explica qué.
- Dependencia nueva requiere problema concreto, mantenimiento activo y revisión
  de costo, licencia y superficie de seguridad.
- Código muerto, flags temporales y TODOs sin owner/razón no se integran.
- Refactor y cambio funcional se separan cuando sea posible.

## Correctitud

- Errores se manejan explícitamente; no se ignoran.
- Inputs externos se validan en runtime.
- Operaciones con dinero usan enteros en centavos.
- Fechas financieras y timestamps técnicos no se mezclan.
- Orden de listas paginadas debe ser estable.
- Writes financieros repetibles usan idempotencia.
- Operaciones multi-tabla que deben ser atómicas usan transacción SQL.
- Cada query financiera está acotada por usuario autenticado.
- Comportamiento ambiguo se decide y documenta antes de implementar.

## Seguridad

- Secretos nunca entran en Git, imagen, logs, screenshots ni variables `VITE_*`.
- SQL usa parámetros; nunca concatenación de input.
- JWT verifica firma, algoritmo permitido, issuer, audience y expiración.
- Resource ajeno se trata como inexistente cuando contrato lo requiere.
- Logs no contienen tokens, passwords, DSNs ni payload financiero completo.
- CORS usa orígenes explícitos y no sustituye autenticación.
- Dependencias y GitHub Actions se fijan a versiones revisables.
- Workflow de PR no ejecuta código no confiable con secretos.
- Hallazgo crítico bloquea merge o despliegue hasta corrección/mitigación
  documentada.

## Performance

Robusto no significa microoptimizado.

- Primero correctitud, luego medición, después optimización.
- Toda optimización no obvia incluye benchmark, query plan o métrica antes y
  después.
- Endpoints de colección tienen límites o paginación.
- Queries evitan N+1 y cuentan con índice alineado al patrón real.
- Timeouts y cancelación llegan desde request hasta DB.
- Pools, goroutines, payloads y buffers son acotados.
- No se añade cache sin estrategia de invalidación y evidencia de necesidad.
- No se sacrifica legibilidad por ganancia no medida.

## Reglas TypeScript y React

- Fase 0 habilita `strict: true`; desde entonces TypeScript permanece estricto.
- `any`, type assertions y `@ts-ignore` requieren razón localizada; preferir
  modelar tipo correcto.
- Respuestas HTTP se validan/normalizan en frontera; tipos compile-time no
  validan JSON.
- Requests viven en cliente API; componentes no construyen URLs ad hoc.
- Estado remoto usa TanStack Query; estado UI local no se eleva sin necesidad.
- Mutaciones actualizan/invalidadan queries de forma determinista.
- Efectos no esconden lógica de dominio que pueda ser función pura.
- Componentes conservan accesibilidad por teclado, labels y estados de foco.
- No se integran `console.log`, promesas sin manejar ni tests enfocados con
  `.only`.
- Código nuevo o corregido incluye pruebas del comportamiento relevante.

## Reglas Go

- Todo archivo pasa `gofmt`.
- `go vet`, tests, race detector y build deben pasar.
- `context.Context` es primer parámetro de operaciones cancelables; no se guarda
  en structs.
- Errores se envuelven con contexto usando `%w`; cliente recibe mensajes seguros.
- `panic` no se usa para flujo normal ni errores de request.
- No hay estado mutable global para config, DB o servicios.
- Interfaces se definen donde se consumen y solo cuando existe necesidad real.
- Handlers traducen HTTP; SQL vive en store; reglas de negocio no se entierran
  en router.
- Todas las queries reciben context y usan parámetros.
- Goroutine nueva requiere ownership, cancelación y prueba de cierre.
- Código concurrente se valida con `go test -race ./...`.

## Reglas PostgreSQL y Goose

- Cada cambio de schema tiene migración Goose SQL.
- `Up` y `Down` viven juntos; irreversibilidad se explica.
- Migración aplicada nunca se edita.
- No hay cambios manuales de production fuera de runbook de emergencia.
- DDL y backfill se separan.
- Cambios de rollout usan expand/contract.
- Runtime usa rol no-owner con privilegios mínimos.
- Constraints protegen invariantes aunque API también valide.
- Migración se prueba `up -> down-to 0 -> up` solo en DB descartable.
- Production se corrige hacia adelante; rollback destructivo no es automático.

## Pruebas

Pirámide inicial:

- Unitarias para funciones y reglas puras.
- Handler tests con `httptest` para contrato HTTP.
- Integración real PostgreSQL para SQL, constraints y aislamiento.
- Component tests para interacción React importante.
- E2E para pocos caminos críticos cuando auth y API estén integrados.

Cada bug fix empieza con prueba que reproduce bug cuando sea viable. Tests deben
ser deterministas, independientes de orden y no depender del reloj/red real sin
control.

Coverage se publica y revisa. Baseline de Fase 0 permitió establecer umbral
global mínimo de 80% para statements, branches, functions y lines. Reglas:

- Cada métrica global debe permanecer en 80% o más; CI bloquea cualquier caída
  por debajo del umbral.
- Código nuevo crítico debe quedar cubierto.
- Auth, user scoping, dinero e idempotencia prueban happy path y fallos.
- Coverage no puede bajar sin explicación aunque permanezca sobre 80%.
- Tests validan comportamiento observable; snapshots masivos, asserts de clases
  CSS y ejecución sin resultado semántico no cuentan como estrategia de cobertura.
- Umbral se eleva gradualmente cuando cobertura sostenible deje margen suficiente.

## Documentación

Cambio actualiza en mismo PR:

- Contrato API si cambia request/response/error.
- Modelo y migraciones si cambia persistencia.
- Variables de entorno si cambia configuración.
- Runbook si cambia operación/despliegue.
- Documento de fase si introduce concepto o deuda deliberada.

README enlaza fuentes canónicas; no duplica especificaciones largas.

## Definition of Done

Cambio está terminado cuando:

- Alcance y comportamiento están claros.
- Tests relevantes existen y pasan.
- Format, lint, types, vet, race y builds aplicables pasan.
- Security y ownership fueron revisados.
- Migraciones fueron validadas cuando aplica.
- Performance no tiene regresión evidente o fue medida cuando era objetivo.
- Documentación y ejemplos reflejan código real.
- CI completo está verde.
- Diff no contiene cambios accidentales, secretos ni artefactos generados.

## Revisión de cambios

Revisión prioriza, en orden:

1. Fuga/corrupción de datos y seguridad.
2. Correctitud financiera y comportamiento.
3. Compatibilidad de contratos/migraciones.
4. Tests faltantes y manejo de errores.
5. Performance medible.
6. Claridad y mantenibilidad.

Estilo puramente subjetivo no bloquea si formatter y reglas acordadas pasan.
