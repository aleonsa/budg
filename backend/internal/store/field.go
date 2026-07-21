package store

import "encoding/json"

// Field represents an optional PATCH field that must distinguish three
// states: absent (the client didn't mention this field at all -- leave it
// unchanged), explicit null (clear it), and present with a value (set it).
//
// A plain double pointer (**T) cannot actually express this with
// encoding/json: UnmarshalJSON is simply never called for a struct field
// whose JSON key is missing from the payload, but it IS called when the key
// is present with a null value -- and in that null case the standard
// library sets the destination to its zero value (nil for **T) exactly the
// same way it would for a field that was never populated in the first
// place. There is no way to observe "was this key present" from the
// decoded pointer alone. Field's UnmarshalJSON, in contrast, only runs when
// the key is present (whatever its value), so Set reliably captures that.
type Field[T any] struct {
	Set   bool
	Value *T // nil when explicitly cleared (`"field": null`)
}

func (f *Field[T]) UnmarshalJSON(data []byte) error {
	f.Set = true
	if string(data) == "null" {
		f.Value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	f.Value = &v
	return nil
}

// MarshalJSON round-trips Field for symmetry (tests and any future
// re-serialization); not required for the current PATCH-only use.
func (f Field[T]) MarshalJSON() ([]byte, error) {
	if f.Value == nil {
		return []byte("null"), nil
	}
	return json.Marshal(f.Value)
}
