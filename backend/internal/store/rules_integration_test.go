package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aleonsa/budg/backend/internal/store"
)

func TestRuleRepositoryCRUDToggleAndCategoryCascade(t *testing.T) {
	pool, userID := setupPool(t, "public.rules")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	categories := store.NewCategoryRepository(pool)
	rules := store.NewRuleRepository(pool)
	category, err := categories.Create(ctx, userID, store.CategoryInput{
		Name: "Transport", Kind: "expense", Color: "blue", Icon: "Car", SortOrder: 0,
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}

	created, err := rules.Create(ctx, userID, store.RuleInput{
		Field: "merchant", Operator: "contains", Value: "Uber", CategoryID: category.ID, IsActive: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.UserID != userID || created.Priority != 1 || !created.IsActive {
		t.Fatalf("created row = %+v", created)
	}

	listed, err := rules.List(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("list = %+v, want [%s]", listed, created.ID)
	}

	toggled, err := rules.Toggle(ctx, userID, created.ID)
	if err != nil {
		t.Fatalf("toggle: %v", err)
	}
	if toggled.IsActive {
		t.Fatalf("toggled row = %+v, want inactive", toggled)
	}
	if _, err := rules.Toggle(ctx, userID, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("toggle missing err = %v, want ErrNotFound", err)
	}
	deleted, err := rules.Create(ctx, userID, store.RuleInput{
		Field: "description", Operator: "startsWith", Value: "Ride", CategoryID: category.ID, IsActive: false,
	})
	if err != nil {
		t.Fatalf("create rule to delete: %v", err)
	}
	if err := rules.Delete(ctx, userID, deleted.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := rules.Delete(ctx, userID, deleted.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}

	if err := categories.Delete(ctx, userID, category.ID); err != nil {
		t.Fatalf("delete category: %v", err)
	}
	listed, err = rules.List(ctx, userID)
	if err != nil {
		t.Fatalf("list after category delete: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("list after category delete = %+v, want empty", listed)
	}

	if err := rules.Delete(ctx, userID, created.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete cascaded rule err = %v, want ErrNotFound", err)
	}
}

func TestRuleRepositoryRejectsCategoryOwnedByAnotherUser(t *testing.T) {
	pool, userID := setupPool(t, "public.rules")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	categories := store.NewCategoryRepository(pool)
	category, err := categories.Create(ctx, userID, store.CategoryInput{
		Name: "Food", Kind: "expense", Color: "orange", Icon: "Utensils", SortOrder: 0,
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}

	admin := newAdminPool(t, ctx)
	defer admin.Close()
	otherUserID := seedAuthUser(t, ctx, admin, "22222222-2222-2222-2222-222222222222", "other-user@budg.local")

	_, err = store.NewRuleRepository(pool).Create(ctx, otherUserID, store.RuleInput{
		Field: "merchant", Operator: "contains", Value: "Cafe", CategoryID: category.ID, IsActive: true,
	})
	if err == nil {
		t.Fatal("create rule with another user's category succeeded")
	}
}

func TestRulesRLSDeniesUnscopedAccess(t *testing.T) {
	pool, userID := setupPool(t, "public.rules")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	categories := store.NewCategoryRepository(pool)
	category, err := categories.Create(ctx, userID, store.CategoryInput{
		Name: "Bills", Kind: "expense", Color: "gray", Icon: "Receipt", SortOrder: 0,
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	_, err = store.NewRuleRepository(pool).Create(ctx, userID, store.RuleInput{
		Field: "description", Operator: "startsWith", Value: "Invoice", CategoryID: category.ID, IsActive: true,
	})
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT id FROM public.rules WHERE user_id = $1`, userID)
	if err != nil {
		t.Fatalf("unscoped query: %v", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate: %v", err)
	}
	if count != 0 {
		t.Fatalf("unscoped query saw %d rows, want 0 (RLS should deny without app.user_id set)", count)
	}
}
