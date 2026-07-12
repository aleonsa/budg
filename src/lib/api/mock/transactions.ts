import type { Transaction } from '@/types'

/**
 * Mock transactions — July 2025.
 * Includes regular expenses, income, MSI installments, and a transfer.
 */
export const mockTransactions: Transaction[] = [
  // ── 2025-07-12 (today) ─────────────────────
  {
    id: 'tx-001',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 18450, // $184.50
    categoryId: 'cat-food',
    date: '2025-07-12',
    description: 'Sushi roll combo',
    merchant: 'Sushi Roll',
    isReconciled: true,
    createdAt: '2025-07-12',
  },
  {
    id: 'tx-002',
    accountId: 'acc-cred-nu',
    type: 'expense',
    amount: 32000, // $320.00
    categoryId: 'cat-entertainment',
    date: '2025-07-12',
    description: 'Cine IMAX 2 boletos',
    merchant: 'Cinemex',
    isReconciled: false,
    createdAt: '2025-07-12',
  },
  {
    id: 'tx-003',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 5260, // $52.60
    categoryId: 'cat-transport',
    date: '2025-07-12',
    description: 'Uber Centro — Casa',
    merchant: 'Uber',
    isReconciled: true,
    createdAt: '2025-07-12',
  },

  // ── 2025-07-11 ─────────────────────────────
  {
    id: 'tx-004',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 85630, // $856.30
    categoryId: 'cat-groceries',
    date: '2025-07-11',
    description: 'Súper semanal',
    merchant: 'Walmart',
    isReconciled: true,
    createdAt: '2025-07-11',
  },
  {
    id: 'tx-005',
    accountId: 'acc-cred-platino',
    type: 'expense',
    amount: 216660, // MSI iPhone
    categoryId: null,
    date: '2025-07-11',
    description: 'iPhone 15 Pro - Mes 5/12',
    merchant: 'Apple Store',
    msiPurchaseId: 'msi-iphone',
    isReconciled: true,
    createdAt: '2025-07-11',
  },
  {
    id: 'tx-006',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 24500, // $245.00
    categoryId: 'cat-food',
    date: '2025-07-11',
    description: 'Cena con amigos',
    merchant: 'Parmigiano',
    isReconciled: true,
    createdAt: '2025-07-11',
  },

  // ── 2025-07-10 ─────────────────────────────
  {
    id: 'tx-007',
    accountId: 'acc-nomina',
    type: 'income',
    amount: 3850000, // $38,500.00
    categoryId: 'cat-income',
    date: '2025-07-10',
    description: 'Nómina quincena',
    merchant: 'EMPRESA SA',
    isReconciled: true,
    createdAt: '2025-07-10',
  },
  {
    id: 'tx-008',
    accountId: 'acc-nomina',
    type: 'transfer',
    amount: 500000, // $5,000.00
    categoryId: null,
    date: '2025-07-10',
    description: 'Transferencia a Ahorro Nu',
    transferToAccountId: 'acc-ahorro',
    isReconciled: true,
    createdAt: '2025-07-10',
  },
  {
    id: 'tx-009',
    accountId: 'acc-cred-platino',
    type: 'expense',
    amount: 266660, // MSI MacBook
    categoryId: null,
    date: '2025-07-10',
    description: 'MacBook Air M3 - Mes 3/12',
    merchant: 'Apple Store',
    msiPurchaseId: 'msi-macbook',
    isReconciled: true,
    createdAt: '2025-07-10',
  },

  // ── 2025-07-09 ─────────────────────────────
  {
    id: 'tx-010',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 18900, // $189.00
    categoryId: 'cat-health',
    date: '2025-07-09',
    description: 'Consulta médica',
    merchant: 'Dr. Martínez',
    isReconciled: true,
    createdAt: '2025-07-09',
  },
  {
    id: 'tx-011',
    accountId: 'acc-cred-nu',
    type: 'expense',
    amount: 316650, // MSI TV
    categoryId: null,
    date: '2025-07-09',
    description: 'TV LG OLED 55" - Mes 4/6',
    merchant: 'Liverpool',
    msiPurchaseId: 'msi-tv',
    isReconciled: true,
    createdAt: '2025-07-09',
  },

  // ── 2025-07-08 ─────────────────────────────
  {
    id: 'tx-012',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 45200, // $452.00
    categoryId: 'cat-transport',
    date: '2025-07-08',
    description: 'Gasolina lleno',
    merchant: 'Shell',
    isReconciled: true,
    createdAt: '2025-07-08',
  },
  {
    id: 'tx-013',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 6780, // $67.80
    categoryId: 'cat-food',
    date: '2025-07-08',
    description: 'Café y pan',
    merchant: 'Panadería La Esperanza',
    isReconciled: false,
    createdAt: '2025-07-08',
  },

  // ── 2025-07-07 ─────────────────────────────
  {
    id: 'tx-014',
    accountId: 'acc-cred-platino',
    type: 'expense',
    amount: 129990, // $1,299.90
    categoryId: 'cat-home',
    date: '2025-07-07',
    description: 'Mesa de comedor',
    merchant: 'IKEA',
    isReconciled: true,
    createdAt: '2025-07-07',
  },
  {
    id: 'tx-015',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 15400, // $154.00
    categoryId: 'cat-entertainment',
    date: '2025-07-07',
    description: 'Suscripción streaming x2',
    merchant: 'Netflix + Spotify',
    isReconciled: true,
    createdAt: '2025-07-07',
  },

  // ── 2025-07-05 ─────────────────────────────
  {
    id: 'tx-016',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 22000, // $220.00
    categoryId: 'cat-food',
    date: '2025-07-05',
    description: 'Desayuno dominical',
    merchant: 'El Padrino',
    isReconciled: true,
    createdAt: '2025-07-05',
  },
  {
    id: 'tx-017',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 98000, // $980.00
    categoryId: 'cat-groceries',
    date: '2025-07-05',
    description: 'Súper quincenal',
    merchant: 'Costco',
    isReconciled: true,
    createdAt: '2025-07-05',
  },

  // ── 2025-07-03 ─────────────────────────────
  {
    id: 'tx-018',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 35600, // $356.00
    categoryId: 'cat-travel',
    date: '2025-07-03',
    description: 'Vuelo CDMX — MTY',
    merchant: 'Volaris',
    isReconciled: true,
    createdAt: '2025-07-03',
  },
  {
    id: 'tx-019',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 12300, // $123.00
    categoryId: 'cat-transport',
    date: '2025-07-03',
    description: 'Taxi aeropuerto',
    merchant: 'Aeropuerto AICM',
    isReconciled: true,
    createdAt: '2025-07-03',
  },

  // ── 2025-07-01 ─────────────────────────────
  {
    id: 'tx-020',
    accountId: 'acc-nomina',
    type: 'expense',
    amount: 45000, // $450.00
    categoryId: 'cat-home',
    date: '2025-07-01',
    description: 'Renta departamento',
    merchant: 'Inmobiliaria',
    isReconciled: true,
    createdAt: '2025-07-01',
  },
  {
    id: 'tx-021',
    accountId: 'acc-nomina',
    type: 'income',
    amount: 3850000, // $38,500.00
    categoryId: 'cat-income',
    date: '2025-07-01',
    description: 'Nómina quincena',
    merchant: 'EMPRESA SA',
    isReconciled: true,
    createdAt: '2025-07-01',
  },
]
