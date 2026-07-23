# Budg Agentic: Especificación y Plan de Arquitectura

## 1. Visión General
Transformar `budg` en un asistente financiero **Agentic** integrado transversalmente en toda la aplicación mediante una burbuja flotante accesible en cualquier vista. El agente conoce el contexto de la pantalla actual, ejecuta operaciones en la base de datos a través de tools/functions, procesa imágenes de comprobantes y tickets mediante visión, y emite notificaciones proactivas vía Web Push en iOS.

---

## 2. Decisiones Tecnológicas Clave

- **Proveedor LLM inicial**:
  - OpenAI mediante el SDK oficial `github.com/openai/openai-go/v3`.
  - Un solo proveedor durante el MVP. El modelo es configurable y se prioriza el
    modelo pequeño más nuevo que soporte Responses API, strict tool schemas y
    structured output.
  - Harness propio, pequeño y determinista. No se adopta un framework agentic.
- **Frontend**:
  - React 19 + TypeScript + Tailwind CSS.
  - Vercel AI SDK (`@ai-sdk/react`) para gestión de streaming (SSE) y adjuntos multimodales.
- **Backend**:
  - Go (Chi router) con endpoints SSE y motor de ejecución de herramientas (*Function Calling*).
- **Notificaciones**:
  - Web Push API + Service Worker (Soportado nativamente en iOS 16.4+ en WebApps instaladas en pantalla de inicio).

---

## 3. Plan de Trabajo en Fases

### Fase 1: Datos Sintéticos para Desarrollo Local

Estado: completada.

- Seed Python local bajo `local/seed/seed.py`, ignorado por Git.
- Base development migrada a versión 13.
- Datos deterministas e idempotentes de 90 días cargados sin copiar información
  personal de producción.

### Fase 2: Backend - Handler de Agente e Integración de LLM

Estado: en implementación.

- Endpoint `/v1/agent/chat` con streaming SSE.
- Structured outputs estrictos para respuestas, inputs y resultados de tools.
- Límites anti-loop, timeout total, idempotencia y confirmación de mutaciones.
- Tools de búsqueda, creación, actualización y eliminación de movimientos.
- Foundation completada: configuración acotada, SDK oficial OpenAI, contratos
  estrictos, provider interface y fake provider para tests.
- Especificación detallada en
  [`agentic/phase-2-backend-agent.md`](agentic/phase-2-backend-agent.md).

### Fase 3: Frontend - Burbuja Flotante y Context-Awareness

Estado: completada (PR #39 desplegado en Vercel).

- Burbuja flotante `FabChat` en `AppShell`.
- Hook `useViewContext` para ruta y entidad visible.
- Cliente SSE con `fetch + ReadableStream`.
- Store de Zustand y renderizado de markdown mínimo.

### Fase 4: Capacidades Multimodales (Comprobantes y OCR)

Estado: completada (rama `feat/agentic-phase-4-multimodal`).

- Soporte de adjuntos de imágenes (comprobantes SPEI, tickets, vouchers) en el chat, con selector de archivos y pegado desde el portapapeles.
- Contrato ampliado (`ContentImage` / `Message.Images`) con validación estricta: allow-list de MIME (jpeg/png/webp/heic), tope de 5 MiB y máximo 4 imágenes por mensaje; se permite turno solo-imagen.
- Envío multimodal como data URL base64 al Responses API (`input_text` + `input_image`).
- System prompt de OCR (v2026-07-23.1): extrae monto/fecha/comercio/tipo, infiere la cuenta con `list_accounts` y propone `create_transaction` vía el flujo de confirmación existente.
- Especificación detallada en
  [`agentic/phase-4-multimodal-ocr.md`](agentic/phase-4-multimodal-ocr.md).

### Fase 5: Notificaciones Push PWA en iOS
- Service Worker con soporte de Push Manager.
- Registro VAPID en Go y recordatorios proactivos (diarios y fechas de corte).
