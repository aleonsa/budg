# Fase 4: Capacidades Multimodales (Comprobantes y OCR)

## Objetivo

Permitir que el usuario adjunte imágenes de comprobantes de transferencia (SPEI),
vouchers de terminal, tickets de compra o estados de cuenta en la burbuja de
chat (`FabChat`), para que el agente extraiga la información relevante mediante
visión y proponga automáticamente el registro o la conciliación del movimiento
usando el flujo de confirmación existente (`create_transaction`).

---

## 1. Diseño de Arquitectura Multimodal

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (FabChat.tsx)                          │
│                                                                        │
│  - Selector de archivos / Pegar imagen (Clipboard / Drag & Drop)       │
│  - Preview miniatura en el input del chat                              │
│  - Envío como base64 (data URL) junto al texto y vista actual          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼  POST /v1/agent/chat (SSE)
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND (internal/agent)                        │
│                                                                        │
│  1. Recepción de attachments (imagen base64 o URL de datos)            │
│  2. Ampliación de contratos (ModelRequest.Images / ContentImage)       │
│  3. Adaptador OpenAI (openai.go): Mapeo a formato multimodal de        │
│     Responses API (image_url / input_image)                            │
│  4. System prompt reforzado para OCR financiero (extracción de monto,  │
│     comercio, fecha, tipo de movimiento e inferencia de cuenta)        │
│  5. Ejecución del loop acotado y propuesta vía create_transaction      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Contratos y Cambios en Backend

### 2.1 Ampliación de `Message` / `ModelRequest` (`backend/internal/agent/contracts.go`)

Se añade soporte para imágenes adjuntas por turno:

```go
type ContentImage struct {
    MimeType string `json:"mimeType"` // ej. image/jpeg, image/png
    Data     string `json:"data"`     // base64 o data URL
}

type Message struct {
    Role    Role           `json:"role"`
    Content string         `json:"content"`
    Images  []ContentImage `json:"images,omitempty"`
}
```

El validador de requests (`ModelRequest.Validate`) verificará:
- Tipos MIME permitidos: `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
- Tamaño máximo de imagen acotado (ej. < 5 MiB para evitar saturar el contexto del LLM).

### 2.2 Adaptador OpenAI (`backend/internal/agent/openai.go`)

El SDK oficial `openai-go/v3` soporta entradas multimodales en la Responses API mediante `ResponseInputItemParamOfMessage` con listas de contenido (`ResponseInputMessageContentListParam`), aceptando tanto texto como `input_image` / URLs de datos base64 (`data:image/...;base64,...`).

### 2.3 System Prompt Actualizado (`backend/internal/agent/prompt.go`)

Se añade instrucción específica de OCR y extracción:
- Cuando el usuario adjunte un comprobante o ticket, analiza la imagen para extraer:
  1. Monto exacto.
  2. Fecha del movimiento.
  3. Comercio o beneficiario (merchant).
  4. Tipo (gasto o ingreso).
  5. Cuenta sugerida (basada en las cuentas del usuario provistas por `list_accounts`).
- Con esos datos, invoca `create_transaction` en modo propuesta para que el usuario confirme.

---

## 3. Experiencia de Usuario (Frontend)

1. **Input bar mejorado**:
   - Botón de clip (`Paperclip`) o icono de cámara/imagen para adjuntar archivos.
   - Soporta pegar imágenes directamente desde el portapapeles (`Ctrl+V` / `Cmd+V`) dentro del input del chat.
   - Muestra una miniatura flotante con botón para remover el adjunto antes de enviar.
2. **Historial y Estado**:
   - El mensaje del usuario en el chat muestra la miniatura de la imagen adjunta junto al texto.
   - El agente procesa la imagen y responde con la propuesta de registro (ej. "Detecté un pago de MXN 450.00 en *La Buena* el 20 de julio. ¿Deseas registrarlo en *Tarjeta Banamex*?").

---

## 4. Plan de Implementación por Pasos

1. **Paso 4.1**: Ampliar contratos en `backend/internal/agent/contracts.go` para aceptar `Images []ContentImage` en `Message`, con tests de validación.
2. **Paso 4.2**: Actualizar el adaptador `backend/internal/agent/openai.go` para enviar imágenes al Responses API con `openai-go/v3`.
3. **Paso 4.3**: Ajustar `backend/internal/httpapi/agent.go` y tipos de frontend (`lib/agent/types.ts`) para aceptar `images?: { mimeType: string; data: string }[]`.
4. **Paso 4.4**: Implementar UI de adjunto y preview en `FabChat.tsx` (selector + portapapeles).
5. **Paso 4.5**: Verificación completa con quality gates y pruebas locales.
