-- ============================================================================
-- YOSOGO — Modular Kitchen · Wardrobe · Full Home Interiors
-- Supabase schema — run this once in your Supabase SQL editor
-- Mirrors the logic used across all 4 portals: Admin, CRM/Design Team,
-- Site & Production, Customer Portal
-- ============================================================================

-- ── ACCOUNTS ────────────────────────────────────────────────────────────────
create table admin_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password text not null,          -- hash in production; demo uses plain
  role text default 'super_admin', -- super_admin | ops_manager
  created_at timestamptz default now()
);

create table team_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password text not null,
  roles text[] not null default '{}',  -- e.g. {sales_head,designer} — a person can hold multiple roles
  city text,                       -- region/city scope, comma-separated for multi
  phone text,
  active boolean default true,
  created_at timestamptz default now()
);

-- Public projection of team_accounts (no email/password) — this is what the
-- Admin/CRM/Site portals read directly with the anon key to show names,
-- assignee dropdowns, etc. Kept in sync with team_accounts by the Worker.
create table team_profiles (
  id uuid primary key,              -- same id as the matching team_accounts row
  name text not null,
  email text,                       -- shown in Admin's Teams tab; not sensitive like a password
  roles text[] not null default '{}',
  city text,
  phone text,
  active boolean default true
);

create table customer_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,                 -- FK added below, once "projects" exists
  name text,
  phone text unique not null,
  otp text,                        -- OTP-based login, phone as username
  created_at timestamptz default now()
);

-- ── LEAD CAPTURE & CRM PIPELINE ─────────────────────────────────────────────
-- source: facebook_ad | website | manual | whatsapp | referral
-- status: new -> contacted -> site_visit_scheduled -> site_visit_done ->
--         design_presented -> quotation_sent -> negotiation -> booked | lost
create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  city text,
  source text default 'manual',
  fb_campaign_name text,
  fb_ad_id text,
  fb_form_id text,
  project_type text,               -- kitchen | wardrobe | full_home | kitchen_wardrobe
  bhk text,                        -- 1BHK/2BHK/3BHK/Villa etc
  budget_range text,
  site_ready boolean,              -- is the site ready for design & installation
  job_title text,                  -- lead's stated occupation/role
  exact_location text,             -- free-text locality from the ad form (city column stays the clean/standard value)
  platform text,                   -- fb | ig | messenger | audience_network (which surface the ad ran on)
  status text default 'new',
  assigned_to uuid references team_accounts(id),
  partner_id uuid references team_accounts(id),  -- referring/business partner (distinct from assigned designer)
  lost_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  note text not null,
  added_by_type text,              -- admin | team
  added_by_id uuid,
  created_at timestamptz default now()
);

-- ── PROJECTS (created when a lead is marked "booked") ───────────────────────
create table projects (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  project_name text,
  project_type text,
  city text,
  address text,
  designer_id uuid references team_accounts(id),
  site_manager_id uuid references team_accounts(id),
  partner_id uuid references team_accounts(id),  -- carried over from the lead's referring partner
  total_value numeric default 0,
  current_stage_order int default 1,
  status text default 'active',    -- active | on_hold | completed | cancelled
  start_date date,
  target_handover_date date,
  actual_handover_date date,
  created_at timestamptz default now()
);

-- Now that "projects" exists, wire up the FK we deferred above.
alter table customer_accounts
  add constraint customer_accounts_project_id_fkey
  foreign key (project_id) references projects(id);

-- 9-stage default project journey, one row seeded per project
create table project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  stage_order int not null,
  stage_name text not null,        -- Site Measurement, Design Finalization, Booking & Advance,
                                    -- Material Procurement, Production, Quality Check,
                                    -- Delivery to Site, Installation, Final Handover
  status text default 'pending',   -- pending | in_progress | completed
  planned_date date,
  completed_date date,
  remarks text
);

create table stage_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  stage_id uuid references project_stages(id) on delete cascade,
  photo_url text not null,
  caption text,
  uploaded_by_type text,           -- team | admin
  uploaded_by_id uuid,
  created_at timestamptz default now()
);

-- ── DESIGN & QUOTATION ───────────────────────────────────────────────────────
create table design_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  room_name text,                  -- Kitchen, Master Wardrobe, Living Room...
  file_url text not null,
  file_name text,                  -- original filename (PDF/DWG/image — not always renderable as <img>)
  version int default 1,
  notes text,
  customer_approved boolean default false,
  customer_comment text,           -- customer's sign-off remark, e.g. "Proceed as per design"
  approved_at timestamptz,
  status text default 'uploaded',  -- uploaded | verified | customer_approved | sent_to_production
  verified_at timestamptz,
  sent_to_production_at timestamptz,
  created_at timestamptz default now()
);

create table quotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  version int default 1,
  items jsonb,                     -- [{item, category, material_spec, length, height, qty, unit_type, rate, amount, note}]
  subtotal_amount numeric,         -- sum of item amounts, before discount
  discount_percent numeric default 0,
  total_amount numeric,            -- final amount AFTER discount — this is what shows everywhere as "the quotation value"
  notes text,                      -- overall quotation note (shown on the PDF, separate from per-item notes)
  status text default 'draft',     -- draft | sent | approved | revised
  source text default 'builder',   -- builder | offline  (offline = uploaded file, not built in-app)
  file_url text,                   -- set when source = 'offline'
  file_name text,
  created_at timestamptz default now()
);

-- Standard line items the quotation builder picks from — this is what the
-- Admin "Quotation Calculator" tab manages. Each row is one specific
-- item + material combination with its own rate (e.g. "Modular Kitchen Base
-- Unit — Plywood + Laminate" vs "...— Plywood + Acrylic" are two separate rows).
create table quotation_catalog (
  id uuid primary key default gen_random_uuid(),
  category text not null,          -- Kitchen | Wardrobe | Living/Hall | Puja | Bedroom | TV Unit | ...
  item_name text not null,         -- e.g. "L-Shape Base Unit"
  material_spec text,              -- e.g. "Plywood + Laminate"
  description text,                -- longer spec text shown on the quotation
  unit_type text default 'sqft',   -- sqft (rate x length x height) | lump (flat rate, qty = count)
  rate numeric not null,           -- per sqft, or lump-sum amount if unit_type = 'lump'
  active boolean default true,
  created_at timestamptz default now()
);

-- Room-wise client requirement checklist, filled per lead during a site
-- visit/requirement call — mirrors the "Room-wise Checklist" tab of your
-- client Excel. One row per section+item the CRM person has touched
-- (ticked, quantified, or noted). Used to pre-fill the quotation builder.
create table client_checklist_items (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  section text not null,            -- e.g. "Kitchen", "Master Bedroom"
  item text not null,               -- e.g. "Modular Base Units"
  required boolean,                 -- true=✓ needed, false=✗ not needed, null=undecided
  qty numeric,
  material text,                    -- preferred material/brand, free text
  remarks text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── PAYMENTS ─────────────────────────────────────────────────────────────────
create table payment_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  milestone_name text,             -- Booking Advance, Production Advance, Pre-delivery, Final
  percentage numeric,
  amount numeric,
  due_date date,
  status text default 'pending'    -- pending | paid | overdue
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  milestone_id uuid references payment_milestones(id),
  amount numeric not null,
  mode text,                       -- UPI | Bank Transfer | Cheque | Card
  txn_ref text,
  screenshot_url text,
  verified boolean default false,
  verified_by uuid,
  paid_at timestamptz default now()
);

-- ── CATALOG (reference data admin maintains) ────────────────────────────────
create table catalog_materials (
  id uuid primary key default gen_random_uuid(),
  category text,                   -- carcass | shutter | hardware | countertop
  name text,
  finish text,
  price_per_sqft numeric,
  image_url text
);

-- ── PAYMENT SETTINGS ─────────────────────────────────────────────────────────
create table payment_settings (
  id uuid primary key default gen_random_uuid(),
  upi_id text,
  bank_details text,
  -- Quotation letterhead — shown on every downloaded/printed quotation PDF
  company_name text,               -- legal entity name (may differ from the YOSOGO brand name)
  gstin text,
  company_address text,
  quotation_terms text,            -- numbered Terms & Conditions block
  payment_terms_text text,         -- payment milestone breakdown shown on the quotation
  updated_at timestamptz default now()
);

-- Standard stage template used whenever a project is created
-- (INSERT seed values in application code when a project is booked)
-- 1 Site Measurement · 2 Design Finalization · 3 Booking & Advance ·
-- 4 Material Procurement · 5 Production (Factory) · 6 Quality Check ·
-- 7 Delivery to Site · 8 Installation · 9 Final Handover

-- ============================================================================
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Two tiers:
--  1. ACCOUNT tables (admin_accounts, team_accounts, customer_accounts) hold
--     passwords / OTPs. RLS is enabled with NO policies, which means the
--     public "anon" key can do nothing to them at all — only the Cloudflare
--     Worker (using the service_role key, which bypasses RLS entirely) can
--     read or write these tables. Never grant anon access here.
--
--  2. OPERATIONAL tables (leads, projects, stages, photos, payments, etc.)
--     are readable and writable by the anon key so the 4 portals can work
--     directly against Supabase without a server round-trip for every click.
--     This is the fast way to get YOSOGO live. As the team grows, the
--     recommended hardening path is to switch these portals to Supabase Auth
--     (one login per admin/team member) and tighten these policies to check
--     auth.uid() / a role claim instead of allowing any anon caller.
-- ============================================================================

alter table admin_accounts enable row level security;
alter table team_accounts enable row level security;
alter table customer_accounts enable row level security;
-- No policies created for the three tables above => anon key gets zero access.

alter table leads enable row level security;
alter table lead_notes enable row level security;
alter table projects enable row level security;
alter table project_stages enable row level security;
alter table stage_photos enable row level security;
alter table design_files enable row level security;
alter table quotations enable row level security;
alter table payment_milestones enable row level security;
alter table payments enable row level security;
alter table catalog_materials enable row level security;
alter table payment_settings enable row level security;
alter table team_profiles enable row level security;
alter table quotation_catalog enable row level security;

create policy "anon full access" on leads for all using (true) with check (true);
create policy "anon full access" on lead_notes for all using (true) with check (true);
create policy "anon full access" on projects for all using (true) with check (true);
create policy "anon full access" on project_stages for all using (true) with check (true);
create policy "anon full access" on stage_photos for all using (true) with check (true);
create policy "anon full access" on design_files for all using (true) with check (true);
create policy "anon full access" on quotations for all using (true) with check (true);
create policy "anon full access" on payment_milestones for all using (true) with check (true);
create policy "anon full access" on payments for all using (true) with check (true);
create policy "anon full access" on catalog_materials for all using (true) with check (true);
create policy "anon full access" on payment_settings for all using (true) with check (true);
create policy "anon full access" on quotation_catalog for all using (true) with check (true);
create policy "anon full access" on client_checklist_items for all using (true) with check (true);
create policy "anon read only" on team_profiles for select using (true);
-- team_profiles is written only by the Worker (service_role) via /api/team/create
-- and /api/team/toggle, so no anon insert/update/delete policy is created here.

-- Enable Realtime (used by yosogo-data.js to keep all 4 portals live-synced)
alter publication supabase_realtime add table leads, lead_notes, projects,
  project_stages, stage_photos, design_files, quotations,
  payment_milestones, payments, catalog_materials, payment_settings, team_profiles,
  quotation_catalog, client_checklist_items;

-- ============================================================================
-- STORAGE — buckets for uploaded files (quotations, design documents)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('quotation-files', 'quotation-files', true)
on conflict (id) do nothing;

create policy "anon upload quotation files" on storage.objects
  for insert to anon with check (bucket_id = 'quotation-files');
create policy "anon read quotation files" on storage.objects
  for select to anon using (bucket_id = 'quotation-files');

insert into storage.buckets (id, name, public)
values ('design-files', 'design-files', true)
on conflict (id) do nothing;

create policy "anon upload design files" on storage.objects
  for insert to anon with check (bucket_id = 'design-files');
create policy "anon read design files" on storage.objects
  for select to anon using (bucket_id = 'design-files');
