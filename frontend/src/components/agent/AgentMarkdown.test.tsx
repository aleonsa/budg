import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentMarkdown } from './AgentMarkdown'

describe('AgentMarkdown', () => {
  it('renders GFM structure and safe external links', () => {
    render(
      <AgentMarkdown>{`## Resumen

- **Comida:** $320
- [Detalle](https://example.com)

| Cuenta | Saldo |
| --- | ---: |
| Débito | $100 |`}</AgentMarkdown>,
    )

    expect(screen.getByRole('heading', { name: 'Resumen' })).toBeInTheDocument()
    expect(screen.getByRole('list')).toHaveTextContent('Comida: $320')
    expect(screen.getByRole('link', { name: 'Detalle' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('table')).toHaveTextContent('Débito')
  })

  it('renders fenced code with a language label and copy control', () => {
    render(<AgentMarkdown>{'```json\n{"total": 100}\n```'}</AgentMarkdown>)

    expect(screen.getByText('json')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeInTheDocument()
    expect(screen.getByText(/"total"/)).toBeInTheDocument()
  })
})
