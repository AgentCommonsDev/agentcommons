-- ClickHouse never read these two control views: member email and name reach it through
-- the user_scope dictionary and session state through session_scope (ADR 0047). Dropping
-- a view drops its grant to ac_trace_control with it.
DROP VIEW IF EXISTS trace_control.users;
DROP VIEW IF EXISTS trace_control.sessions;
