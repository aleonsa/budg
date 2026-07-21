\set ON_ERROR_STOP on

\if :{?budg_api_password}
\else
\echo 'budg_api_password psql variable is required'
\quit
\endif

SELECT format(
    'CREATE ROLE budg_api LOGIN BYPASSRLS PASSWORD %L',
    :'budg_api_password'
)
WHERE NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'budg_api'
) \gexec

SELECT format(
    'ALTER ROLE budg_api WITH LOGIN BYPASSRLS PASSWORD %L',
    :'budg_api_password'
) \gexec

ALTER ROLE budg_api SET statement_timeout = '15s';
ALTER ROLE budg_api SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE budg_api SET search_path = public, pg_catalog;

GRANT CONNECT ON DATABASE postgres TO budg_api;
REVOKE CREATE ON SCHEMA public FROM budg_api;
GRANT USAGE ON SCHEMA public TO budg_api;
