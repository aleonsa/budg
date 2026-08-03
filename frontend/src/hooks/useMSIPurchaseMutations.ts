import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { CreateMSIPurchaseInput } from '@/lib/api/msi-purchases'
import { queryKeys } from '@/lib/query-keys'

function useInvalidateMSI() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.msiPurchases })
    queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
  }
}

export function useCreateMSIPurchase() {
  const invalidate = useInvalidateMSI()
  return useMutation({
    mutationFn: ({
      idempotencyKey,
      ...input
    }: CreateMSIPurchaseInput & { idempotencyKey: string }) =>
      api.createMSIPurchase(input, { idempotencyKey }),
    onSuccess: invalidate,
  })
}

export function useUpdateMSIPurchase() {
  const invalidate = useInvalidateMSI()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateMSIPurchaseInput }) =>
      api.updateMSIPurchase(id, input),
    onSuccess: invalidate,
  })
}

export function useDeleteMSIPurchase() {
  const invalidate = useInvalidateMSI()
  return useMutation({ mutationFn: api.deleteMSIPurchase, onSuccess: invalidate })
}
