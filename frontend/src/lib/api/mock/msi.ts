import type { MSIPurchase } from '@/types'

export const mockMSIPurchases: MSIPurchase[] = [
  {
    id: 'msi-iphone',
    accountId: 'acc-cred-platino',
    description: 'iPhone 15 Pro',
    merchant: 'Apple Store',
    totalAmount: 2599900, // $25,999.00
    installmentAmount: 216660, // $2,166.60 (last absorbs remainder)
    installmentCount: 12,
    installmentsPaid: 4,
    startDate: '2025-03-15',
    nextInstallmentDate: '2025-08-15',
    categoryId: null,
    status: 'active',
  },
  {
    id: 'msi-macbook',
    accountId: 'acc-cred-platino',
    description: 'MacBook Air M3',
    merchant: 'Apple Store',
    totalAmount: 3199900, // $31,999.00
    installmentAmount: 266660, // $2,666.60
    installmentCount: 12,
    installmentsPaid: 2,
    startDate: '2025-05-15',
    nextInstallmentDate: '2025-08-15',
    categoryId: null,
    status: 'active',
  },
  {
    id: 'msi-tv',
    accountId: 'acc-cred-nu',
    description: 'TV LG OLED 55"',
    merchant: 'Liverpool',
    totalAmount: 1899900, // $18,999.00
    installmentAmount: 316650, // $3,166.50
    installmentCount: 6,
    installmentsPaid: 3,
    startDate: '2025-04-28',
    nextInstallmentDate: '2025-08-28',
    categoryId: null,
    status: 'active',
  },
]
