-- +goose Up
ALTER TABLE public.savings_goals
    ADD COLUMN target_date date;

-- +goose Down
ALTER TABLE public.savings_goals
    DROP COLUMN target_date;
