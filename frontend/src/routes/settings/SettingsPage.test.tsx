import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccounts, useBudgets, useCategories } from '@/hooks/useQueries'
import type { Account, Budget, Category } from '@/types'
import SettingsPage from './SettingsPage'

const authState = vi.hoisted(() => ({
  user: { name: 'Ada Lovelace', email: 'ada@budg.test' } as { name: string; email: string } | null,
  signOut: vi.fn(),
  updateProfile: vi.fn(),
}))

const themeState = vi.hoisted(() => ({
  theme: 'system' as 'system' | 'light' | 'dark',
  setTheme: vi.fn(),
}))

vi.mock('@/hooks/useQueries', () => ({
  useAccounts: vi.fn(),
  useBudgets: vi.fn(),
  useCategories: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuth: (selector: (state: typeof authState) => unknown) => selector(authState),
}))

vi.mock('@/stores/theme', () => ({
  useTheme: (selector: (state: typeof themeState) => unknown) => selector(themeState),
}))

const categories: Category[] = Array.from({ length: 3 }, (_, index) => ({
  id: `category-${index}`,
  name: `Category ${index}`,
  kind: 'expense' as const,
  color: 'blue' as const,
  icon: 'Tag',
  parentId: null,
  isSystem: false,
  order: index,
}))

const accounts: Account[] = [
  {
    id: 'one',
    name: 'One',
    type: 'debit',
    institution: 'Bank',
    last4: '1111',
    currency: 'MXN',
    balance: 0,
    isActive: true,
  },
  {
    id: 'two',
    name: 'Two',
    type: 'debit',
    institution: 'Bank',
    last4: '2222',
    currency: 'MXN',
    balance: 0,
    isActive: true,
  },
]

const budgets: Budget[] = [
  {
    id: 'one',
    categoryId: 'category-0',
    amount: 10000,
    period: 'monthly',
    startDate: '2026-01-01',
  },
]

function setQueries() {
  vi.mocked(useCategories).mockReturnValue({ data: categories, isLoading: false } as ReturnType<
    typeof useCategories
  >)
  vi.mocked(useAccounts).mockReturnValue({ data: accounts, isLoading: false } as ReturnType<
    typeof useAccounts
  >)
  vi.mocked(useBudgets).mockReturnValue({ data: budgets, isLoading: false } as ReturnType<
    typeof useBudgets
  >)
}

function Location() {
  return <output aria-label="current path">{useLocation().pathname}</output>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Location />
              <SettingsPage />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { name: 'Ada Lovelace', email: 'ada@budg.test' }
    themeState.theme = 'system'
    setQueries()
  })

  it('shows profile identity and live resource counts', () => {
    renderPage()

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@budg.test')).toBeInTheDocument()
    expect(screen.getByText('A', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Gestionar categorías 3/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Gestionar presupuestos 1/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cuentas registradas 2/ })).toBeInTheDocument()
  })

  it('shows loading count badges while query data is pending', () => {
    vi.mocked(useCategories).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useCategories
    >)
    vi.mocked(useAccounts).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useAccounts
    >)
    vi.mocked(useBudgets).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useBudgets
    >)
    renderPage()

    expect(screen.getByRole('link', { name: /Gestionar categorías Cargando…/ })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Gestionar presupuestos Cargando…/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cuentas registradas Cargando…/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Gestionar categorías 0/ })).not.toBeInTheDocument()
  })

  it('shows accessible dependency errors instead of zero counts while preserving local settings', async () => {
    const user = userEvent.setup()
    vi.mocked(useCategories).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('categories unavailable'),
    } as ReturnType<typeof useCategories>)
    vi.mocked(useAccounts).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('accounts unavailable'),
    } as ReturnType<typeof useAccounts>)
    vi.mocked(useBudgets).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('budgets unavailable'),
    } as ReturnType<typeof useBudgets>)
    renderPage()

    expect(screen.getByRole('alert', { name: 'Error al cargar categorías' })).toBeInTheDocument()
    expect(screen.getByRole('alert', { name: 'Error al cargar cuentas' })).toBeInTheDocument()
    expect(screen.getByRole('alert', { name: 'Error al cargar presupuestos' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Gestionar categorías 0/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Gestionar presupuestos 0/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Cuentas registradas 0/ })).not.toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Oscuro' }))
    expect(themeState.setTheme).toHaveBeenCalledWith('dark')
    await user.click(screen.getByRole('button', { name: 'Editar perfil' }))
    expect(screen.getByRole('dialog', { name: 'Editar perfil' })).toBeInTheDocument()
  })

  it('shows anonymous defaults and zero counts after successful empty queries', async () => {
    const user = userEvent.setup()
    authState.user = null
    vi.mocked(useCategories).mockReturnValue({
      data: [] as Category[],
      isLoading: false,
    } as ReturnType<typeof useCategories>)
    vi.mocked(useAccounts).mockReturnValue({
      data: [] as Account[],
      isLoading: false,
    } as ReturnType<typeof useAccounts>)
    vi.mocked(useBudgets).mockReturnValue({
      data: [] as Budget[],
      isLoading: false,
    } as ReturnType<typeof useBudgets>)
    renderPage()

    expect(screen.getByText('Usuario Demo')).toBeInTheDocument()
    expect(screen.getByText('demo@budg.app')).toBeInTheDocument()
    expect(screen.getByText('U', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Gestionar categorías 0/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Gestionar presupuestos 0/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cuentas registradas 0/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Editar perfil' }))
    expect(screen.getByPlaceholderText('Usuario Demo')).toHaveValue('')
    expect(screen.getByDisplayValue('demo@budg.app')).toBeDisabled()
  })

  it('edits and trims the profile name while keeping email read-only', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Editar perfil' }))
    const nameInput = screen.getByPlaceholderText('Usuario Demo')
    expect(nameInput).toHaveValue('Ada Lovelace')
    expect(screen.getByDisplayValue('ada@budg.test')).toBeDisabled()
    await user.clear(nameInput)
    await user.type(nameInput, '  Grace Hopper  ')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(authState.updateProfile).toHaveBeenCalledWith({ name: 'Grace Hopper' })
    expect(
      screen.queryByText('Actualiza tu nombre de usuario (se guarda en el navegador).'),
    ).not.toBeInTheDocument()
  })

  it('closes a blank profile edit without updating the store', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Editar perfil' }))
    await user.clear(screen.getByPlaceholderText('Usuario Demo'))
    await user.type(screen.getByPlaceholderText('Usuario Demo'), '   ')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(authState.updateProfile).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Actualiza tu nombre de usuario (se guarda en el navegador).'),
    ).not.toBeInTheDocument()
  })

  it('discards an edited profile when the user cancels', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Editar perfil' }))
    await user.clear(screen.getByPlaceholderText('Usuario Demo'))
    await user.type(screen.getByPlaceholderText('Usuario Demo'), 'New name')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(authState.updateProfile).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Actualiza tu nombre de usuario (se guarda en el navegador).'),
    ).not.toBeInTheDocument()
  })

  it('sends each theme choice to the theme store', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Claro' }))
    await user.click(screen.getByRole('button', { name: 'Oscuro' }))
    await user.click(screen.getByRole('button', { name: 'Sistema' }))

    expect(themeState.setTheme).toHaveBeenNthCalledWith(1, 'light')
    expect(themeState.setTheme).toHaveBeenNthCalledWith(2, 'dark')
    expect(themeState.setTheme).toHaveBeenNthCalledWith(3, 'system')
  })

  it('opens and completes export and import flows', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'CSV' }))
    expect(
      screen.getByText('Prepara una exportación CSV/JSON de tus movimientos.'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'Todo el historial')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'JSON')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(
      screen.queryByText('Prepara una exportación CSV/JSON de tus movimientos.'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'CSV' }))
    await user.click(screen.getByRole('button', { name: 'Preparar CSV' }))
    expect(
      screen.queryByText('Prepara una exportación CSV/JSON de tus movimientos.'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Importar' }))
    expect(
      screen.getByText('Carga un archivo para validar el flujo de importación.'),
    ).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), 'Presupuestos')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(
      screen.queryByText('Carga un archivo para validar el flujo de importación.'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Importar' }))
    await user.click(screen.getByRole('button', { name: 'Validar archivo' }))
    expect(
      screen.queryByText('Carga un archivo para validar el flujo de importación.'),
    ).not.toBeInTheDocument()
  })

  it('signs out before replacing the current route with login', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(authState.signOut).toHaveBeenCalledOnce()
    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent('/login')
  })

  it.each([
    ['Gestionar categorías', '/categories'],
    ['Gestionar presupuestos', '/budgets'],
    ['Reglas de categorización', '/rules'],
    ['Cuentas registradas', '/accounts'],
  ])('navigates from %s to %s', async (label, path) => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('link', { name: new RegExp(label) }))

    expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent(path)
  })
})
