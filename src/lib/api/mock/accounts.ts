import type { Account } from '@/types'

export const mockAccounts: Account[] = [
  // ── Débito ─────────────────────────────────
  {
    id: 'acc-nomina',
    name: 'Nómina BBVA',
    type: 'debit',
    institution: 'BBVA',
    last4: '4521',
    currency: 'MXN',
    balance: 1845000, // $18,450.00
    isActive: true,
  },
  {
    id: 'acc-ahorro',
    name: 'Ahorro Nu',
    type: 'debit',
    institution: 'Nu',
    last4: '8830',
    currency: 'MXN',
    balance: 5230000, // $52,300.00
    isActive: true,
  },
  // ── Crédito ────────────────────────────────
  {
    id: 'acc-cred-platino',
    name: 'Cred Platino',
    type: 'credit',
    institution: 'Santander',
    last4: '1093',
    currency: 'MXN',
    creditLimit: 8000000, // $80,000.00
    availableCredit: 5340000, // $53,400.00
    statementCutDay: 15,
    paymentDueDay: 5,
    isActive: true,
  },
  {
    id: 'acc-cred-nu',
    name: 'Nu Credito',
    type: 'credit',
    institution: 'Nu',
    last4: '7742',
    currency: 'MXN',
    creditLimit: 3500000, // $35,000.00
    availableCredit: 2870000, // $28,700.00
    statementCutDay: 28,
    paymentDueDay: 20,
    isActive: true,
  },
]
