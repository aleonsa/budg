-- +goose Up
CREATE TABLE public.rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    field text NOT NULL CHECK (field IN ('merchant', 'description')),
    operator text NOT NULL CHECK (operator IN ('contains', 'startsWith')),
    value text NOT NULL CHECK (btrim(value) <> ''),
    category_id uuid NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    priority integer NOT NULL DEFAULT 1 CHECK (priority >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (user_id, id),

    CONSTRAINT rules_category_same_user
        FOREIGN KEY (user_id, category_id)
        REFERENCES public.categories (user_id, id)
        ON DELETE CASCADE
);

CREATE INDEX rules_user_priority_idx
    ON public.rules (user_id, priority, id);

ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rules FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rules TO budg_api;

CREATE POLICY rules_user_scoped ON public.rules
    FOR ALL
    TO budg_api
    USING (user_id::text = current_setting('app.user_id', true))
    WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- +goose Down
DROP TABLE public.rules;
