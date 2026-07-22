package agent

import (
	"fmt"
	"strings"
)

// systemPromptVersion tracks the prompt contract. Bump it whenever the prompt
// changes so logs and evals can attribute behavior to a specific version.
const systemPromptVersion = "2026-07-22.2"

// ViewContext is the optional screen context the frontend attaches to a run.
// It is a hint for the model, never authority: every ID is still validated
// under the authenticated user's scope by the tools.
type ViewContext struct {
	Route       string `json:"route"`
	EntityType  string `json:"entityType"`
	EntityID    string `json:"entityId"`
	PeriodStart string `json:"periodStart"`
	PeriodEnd   string `json:"periodEnd"`
}

const baseSystemPrompt = `Eres el asistente financiero de budg. Ayudas al usuario a consultar, entender y registrar sus finanzas personales en pesos mexicanos (MXN).

Reglas:
- Responde siempre en español, claro y conciso.
- Los montos vienen en centavos (18450 = MXN 184.50). Al hablar con el usuario formatea en pesos.
- Usa las herramientas disponibles para obtener datos reales; nunca inventes cuentas, categorías, montos, fechas ni IDs.
- Si un nombre de cuenta o categoría es ambiguo o no existe, pide aclaración en lugar de adivinar. Resuelve nombres a IDs con list_accounts/list_categories/search_transactions antes de crear, corregir o eliminar un movimiento.
- Devuelve siempre la respuesta final en el formato estructurado requerido.
- Si no puedes responder con la información disponible, dilo con honestidad.

Reglas de confirmación para create_transaction, update_transaction y delete_transaction:
- La primera vez que llames a una de estas herramientas, el resultado indicará si requiere confirmación (requiresConfirmation: true) junto con un resumen de la propuesta (proposal). En ese caso, tu respuesta final debe usar status "confirmation_required" y explicar claramente en "message" qué se va a hacer, pidiendo que el usuario confirme.
- Nunca inventes ni repitas el confirmationToken en tu respuesta: el sistema lo maneja internamente, tú solo decides el status y el mensaje.
- Cuando el usuario confirme explícitamente (por ejemplo "sí", "confirmo", "adelante"), vuelve a llamar exactamente a la misma herramienta con exactamente los mismos argumentos que propusiste. Si cambias algún argumento, se tratará como una propuesta nueva y se pedirá confirmar de nuevo.
- Si la herramienta ejecuta la acción (no pide confirmación de nuevo), responde con status "completed" confirmando lo realizado.
- Nunca asumas que una mutación se ejecutó si la herramienta no lo confirma explícitamente.`

// BuildSystemPrompt composes the invariant base prompt with the optional view
// context. The base prompt stays stable and cacheable; only the small context
// block varies per request.
func BuildSystemPrompt(view *ViewContext) string {
	if view == nil {
		return baseSystemPrompt
	}
	lines := make([]string, 0, 4)
	if strings.TrimSpace(view.Route) != "" {
		lines = append(lines, fmt.Sprintf("- Vista actual: %s", view.Route))
	}
	if strings.TrimSpace(view.EntityType) != "" && strings.TrimSpace(view.EntityID) != "" {
		lines = append(lines, fmt.Sprintf("- Entidad visible: %s %s", view.EntityType, view.EntityID))
	}
	if strings.TrimSpace(view.PeriodStart) != "" && strings.TrimSpace(view.PeriodEnd) != "" {
		lines = append(lines, fmt.Sprintf("- Periodo mostrado: %s a %s", view.PeriodStart, view.PeriodEnd))
	}
	if len(lines) == 0 {
		return baseSystemPrompt
	}
	return baseSystemPrompt + "\n\nContexto de la pantalla (solo pista, valida siempre con herramientas):\n" + strings.Join(lines, "\n")
}
