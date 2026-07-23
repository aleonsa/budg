import type { AgentImage } from './types'

// Mirrors the backend allow-list (internal/agent/contracts.go) and size bound
// (internal/httpapi/agent.go). Enforcing it client-side gives immediate
// feedback and avoids a wasted round trip for an obviously invalid file.
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MiB, matches backend maxImageBytes
export const MAX_IMAGES_PER_MESSAGE = 4 // matches backend maxAgentImagesPerMessage

export interface AttachedImage extends AgentImage {
  /** Stable id for list rendering and removal in the UI. */
  id: string
  /** Object URL for the preview thumbnail; revoke when the attachment is dropped. */
  previewUrl: string
  /** Original filename, shown as a fallback label. */
  name: string
}

export class ImageValidationError extends Error {}

/**
 * Reads a File into an AttachedImage carrying a base64 data URL the backend
 * accepts. Rejects unsupported MIME types and oversized files up front with an
 * ImageValidationError so the caller can surface a friendly message.
 */
export async function fileToAttachedImage(file: File): Promise<AttachedImage> {
  const mimeType = file.type.toLowerCase()
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
    throw new ImageValidationError('Formato no soportado. Usa JPG, PNG, WEBP o HEIC.')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError('La imagen supera el límite de 5 MB.')
  }

  const dataUrl = await readAsDataURL(file)
  return {
    id: imageId(),
    mimeType,
    // The backend accepts a full data URL and passes it through unchanged.
    data: dataUrl,
    previewUrl: URL.createObjectURL(file),
    name: file.name || 'imagen',
  }
}

/** Strips UI-only fields, returning the wire shape the backend expects. */
export function toAgentImage(image: AttachedImage): AgentImage {
  return { mimeType: image.mimeType, data: image.data }
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ImageValidationError('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
}

function imageId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `img-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
