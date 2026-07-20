import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { Card, Badge, Button, Separator, Input, Label } from '@/components/ui'
import { MockActionPanel } from '@/components/common/MockActionPanel'
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
import { useAuth } from '@/stores/auth'
import { useTheme, type ThemeChoice } from '@/stores/theme'

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
        <p className="text-[11px] text-muted-foreground">{description}</p>
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
  to,
  disabled,
}: {
  icon: IconType
  label: string
  badge?: string
  to?: string
  disabled?: boolean
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm text-foreground">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {badge && <Badge variant="muted">{badge}</Badge>}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </>
  )

  const className = `flex items-center justify-between gap-3 py-2.5 ${
    disabled ? 'opacity-50' : 'hover:bg-accent'
  }`

  if (to && !disabled) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    )
  }
  return <div className={className}>{content}</div>
}

/** Segmented control for theme selection — writes to the theme store. */
function ThemeSelector() {
  const theme = useTheme((s) => s.theme)
  const setTheme = useTheme((s) => s.setTheme)
  const options: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: 'Sistema' },
    { value: 'light', label: 'Claro' },
    { value: 'dark', label: 'Oscuro' },
  ]
  return (
    <div className="flex items-center rounded-md border border-border p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setTheme(opt.value)}
          className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
            theme === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const [panel, setPanel] = useState<'profile' | 'export' | 'import' | null>(null)
  const [profileName, setProfileName] = useState('')
  const navigate = useNavigate()
  const categoriesQ = useCategories()
  const accountsQ = useAccounts()
  const budgetsQ = useBudgets()
  const user = useAuth((s) => s.user)
  const signOut = useAuth((s) => s.signOut)
  const updateProfile = useAuth((s) => s.updateProfile)

  const categoryCount = categoriesQ.data?.length ?? 0
  const accountCount = accountsQ.data?.length ?? 0
  const budgetCount = budgetsQ.data?.length ?? 0

  const displayName = profileName || user?.name || 'Usuario Demo'
  const displayEmail = user?.email ?? 'demo@budg.app'
  const initial = displayName.charAt(0).toUpperCase()

  const openProfilePanel = () => {
    setProfileName(user?.name ?? '')
    setPanel('profile')
  }

  const handleSignOut = () => {
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <Header
        title="Ajustes"
        subtitle="Configuración"
        showSettings={false}
        action={<Button size="sm" onClick={openProfilePanel}>Editar perfil</Button>}
      />
      <div className="space-y-3.5 py-3">
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
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {displayEmail}
                </p>
              </div>
              <Badge variant="muted">Demo</Badge>
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
            <NavRow icon={Tags} label="Gestionar categorías" badge={`${categoryCount}`} to="/categories" />
            <NavRow icon={PieChart} label="Gestionar presupuestos" badge={`${budgetCount}`} to="/budgets" />
          </Card>
        </div>

        {/* Reglas automáticas */}
        <div className="space-y-2">
          <SectionHeader
            title="Reglas automáticas"
            description="Automatiza la categorización de transacciones"
          />
          <Card className="divide-y divide-border px-3">
            <NavRow icon={Zap} label="Reglas de categorización" to="/rules" />
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
            <NavRow icon={Wallet} label="Cuentas registradas" badge={`${accountCount}`} to="/accounts" />
            <SettingsRow icon={Download} label="Exportar datos">
              <Button variant="outline" size="sm" onClick={() => setPanel('export')}>CSV</Button>
            </SettingsRow>
            <SettingsRow icon={Upload} label="Importar datos">
              <Button variant="outline" size="sm" onClick={() => setPanel('import')}>Importar</Button>
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
              <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
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

      <MockActionPanel
        open={panel === 'profile'}
        title="Editar perfil"
        description="Actualiza tu nombre de usuario (se guarda en el navegador)."
        submitLabel="Guardar"
        submitting={false}
        onClose={() => setPanel(null)}
        onSubmit={() => {
          if (profileName.trim()) updateProfile({ name: profileName.trim() })
          setPanel(null)
        }}
      >
        <div className="space-y-1.5">
          <Label>Nombre</Label>
          <Input
            placeholder="Usuario Demo"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input defaultValue={displayEmail} type="email" disabled />
        </div>
      </MockActionPanel>

      <MockActionPanel
        open={panel === 'export'}
        title="Exportar datos"
        description="Prepara una exportación CSV/JSON de tus movimientos."
        submitLabel="Preparar CSV"
        onClose={() => setPanel(null)}
        onSubmit={() => setPanel(null)}
      >
        <div className="space-y-1.5">
          <Label>Rango</Label>
          <select className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35">
            <option>Mes actual</option>
            <option>Últimos 3 meses</option>
            <option>Todo el historial</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Formato</Label>
          <select className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35">
            <option>CSV</option>
            <option>JSON</option>
          </select>
        </div>
      </MockActionPanel>

      <MockActionPanel
        open={panel === 'import'}
        title="Importar datos"
        description="Carga un archivo para validar el flujo de importación."
        submitLabel="Validar archivo"
        onClose={() => setPanel(null)}
        onSubmit={() => setPanel(null)}
      >
        <div className="space-y-1.5">
          <Label>Archivo</Label>
          <Input type="file" />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo de datos</Label>
          <select className="h-8 w-full rounded-[7px] border border-input bg-background px-2.5 text-[13px] focus-visible:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35">
            <option>Movimientos</option>
            <option>Cuentas</option>
            <option>Presupuestos</option>
          </select>
        </div>
      </MockActionPanel>
    </>
  )
}
