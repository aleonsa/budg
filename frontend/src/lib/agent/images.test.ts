import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileToAttachedImage, ImageValidationError, MAX_IMAGE_BYTES, toAgentImage } from './images'

// jsdom does not implement createObjectURL; stub it so the helper can build a
// preview URL without touching a real browser API.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
})

function makeFile(type: string, size: number, name = 'ticket.jpg'): File {
  const file = new File(['x'], name, { type })
  // Override size (the constructor content is tiny) so we can exercise the bound.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('fileToAttachedImage', () => {
  it('reads an allowed image into a data URL wire payload', async () => {
    const file = makeFile('image/jpeg', 1024)
    const attached = await fileToAttachedImage(file)

    expect(attached.mimeType).toBe('image/jpeg')
    expect(attached.data.startsWith('data:')).toBe(true)
    expect(attached.previewUrl).toBe('blob:preview')
    expect(attached.name).toBe('ticket.jpg')
    expect(attached.id).toBeTruthy()
  })

  it('rejects an unsupported MIME type', async () => {
    await expect(fileToAttachedImage(makeFile('application/pdf', 1024))).rejects.toBeInstanceOf(
      ImageValidationError,
    )
  })

  it('rejects a file over the size bound', async () => {
    await expect(
      fileToAttachedImage(makeFile('image/png', MAX_IMAGE_BYTES + 1)),
    ).rejects.toBeInstanceOf(ImageValidationError)
  })
})

describe('toAgentImage', () => {
  it('strips UI-only fields, keeping just the wire shape', async () => {
    const attached = await fileToAttachedImage(makeFile('image/webp', 512))
    expect(toAgentImage(attached)).toEqual({ mimeType: 'image/webp', data: attached.data })
  })
})
