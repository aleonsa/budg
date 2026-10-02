package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

var ErrIdempotencyReplayDeleted = errors.New("idempotent create already completed and resource was deleted")

type IdempotencyReplayDeletedError struct {
	ResourceID string
}

func (e *IdempotencyReplayDeletedError) Error() string {
	return ErrIdempotencyReplayDeleted.Error()
}

func (e *IdempotencyReplayDeletedError) Unwrap() error {
	return ErrIdempotencyReplayDeleted
}

func IdempotencyReplayDeletedResourceID(err error) (string, bool) {
	var replayErr *IdempotencyReplayDeletedError
	if !errors.As(err, &replayErr) {
		return "", false
	}
	return replayErr.ResourceID, true
}

func newIdempotencyReplayDeletedError(resourceID string) error {
	return &IdempotencyReplayDeletedError{ResourceID: resourceID}
}

func beginIdempotentCreate(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	idempotencyKey *string,
	resourceType string,
	request any,
) (string, bool, error) {
	if idempotencyKey == nil {
		return "", false, nil
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return "", false, fmt.Errorf("marshal idempotent create request: %w", err)
	}
	digest := sha256.Sum256(payload)
	requestHash := hex.EncodeToString(digest[:])

	var claimed string
	err = tx.QueryRow(ctx, `
		INSERT INTO public.create_idempotency_receipts (
			user_id, idempotency_key, resource_type, request_hash
		)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, resource_type, idempotency_key) DO NOTHING
		RETURNING idempotency_key
	`, userID, *idempotencyKey, resourceType, requestHash).Scan(&claimed)
	if err == nil {
		return "", false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}

	var existingHash string
	var resourceID *string
	if err := tx.QueryRow(ctx, `
		SELECT request_hash, resource_id::text
		FROM public.create_idempotency_receipts
		WHERE user_id = $1 AND resource_type = $2 AND idempotency_key = $3
	`, userID, resourceType, *idempotencyKey).Scan(&existingHash, &resourceID); err != nil {
		return "", false, err
	}
	if existingHash != requestHash {
		return "", false, ErrIdempotencyConflict
	}
	if resourceID == nil {
		return "", false, errors.New("idempotency receipt is incomplete")
	}
	return *resourceID, true, nil
}

func completeIdempotentCreate(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	idempotencyKey *string,
	resourceType string,
	resourceID string,
) error {
	if idempotencyKey == nil {
		return nil
	}
	tag, err := tx.Exec(ctx, `
		UPDATE public.create_idempotency_receipts
		SET resource_id = $4
		WHERE user_id = $1 AND resource_type = $2 AND idempotency_key = $3 AND resource_id IS NULL
	`, userID, resourceType, *idempotencyKey, resourceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("complete idempotency receipt: claim not found")
	}
	return nil
}
