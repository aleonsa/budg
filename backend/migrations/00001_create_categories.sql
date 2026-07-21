-- +goose Up
CREATE TABLE public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (btrim(name) <> ''),
    kind text NOT NULL CHECK (kind IN ('expense', 'income')),
    color text NOT NULL CHECK (
        color IN ('blue', 'green', 'red', 'purple', 'yellow', 'orange', 'cyan', 'pink', 'gray')
    ),
    icon text NOT NULL CHECK (btrim(icon) <> ''),
    parent_id uuid,
    is_system boolean NOT NULL DEFAULT false,
    system_key text CHECK (system_key IS NULL OR btrim(system_key) <> ''),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, id),
    CONSTRAINT categories_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT categories_parent_same_user
        FOREIGN KEY (user_id, parent_id)
        REFERENCES public.categories (user_id, id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX categories_user_system_key_idx
    ON public.categories (user_id, system_key)
    WHERE system_key IS NOT NULL;

CREATE INDEX categories_user_sort_idx
    ON public.categories (user_id, sort_order, id);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.categories FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.categories TO budg_api;

-- +goose Down
DROP TABLE public.categories;
