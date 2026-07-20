import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { Transaction } from '@/types'

/** Invalidate every query that depends on transactions. */
function useInvalidateTx() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.transactions })
    qc.invalidateQueries({ queryKey: queryKeys.dashboard })
  }
}

export function useCreateTransaction() {
  const invalidate = useInvalidateTx()
  return useMutation({
    mutationFn: (input: Omit<Transaction, 'id' | 'createdAt' | 'isReconciled'>) =>
      api.createTransaction(input),
    onSuccess: invalidate,
  })
}

export function useUpdateTransaction() {
  const invalidate = useInvalidateTx()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Transaction> }) =>
      api.updateTransaction(id, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateTx()
  return useMutation({
    mutationFn: (id: string) => api.deleteTransaction(id),
    onSuccess: invalidate,
  })
}
