-- ============================================================================
-- Migration: add partner_id to leads and projects
-- Run this once in Supabase's SQL Editor — safe to re-run (IF NOT EXISTS guards).
-- Partners are stored as team_accounts with role = 'partner' (no new table
-- needed) — this just adds the linking columns so a lead/project can carry
-- a referring partner distinct from its assigned designer.
-- ============================================================================

alter table leads add column if not exists partner_id uuid references team_accounts(id);
alter table projects add column if not exists partner_id uuid references team_accounts(id);
