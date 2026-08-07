import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamAgentChat } from '@/lib/agent/client'
import { useAgentStore } from './agent'

vi.mock('@/lib/agent/client', () => ({
  streamAgentChat: vi.fn(),
}))

describe('agent store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentStore.getState().reset()
  })

  it('tracks streamed text, tool completion, and confirmation metadata', async () => {
    vi.mocked(streamAgentChat).mockImplementation(async (_params, callbacks) => {
      callbacks.onStarted?.()
      callbacks.onDelta?.({ delta: 'Respuesta parcial' })
      callbacks.onToolStarted?.({ tool: 'create_transaction', callId: 'call-1' })
      callbacks.onToolCompleted?.({
        tool: 'create_transaction',
        callId: 'call-1',
        status: 'success',
      })
      callbacks.onCompleted?.({
        status: 'confirmation_required',
        message: '¿Confirmas el movimiento?',
        summary: 'Propuesta',
        artifacts: [],
        confirmationToken: 'token-1',
        confirmationTool: 'create_transaction',
      })
    })

    await useAgentStore.getState().send('Registra $100', { route: '/transactions' })

    const state = useAgentStore.getState()
    const assistant = state.turns.at(-1)
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: '¿Confirmas el movimiento?',
      status: 'done',
    })
    expect(assistant?.toolActivity).toEqual([
      {
        id: 'call-1',
        callId: 'call-1',
        tool: 'create_transaction',
        status: 'done',
      },
    ])
    expect(state.pendingConfirmation).toMatchObject({
      token: 'token-1',
      toolName: 'create_transaction',
    })
    expect(state.loading).toBe(false)
  })

  it('aborts the active request without turning a partial response into an error', async () => {
    vi.mocked(streamAgentChat).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    const request = useAgentStore.getState().send('Resume mis gastos', { route: '/' })
    useAgentStore.getState().stop()
    await request

    const state = useAgentStore.getState()
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.turns.at(-1)).toMatchObject({ role: 'assistant', status: 'aborted' })

    vi.mocked(streamAgentChat).mockImplementation(async (_params, callbacks) => {
      callbacks.onCompleted?.({
        status: 'completed',
        message: 'Todo bien',
        summary: 'ok',
        artifacts: [],
      })
    })
    await useAgentStore.getState().send('Intenta otra vez', { route: '/' })

    const secondRequest = vi.mocked(streamAgentChat).mock.calls[1][0]
    expect(secondRequest.messages.map(({ content }) => content)).toEqual([
      'Resume mis gastos',
      'Intenta otra vez',
    ])
    expect(secondRequest.messages.every(({ content }) => content.length > 0)).toBe(true)
  })

  it('does not abort a confirmed mutation with an unknown server outcome', async () => {
    let finish: (() => void) | undefined
    vi.mocked(streamAgentChat).mockImplementation(
      (_params, callbacks) =>
        new Promise<void>((resolve) => {
          finish = () => {
            callbacks.onCompleted?.({
              status: 'completed',
              message: 'Movimiento registrado',
              summary: 'ok',
              artifacts: [],
            })
            resolve()
          }
        }),
    )

    const request = useAgentStore
      .getState()
      .send('Sí, confirmo.', { route: '/' }, 'signed-confirmation')
    await vi.waitFor(() => expect(streamAgentChat).toHaveBeenCalledOnce())
    useAgentStore.getState().stop()

    expect(useAgentStore.getState().confirmationInFlight).toBe(true)
    expect(vi.mocked(streamAgentChat).mock.calls[0][0].signal?.aborted).toBe(false)
    finish?.()
    await request
    expect(useAgentStore.getState().confirmationInFlight).toBe(false)
  })

  it('does not mark a semantic tool error as successful', async () => {
    vi.mocked(streamAgentChat).mockImplementation(async (_params, callbacks) => {
      callbacks.onToolStarted?.({ tool: 'search_transactions', callId: 'call-error' })
      callbacks.onToolCompleted?.({
        tool: 'search_transactions',
        callId: 'call-error',
        status: 'error',
      })
      callbacks.onCompleted?.({
        status: 'completed',
        message: 'No pude consultar esos movimientos.',
        summary: 'error de herramienta',
        artifacts: [],
      })
    })

    await useAgentStore.getState().send('Busca movimientos', { route: '/' })

    expect(useAgentStore.getState().turns.at(-1)?.toolActivity?.[0].status).toBe('failed')
  })

  it('ignores settlement from a request reset before a newer send', async () => {
    let rejectFirst: ((reason: Error) => void) | undefined
    let finishSecond: (() => void) | undefined
    vi.mocked(streamAgentChat)
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject
          }),
      )
      .mockImplementationOnce(
        (_params, callbacks) =>
          new Promise<void>((resolve) => {
            finishSecond = () => {
              callbacks.onCompleted?.({
                status: 'completed',
                message: 'Respuesta nueva',
                summary: 'ok',
                artifacts: [],
              })
              resolve()
            }
          }),
      )

    const firstRequest = useAgentStore.getState().send('Primera solicitud', { route: '/' })
    await vi.waitFor(() => expect(streamAgentChat).toHaveBeenCalledOnce())
    useAgentStore.getState().reset()

    const secondRequest = useAgentStore.getState().send('Segunda solicitud', { route: '/' })
    await vi.waitFor(() => expect(streamAgentChat).toHaveBeenCalledTimes(2))
    rejectFirst?.(new DOMException('Aborted', 'AbortError'))
    await firstRequest

    expect(useAgentStore.getState().loading).toBe(true)
    expect(useAgentStore.getState().turns.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'sending',
    })

    finishSecond?.()
    await secondRequest
    expect(useAgentStore.getState().turns.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'done',
      content: 'Respuesta nueva',
    })
  })
})
