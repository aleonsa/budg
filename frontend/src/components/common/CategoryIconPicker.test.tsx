import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CATEGORY_ICON_OPTIONS } from './category-icon-options'
import { CategoryIconPicker } from './CategoryIconPicker'

describe('CategoryIconPicker', () => {
  it('shows current icon and selects from the complete visual catalog', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CategoryIconPicker value="Tag" color="blue" onChange={onChange} />)

    const trigger = screen.getByRole('button', { name: 'Icono' })
    expect(trigger).toHaveTextContent('General')
    expect(trigger).toHaveTextContent('Tag')

    await user.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Iconos disponibles' })
    expect(listbox).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(CATEGORY_ICON_OPTIONS.length)

    await user.click(screen.getByRole('option', { name: 'Mascotas (PawPrint)' }))
    expect(onChange).toHaveBeenCalledWith('PawPrint')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
