import { afterEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '@/lib/api/backend'
import { streamAgentChat } from './client'

vi.mock('@/lib/api/backend', () => ({
  authFetch: vi.fn(),
  backendUrl: vi.fn(),
}))

const encoder = new TextEncoder()

function streamResponse(frames: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        frames.forEach((frame) => controller.enqueue(encoder.encode(`data: ${frame}\n\n`)))
        controller.close()
      },
    }),
    { status: 200 },
  )
}

describe('streamAgentChat', () => {
  afterEach(() => vi.clearAllMocks())

  it('dispatches deltas, tool lifecycle, and final response in order', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      streamResponse([
        '{"type":"response.started","runId":"run-1","sequence":1}',
        '{"type":"response.delta","runId":"run-1","sequence":2,"data":{"delta":"Hola"}}',
        '{"type":"tool.started","runId":"run-1","sequence":3,"data":{"tool":"list_accounts","callId":"call-1"}}',
        '{"type":"tool.completed","runId":"run-1","sequence":4,"data":{"tool":"list_accounts","callId":"call-1","status":"success"}}',
        '{"type":"response.completed","runId":"run-1","sequence":5,"data":{"status":"completed","message":"Hola","summary":"ok","artifacts":[]}}',
      ]),
    )
    const events: string[] = []

    await streamAgentChat(
      { messages: [{ role: 'user', content: 'Hola' }] },
      {
        onStarted: () => events.push('started'),
        onDelta: ({ delta }) => events.push(delta),
        onToolStarted: ({ callId }) => events.push(`start:${callId}`),
        onToolCompleted: ({ callId }) => events.push(`done:${callId}`),
        onCompleted: ({ message }) => events.push(message),
      },
    )

    expect(events).toEqual(['started', 'Hola', 'start:call-1', 'done:call-1', 'Hola'])
  })

  it('rejects a stream that closes without a terminal frame', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      streamResponse(['{"type":"response.started","runId":"run-1","sequence":1}']),
    )

    await expect(
      streamAgentChat({ messages: [{ role: 'user', content: 'Hola' }] }, {}),
    ).rejects.toThrow(/interrumpió antes de completarse/i)
  })

  it('cancels the reader immediately after a terminal frame', async () => {
    let cancelled = false
    vi.mocked(authFetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"type":"response.completed","runId":"run-1","sequence":1,"data":{"status":"completed","message":"Listo","summary":"ok","artifacts":[]}}\n\n',
              ),
            )
          },
          cancel() {
            cancelled = true
          },
        }),
        { status: 200 },
      ),
    )

    await streamAgentChat({ messages: [{ role: 'user', content: 'Hola' }] }, {})

    expect(cancelled).toBe(true)
  })
})
