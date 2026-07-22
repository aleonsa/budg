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
- Componente de burbuja flotante (`FabChat`) persistente en `AppShell`.
- Hook `useViewContext()` para inyectar la ruta y estado activo al LLM.

### Fase 4: Capacidades Multimodales (Comprobantes y OCR)
- Soporte para adjuntar imágenes/fotos en el chat.
- Procesamiento visual para conciliación y registro automático de gastos.

### Fase 5: Notificaciones Push PWA en iOS
- Service Worker con soporte de Push Manager.
- Registro VAPID en Go y recordatorios proactivos (diarios y fechas de corte).
