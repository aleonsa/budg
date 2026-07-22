package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// ToolHandler executes a tool against validated arguments and returns a
// normalized result. Handlers must never leak internal errors to the model;
// they translate failures into ToolResult with a safe summary or return an
// error only for unexpected, non-recoverable conditions.
type ToolHandler func(ctx context.Context, arguments json.RawMessage) (ToolResult, error)

// Tool binds a definition (exposed to the model) with its handler.
type Tool struct {
	Definition ToolDefinition
	Handler    ToolHandler
}

// ToolRegistry holds the tools available to a runner. It is read-only after
// construction from the loop's perspective: registration happens during setup.
type ToolRegistry struct {
	order []string
	tools map[string]Tool
}

func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{tools: make(map[string]Tool)}
}

// Register validates and stores a tool. Duplicate names and malformed
// definitions are rejected so the model can never see an ambiguous tool set.
func (r *ToolRegistry) Register(tool Tool) error {
	name := strings.TrimSpace(tool.Definition.Name)
	if name == "" {
		return fmt.Errorf("tool name is required")
	}
	if tool.Handler == nil {
		return fmt.Errorf("tool %q requires a handler", name)
	}
	if _, exists := r.tools[name]; exists {
		return fmt.Errorf("duplicate tool %q", name)
	}
	if err := validateStrictObjectSchema(tool.Definition.InputSchema); err != nil {
		return fmt.Errorf("tool %q input schema: %w", name, err)
	}
	r.tools[name] = tool
	r.order = append(r.order, name)
	return nil
}

// Definitions returns tool definitions in registration order for the model
// request. The slice is a copy so callers cannot mutate the registry.
func (r *ToolRegistry) Definitions() []ToolDefinition {
	definitions := make([]ToolDefinition, 0, len(r.order))
	for _, name := range r.order {
		definitions = append(definitions, r.tools[name].Definition)
	}
	return definitions
}

func (r *ToolRegistry) lookup(name string) (Tool, bool) {
	tool, ok := r.tools[name]
	return tool, ok
}
