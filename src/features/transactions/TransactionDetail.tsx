import { Sheet, Separator, Badge } from '@/components/ui'
import { CategoryIcon } from '@/components/common/CategoryIcon'
import { Amount } from '@/components/common/Amount'
import { formatDate } from '@/lib/date'
import type { Transaction, Category, Account } from '@/types'

interface TransactionDetailProps {
  transaction: Transaction | null
  category?: Category
  account?: Account
  transferAccount?: Account
  onClose: () => void
}

export function TransactionDetail({
  transaction: tx,
  category,
  account,
  transferAccount,
  onClose,
}: TransactionDetailProps) {
  if (!tx) return null

  const isIncome = tx.type === 'income'
  const isTransfer = tx.type === 'transfer'

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Fecha', value: formatDate(tx.date) },
    {
      label: 'Cuenta',
      value: account?.name ?? '—',
    },
  ]

  if (isTransfer && transferAccount) {
    rows.push({ label: 'Hacia', value: transferAccount.name })
  }
  if (category) {
    rows.push({ label: 'Categoría', value: category.name })
  }
  if (tx.merchant) {
    rows.push({ label: 'Establecimiento', value: tx.merchant })
  }

  return (
    <Sheet open={!!tx} onClose={onClose}>
      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <CategoryIcon
          name={category?.icon ?? 'Repeat'}
          color={category?.color}
          className="h-12 w-12"
        />
        <p className="mt-2 text-sm font-medium">{tx.description}</p>
        <Amount
          value={isIncome || isTransfer ? tx.amount : -tx.amount}
          signed
          size="xl"
          className="mt-1"
        />

        <div className="mt-2 flex gap-1.5">
          {isTransfer ? (
            <Badge accent="blue">Transferencia</Badge>
          ) : isIncome ? (
            <Badge accent="green">Ingreso</Badge>
          ) : (
            <Badge accent="red">Gasto</Badge>
          )}
          {tx.msiPurchaseId && (
            <Badge accent="purple">MSI</Badge>
          )}
          {!tx.isReconciled && (
            <Badge variant="muted">Pendiente</Badge>
          )}
        </div>
      </div>

      <Separator className="my-4" />

      {/* Details */}
      <div className="space-y-2.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <span className="text-sm font-medium">{row.value}</span>
          </div>
        ))}
      </div>

      <Separator className="my-4" />

      {/* TODO: Edit / Delete actions when CRUD is wired */}
      <p className="text-center text-[11px] text-muted-foreground">
        Creado el {formatDate(tx.createdAt)}
      </p>
    </Sheet>
  )
}
