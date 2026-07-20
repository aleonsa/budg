import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Label } from './label'

describe('Label', () => {
  it('focuses its associated control when clicked', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Label htmlFor="account-name">Nombre</Label>
        <input id="account-name" />
      </div>,
    )

    await user.click(screen.getByText('Nombre'))

    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveFocus()
  })
})
