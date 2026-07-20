# Versiones de toolchain y dependencias

Snapshot revisado el 20 de julio de 2026. Solo incluye releases estables, sin
alpha, beta, RC ni tags móviles en automatización. El lockfile determina las
versiones npm exactas instaladas; los rangos de `package.json` permiten recibir
parches mediante PRs de Dependabot.

## Toolchains seleccionados

| Herramienta | Versión seleccionada | Motivo |
| --- | --- | --- |
| Node.js | `24.18.0` | LTS Krypton más reciente; Node 26.5.0 es Current, no LTS |
| npm | `12.0.1` | Release estable más reciente compatible con Node 24.18.0 |
| Go | `1.26.5` | Release estable más reciente |

Node queda fijado en `.node-version`, `frontend/package.json` y CI actual. Go
queda fijado en `.go-version`; Fase 1 usará `1.26.5` en `backend/go.mod` y Fase
9 repetirá versión en Dockerfile. Máquina local ya usa Node 24.18.0, npm 12.0.1
y Go 1.26.5 con `GOTOOLCHAIN=local`. `frontend/.npmrc` hace fallar instalación
cuando Node o npm no cumplen `engines`, en vez de continuar con advertencia.
Node 24.18.0 incluye npm 11.16.0, por lo que setup local y CI deben ejecutar
`npm install --global npm@12.0.1` antes de entrar a `frontend/` y usar `npm ci`.

Fuentes oficiales:

- [Node.js releases](https://nodejs.org/dist/index.json)
- [Go downloads](https://go.dev/dl/?mode=json)
- [npm registry](https://www.npmjs.com/package/npm)

## Frontend instalado

| Paquete | Versión estable |
| --- | --- |
| `@tailwindcss/vite` | `4.3.3` |
| `@tanstack/react-query` | `5.101.3` |
| `class-variance-authority` | `0.7.1` |
| `clsx` | `2.1.1` |
| `lucide-react` | `1.25.0` |
| `react` / `react-dom` | `19.2.7` |
| `react-router-dom` | `7.18.1` |
| `tailwind-merge` | `3.6.0` |
| `tailwindcss` | `4.3.3` |
| `zustand` | `5.0.14` |
| `@types/node` | `24.13.3` (línea Node 24) |
| `@types/react` | `19.2.17` |
| `@types/react-dom` | `19.2.3` |
| `@vitejs/plugin-react` | `6.0.3` |
| `oxlint` | `1.74.0` |
| `typescript` | `7.0.2` |
| `vite` | `8.1.5` |

Fuente: dist-tag `latest` de [npm registry](https://www.npmjs.com/), con
`@types/node` intencionalmente limitado a major 24 para representar runtime
elegido. Build y lint fueron ejecutados después de actualización.

## Calidad frontend para Fase 0

Versiones instaladas y usadas por scripts/pruebas de Fase 0:

| Paquete | Versión estable seleccionada |
| --- | --- |
| `prettier` | `3.9.5` |
| `vitest` | `4.1.10` |
| `@vitest/coverage-v8` | `4.1.10` |
| `@testing-library/react` | `16.3.2` |
| `@testing-library/dom` | `10.4.1` |
| `@testing-library/jest-dom` | `6.9.1` |
| `@testing-library/user-event` | `14.6.1` |
| `jsdom` | `29.1.1` |

## Backend y datos planeados

No se agregan todavía al módulo experimental. Fases correspondientes deben
instalar exactamente estas versiones y volver a validar compatibilidad:

| Componente | Versión estable seleccionada | Fase |
| --- | --- | --- |
| `github.com/go-chi/chi/v5` | `v5.3.1` | 1 |
| `github.com/jackc/pgx/v5` | `v5.10.0` | 2 |
| Goose CLI | `v3.27.2` | 2 |
| Supabase CLI | `v2.109.1` | 2 |
| `github.com/lestrrat-go/jwx/v3` | `v3.1.1` | 3 |
| `@supabase/supabase-js` | `2.110.7` | 3, frontend |

Fuentes oficiales:

- [Go module proxy](https://proxy.golang.org/)
- [Goose releases](https://github.com/pressly/goose/releases)
- [Supabase CLI releases](https://github.com/supabase/cli/releases)
- [npm registry](https://www.npmjs.com/package/@supabase/supabase-js)

PostgreSQL upstream estable más reciente es 18.4, pero no se fija como runtime
del proyecto todavía. Fase 2 debe usar versión de PostgreSQL e imágenes que
genere configuración fijada de Supabase CLI; elegir 18.4 por separado podría
divergir de plataforma hosted. Docker se valida como capacidad host en esa fase,
no como dependencia de aplicación.

## CI seleccionado

GitHub Actions se referenciarán por SHA completo con comentario de versión. Este
snapshot registra tags y commits revisados para evitar tags mutables:

| Action | Release | Commit SHA |
| --- | --- | --- |
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/setup-go` | `v7.0.0` | `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e` |
| `actions/upload-artifact` | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `actions/dependency-review-action` | `v5.0.0` | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` |

Fuente: releases y refs oficiales de cada repositorio en
[GitHub Actions](https://github.com/actions).

Secret scanning usa Gitleaks `v8.30.1`; instalación CI verifica checksum del
release. Dependency Review solo se activa si plan GitHub privado soporta GitHub
Code Security, como define `docs/ci-cd.md`.

Repository settings exigen SHA completo y permiten únicamente Actions propiedad
de GitHub. npm 12.0.1 se verifica contra SRI fijado antes de bootstrap CI.

## Herramientas host

Git y curl no forman parte del artefacto ni necesitan versión exacta compartida.
Durante revisión se observaron Git 2.51.0 y Apple curl 8.7.1; ambos cubren uso
planeado. Releases upstream más recientes son Git 2.55.0 y curl 8.21.0, pero no
se exige actualizar herramientas del sistema sin requisito funcional o de
seguridad. Docker CLI 29.4.0 está instalado, aunque daemon local no estaba activo
durante revisión.

## Renovación

- Dependabot propone npm y GitHub Actions en PRs separados.
- Go modules se renuevan desde Fase 1; herramientas CLI se revisan al activar su
  fase.
- Major upgrades requieren changelog, build, tests y revisión explícita.
- Este snapshot se actualiza junto con archivos reales que fijan versión; no se
  cambia documentación sola.
