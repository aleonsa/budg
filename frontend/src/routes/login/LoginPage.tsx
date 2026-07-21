import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Input, Label } from '@/components/ui'
import { useAuth } from '@/stores/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const signIn = useAuth((s) => s.signIn)
  const storeError = useAuth((s) => s.error)
  const clearError = useAuth((s) => s.clearError)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const activeError = error ?? storeError

  const submit = async (emailValue: string, passwordValue: string) => {
    setError(null)
    clearError()
    if (!emailValue.trim() || !passwordValue.trim()) {
      setError('Ingresa email y contraseña.')
      return
    }
    setSubmitting(true)
    const result = await signIn(emailValue, passwordValue)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error ?? 'No se pudo iniciar sesión.')
      return
    }
    navigate('/', { replace: true })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void submit(email, password)
  }

  const emailInvalid = activeError !== null && !email.trim()
  const passwordInvalid = activeError !== null && !password.trim()
  const showCredentialsError = activeError !== null && !emailInvalid && !passwordInvalid

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--sidebar-bg))] p-4">
      <div className="w-full max-w-[340px] space-y-3.5">
        {/* Brand */}
        <div className="text-center">
          <p className="text-xl font-semibold tracking-[-0.045em] text-foreground">budg</p>
          <p className="mt-1 text-xs text-muted-foreground">Tu centro de control financiero</p>
        </div>

        <Card className="p-4 shadow-[0_8px_28px_rgba(0,0,0,0.05)]">
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                aria-invalid={emailInvalid ? true : undefined}
                aria-describedby={emailInvalid ? 'login-error' : undefined}
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
                aria-invalid={passwordInvalid ? true : undefined}
                aria-describedby={passwordInvalid ? 'login-error' : undefined}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {activeError && (
              <p id="login-error" role="alert" className="text-xs text-destructive">
                {showCredentialsError ? activeError : 'Ingresa email y contraseña.'}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Ingresando…' : 'Iniciar sesión'}
            </Button>
          </form>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          Inicia sesión con tu cuenta Supabase
        </p>
      </div>
    </div>
  )
}
