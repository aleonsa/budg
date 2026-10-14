# Loans — Préstamos y financiamientos

Fecha: 2026-10-14
Estado: implementado (backend + frontend)

## Contexto

Financiamiento de auto (KIA K4, Inbursa SOFOM): capital $276,900 MXN, tasa anual
11.84% simple / **13.73% con IVA** (tasa usada en esta cotización:
interés mes 1 = 276,900 × 13.73% / 12 = $3,168.20 ✓), 60 meses, primer vencimiento
2026-12-13. El usuario pagará el seguro al contado cada año, por lo que el
tracking cubre **solo capital + intereses del vehículo** (P&I mensual $6,404.28,
que coincide con capital + interés de la cotización para meses 1-12). Seguros y
comisión inicial quedan fuera (ya registrados como movimientos normales).

## Decisiones

1. **Saldo trackeado = capital vehículo únicamente.** Sin capitalización de
   seguros (la cotización la incluye; el usuario pagará seguro auto al contado).
2. **Cuenta de pago por préstamo** (`account_id` en `loans`, editable).
   Cuenta débito MXN con seguimiento de saldo. Registrar un pago crea un expense en esa cuenta (vía `affects_balance`,
   mismo mecanismo que transacciones normales).
3. **Costos iniciales** (comisión $7,860.74 + seguro año 1 $16,177.23) ya
   registrados por el usuario como movimiento único — el módulo no los toca.

## Modelo

### `loans`
- `id`, `user_id` (FK auth.users CASCADE), `account_id` (FK accounts),
  `description`, `lender` (opcional)
- `principal_cents`, `annual_rate_bps` (1373 = 13.73%), `term_months`,
  `monthly_payment_cents`, `start_date`, `day_of_month`
- `status`: `active` | `paid_off`
- `idempotency_key`, timestamps

### `loan_payments` (schedule generado + histórico)
- `id`, `user_id`, `loan_id` (CASCADE), `sequence` (1..N, UNIQUE por loan)
- `due_date`, `principal_cents`, `interest_cents`, `total_cents` (esperado)
- `paid_principal_cents`, `paid_interest_cents`, `paid_total_cents` (real)
- `status`: `pending` | `paid` | `adjustment`
- `transaction_id` (FK transactions NO ACTION), `paid_at`, `created_at`
- Mensualidades numeradas únicas; aportaciones usan secuencia 0 y conciliaciones -1. El principal conciliado admite valores negativos para aumentar deuda.
- RLS: user-scoped, mismas convenciones que savings_goal_allocations
  (FORCE RLS, grants a budg_api, policy con `app.user_id`)

## Motor de amortización (`internal/loans`)

Función pura, sin dependencias de BD:

```
BuildSchedule(principalCents, annualRateBps, monthlyPaymentCents, termMonths, startDate, dayOfMonth) []Row
Row {Sequence, DueDate, PrincipalCents, InterestCents, TotalCents, RemainingCents}
```

- Interés mensual: `round(balance * annualRateBps / 120000)` (cents)
- Capital = pago − interés; último pago ajusta hasta $1 de residuo de redondeo. No inventa un pago globo para cubrir un plazo insuficiente.
- Recalcula fecha por `day_of_month` (clamp a fin de mes)

Verificado contra la cotización Inbursa: meses 1-3 = $3,236.08 / $3,273.11 /
$3,310.56 de capital, saldos 273,663.92 / 270,390.81 / 267,080.25 ✓

`ApplyExtraPayment(params, extraCents, extraDate)`:
aplica aportación a capital en `extraDate`, reconstruye el schedule con el
mismo `monthly_payment` (plazo se acorta) y devuelve `{interestSavedCents,
monthsSaved, newPayoffDate, schedule}`. Se aplican abonos antes de calcular interés del próximo período. Fechas futuras suponen mensualidades previas cubiertas. Es una estimación mensual: no calcula interés diario, comisiones ni seguros.

## API (todo bajo /v1, auth)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/loans/{id}/calculate` | Calculadora what-if sobre saldo real y calendario pendiente, sin persistir. Body: `{amountCents, date}` |
| GET | `/loans` | Lista préstamos + `remainingCents` calculado |
| POST | `/loans` | Crea préstamo + schedule (Idempotency-Key soportado) |
| GET | `/loans/{id}` | Detalle + payments |
| PATCH | `/loans/{id}` | Edita nombre, financiera y cuenta de pago; términos financieros permanecen fijos |
| DELETE | `/loans/{id}` | Borra préstamo sin historial; con registros requiere deshacerlos primero |
| POST | `/loans/{id}/payments/{paymentId}/pay` | Marca pago: crea expense en la cuenta del préstamo, guarda reales, si es el último pago pendiente marca loan `paid_off` |
| POST | `/loans/{id}/extra-payments` | Aportación a capital: expense + row `paid` con `sequence=0` + regenera payments pendientes (plazo acorta) |
| POST | `/loans/{id}/reconcile` | Conciliación: `{actualBalanceCents, asOfDate}` → inserta row `adjustment` con delta principal para cuadrar deuda vs banco |
| DELETE | `/loans/{id}/payments/{paymentId}` | Deshace únicamente el último evento; revierte transacción y saldo bancario atómicamente |

Pagos deben registrarse en orden. Aportaciones requieren `Idempotency-Key` y no exceden deuda restante. Mensualidades permiten indicar total real, capital e interés aplicados; la diferencia representa otros cargos. Conciliaciones no generan movimientos bancarios. Toda mutación de deuda reconstruye proyecciones pendientes y conserva historial. No se permiten eventos anteriores al último registro.

## Frontend

- Rutas `/loans` y `/loans/:loanId`: lista, formulario de creación, detalle con deuda restante, capital amortizado, intereses pagados, próximo vencimiento e historial. Acceso desde sidebar y menú móvil.
- En detalle: **simulador** (monto + fecha de aportación → llama
  `/loans/{id}/calculate` con saldo real como baseline → muestra interés
  ahorrado, meses ganados, nueva fecha de liquidación)
- Botones: mensualidad, aportación, conciliación, editar cuenta y deshacer último registro.
- Preset explícito "Usar cotización K4" llena términos; no crea transacciones por enganche o costos iniciales. Total bancario incluye seguro de vida si se ingresa al registrar mensualidad.
- Tipos y cliente en `lib/api/loans.ts`, hooks con
  TanStack Query, invalidación de `accounts`/`transactions` al mutar

## Fuera de scope

- Capitalización de seguro anual (contrato) — tracking solo vehículo
- MSI con tasa 0% (ya cubierto por msi_purchases)
- Cambio de mensualidad (re-amortizar bajando pago manteniendo plazo) —
  el motor lo permite; la UI solo expone "acortar plazo"
- Importación automática del PDF de amortización
