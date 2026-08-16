-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT goal.user_id
        FROM public.savings_goals goal
        JOIN public.accounts account
            ON account.user_id = goal.user_id AND account.id = goal.account_id
        WHERE goal.current_amount > 0
        GROUP BY goal.user_id
        HAVING COUNT(DISTINCT account.currency) > 1
    ) THEN
        RAISE EXCEPTION 'cannot backfill savings goals spanning multiple currencies; reconcile account links first';
    END IF;
END;
$$;
-- +goose StatementEnd

INSERT INTO public.savings_goal_allocations (
    user_id, goal_id, account_id, amount_cents, kind, occurred_on
)
SELECT user_id, id, account_id, current_amount, 'opening', created_at::date
FROM public.savings_goals
WHERE current_amount > 0;

UPDATE public.savings_goals
SET is_completed = current_amount >= target_amount
WHERE is_completed IS DISTINCT FROM (current_amount >= target_amount);

-- +goose Down
DELETE FROM public.savings_goal_allocations
WHERE kind = 'opening' AND transaction_id IS NULL;
