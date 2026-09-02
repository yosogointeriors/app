-- ============================================================================
-- Migration: add site_ready, job_title, exact_location, platform to leads
-- Run this once in Supabase's SQL Editor — safe to run even if some/all
-- columns already exist (IF NOT EXISTS guards every statement).
-- ============================================================================

alter table leads add column if not exists site_ready boolean;
alter table leads add column if not exists job_title text;
alter table leads add column if not exists exact_location text;
alter table leads add column if not exists platform text;
