import { Header } from '@/components/layout/Header'
import { Card, Badge, Button, Separator } from '@/components/ui'
import {
  Mail,
  User,
  Coins,
  Palette,
  Languages,
  Calendar,
  Tags,
  Wallet,
  PieChart,
  Zap,
  ShieldCheck,
  LogOut,
  Download,
  Upload,
  Terminal,
  Code,
  ChevronRight,
} from 'lucide-react'
import { useCategories, useAccounts, useBudgets } from '@/hooks/useQueries'

type IconType = React.ComponentType<{ className?: string }>

// ── Sub-components ───────────────────────────────────────────

function SectionHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="space-y-0.5 px-1">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {description && (
        <p className="text-[11px] text-muted-foreground/70">{description}</p>
      )}
    </div>
  )
}

function SettingsRow({
  icon: Icon,
  label,
  children,
}: {
  icon: IconType
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm text-foreground">{label}</span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function NavRow({
  icon: Icon,
  label,
  badge,
  disabled,
}: {
  icon: IconType
  label: string
  badge?: string
  disabled?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2.5 ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm text-foreground">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {badge && <Badge variant="muted">{badge}</Badge>}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </div>
  )
}

/** Non-functional segmented control for theme selection. */
function ThemeSelector() {
  const options = ['Sistema', 'Claro', 'Oscuro'] as const
  return (
    <div className="flex items-center rounded-md border border-border p-0.5">
      {options.map((opt, i) => (
        <span
          key={opt}
          className={`rounded px-2 py-0.5 text-[11px] ${
            i === 0
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground'
          }`}
        >
          {opt}
        </span>
      ))}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const categoriesQ = useCategories()
  const accountsQ = useAccounts()
  const budgetsQ = useBudgets()

  const categoryCount = categoriesQ.data?.length ?? 0
  const accountCount = accountsQ.data?.length ?? 0
  const budgetCount = budgetsQ.data?.length ?? 0

  return (
    <>
      <Header title="Ajustes" subtitle="Configuración" showSettings={false} />
      <div className="space-y-5 py-4">
        {/* Perfil */}
        <div className="space-y-2">
          <SectionHeader
            title="Perfil"
            description="Información de usuario y sesión"
          />
          <Card className="overflow-hidden">
            {/* Avatar + email block */}
            <div className="flex items-center gap-3 p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                U
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">Usuario</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  usuario@ejemplo.com
                </p>
              </div>
              <Badge variant="muted">Mock</Badge>
            </div>
            <Separator />
            <div className="px-3">
              <SettingsRow icon={User} label="Estado de sesión">
                <Badge variant="muted">Sesión local</Badge>
              </SettingsRow>
              <SettingsRow icon={ShieldCheck} label="Supabase Auth">
                <Badge accent="yellow">Próximamente</Badge>
              </SettingsRow>
            </div>
          </Card>
        </div>

        {/* Preferencias */}
        <div className="space-y-2">
          <SectionHeader
            title="Preferencias"
            description="Personalización de la experiencia"
          />
          <Card className="divide-y divide-border px-3">
            <SettingsRow icon={Coins} label="Moneda principal">
              <Badge accent="green">MXN</Badge>
            </SettingsRow>
            <SettingsRow icon={Palette} label="Tema">
              <ThemeSelector />
            </SettingsRow>
            <SettingsRow icon={Languages} label="Idioma">
              <Badge variant="muted">Español</Badge>
            </SettingsRow>
            <SettingsRow icon={Calendar} label="Formato de fecha">
              <Badge variant="outline">DD/MM/AAAA</Badge>
            </SettingsRow>
          </Card>
        </div>

        {/* Categorías */}
        <div className="space-y-2">
          <SectionHeader
            title="Categorías"
            description="Clasificación de transacciones"
          />
          <Card className="divide-y divide-border px-3">
            <NavRow icon={Tags} label="Gestionar categorías" badge={`${categoryCount}`} />
            <NavRow icon={PieChart} label="Gestionar presupuestos" badge={`${budgetCount}`} />
          </Card>
        </div>

        {/* Reglas automáticas */}
        <div className="space-y-2">
          <SectionHeader
            title="Reglas automáticas"
            description="Automatiza la categorización de transacciones"
          />
          <Card className="divide-y divide-border px-3">
            <NavRow icon={Zap} label="Reglas de categorización" disabled />
            <SettingsRow icon={Tags} label="Categorías automáticas">
              <Badge accent="yellow">Próximamente</Badge>
            </SettingsRow>
          </Card>
        </div>

        {/* Datos */}
        <div className="space-y-2">
          <SectionHeader
            title="Datos"
            description="Gestión y respaldo de información"
          />
          <Card className="divide-y divide-border px-3">
            <NavRow icon={Wallet} label="Cuentas registradas" badge={`${accountCount}`} />
            <SettingsRow icon={Download} label="Exportar datos">
              <Badge variant="outline">CSV</Badge>
            </SettingsRow>
            <SettingsRow icon={Upload} label="Importar datos">
              <Badge variant="outline">Próximamente</Badge>
            </SettingsRow>
          </Card>
        </div>

        {/* Seguridad */}
        <div className="space-y-2">
          <SectionHeader
            title="Seguridad"
            description="Autenticación y acceso"
          />
          <Card className="divide-y divide-border px-3">
            <SettingsRow icon={ShieldCheck} label="Autenticación">
              <Badge accent="yellow">Supabase Auth</Badge>
            </SettingsRow>
            <SettingsRow icon={Mail} label="Verificación de email">
              <Badge variant="muted">Pendiente</Badge>
            </SettingsRow>
            <div className="py-2.5">
              <Button variant="outline" size="sm" disabled className="w-full">
                <LogOut className="h-3.5 w-3.5" />
                Cerrar sesión
              </Button>
            </div>
          </Card>
        </div>

        {/* Información técnica */}
        <div className="space-y-2">
          <SectionHeader
            title="Información técnica"
            description="Detalles del sistema"
          />
          <Card className="divide-y divide-border px-3">
            <SettingsRow icon={Terminal} label="Modo de API">
              <Badge variant="muted">Mock API</Badge>
            </SettingsRow>
            <SettingsRow icon={Code} label="Arquitectura">
              <Badge variant="muted">Frontend only</Badge>
            </SettingsRow>
          </Card>
        </div>
      </div>
    </>
  )
}
