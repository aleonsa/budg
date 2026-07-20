import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info } from 'lucide-react'
import { Button, Card, Input, Label } from '@/components/ui'
import { useAuth } from '@/stores/auth'

const DEMO_EMAIL = 'demo@budg.app'
const DEMO_PASSWORD = 'demo1234'

export default function LoginPage() {
  const navigate = useNavigate()
  const signIn = useAuth((s) => s.signIn)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = (emailValue: string, passwordValue: string) => {
    setError(null)
    if (!emailValue.trim() || !passwordValue.trim()) {
      setError('Ingresa email y contraseña.')
      return
    }
    setSubmitting(true)
    // Simulate a tiny delay for UX realism
    setTimeout(() => {
      signIn(emailValue, passwordValue)
      navigate('/', { replace: true })
    }, 250)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit(email, password)
  }

  const useDemoCredentials = () => {
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    submit(DEMO_EMAIL, DEMO_PASSWORD)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--sidebar-bg))] p-4">
      <div className="w-full max-w-[340px] space-y-3.5">
        {/* Brand */}
        <div className="text-center">
          <p className="text-xl font-semibold tracking-[-0.045em] text-foreground">budg</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tu centro de control financiero
          </p>
        </div>

        <Card className="p-4 shadow-[0_8px_28px_rgba(0,0,0,0.05)]">
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Ingresando…' : 'Iniciar sesión'}
            </Button>
          </form>

          {/* Demo credentials banner */}
          <div className="mt-3.5 flex items-start gap-2 rounded-[8px] bg-muted p-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--color-blue))]" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-foreground">
                Ambiente mock — usa credenciales demo
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {DEMO_EMAIL} / {DEMO_PASSWORD}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={useDemoCredentials}
                disabled={submitting}
              >
                Usar credenciales demo
              </Button>
            </div>
          </div>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          Demo local · los datos se reinician al recargar
        </p>
      </div>
    </div>
  )
}
