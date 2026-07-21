-- +goose Up
CREATE TABLE public.savings_goals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (btrim(name) <> ''),
    target_amount bigint NOT NULL CHECK (target_amount > 0),
    current_amount bigint NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
    account_id uuid,
    is_completed boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (user_id, id),

    CONSTRAINT savings_goals_account_same_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES public.accounts (user_id, id)
        ON DELETE SET NULL
);

CREATE INDEX savings_goals_user_idx
    ON public.savings_goals (user_id, sort_order, id);

ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goals FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.savings_goals FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.savings_goals TO budg_api;

CREATE POLICY savings_goals_user_scoped ON public.savings_goals
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.savings_goals;
