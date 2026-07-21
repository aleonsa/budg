-- +goose Up
CREATE TABLE public.budgets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    category_id uuid,
    amount bigint NOT NULL CHECK (amount > 0),
    period text NOT NULL CHECK (period IN ('weekly', 'monthly', 'yearly')),
    start_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (user_id, id),

    CONSTRAINT budgets_category_same_user
        FOREIGN KEY (user_id, category_id)
        REFERENCES public.categories (user_id, id)
        ON DELETE CASCADE
);

CREATE INDEX budgets_user_idx
    ON public.budgets (user_id);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.budgets FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.budgets TO budg_api;

CREATE POLICY budgets_user_scoped ON public.budgets
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.budgets;
