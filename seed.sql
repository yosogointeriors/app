-- ============================================================================
-- YOSOGO — optional demo seed data
-- Run this in the Supabase SQL editor after schema.sql, just to have
-- something to click through. Safe to skip entirely for a real launch.
-- ============================================================================

insert into admin_accounts (name, email, password, role) values
  ('Karthik Rao', 'admin@yosogo.in', 'admin123', 'super_admin');

with rows as (
  insert into team_accounts (name, email, password, role, city, phone) values
    ('Divya Menon', 'divya@yosogo.in', 'team123', 'sales_head', 'Chennai,Coimbatore', '9840011122'),
    ('Arjun Prasath', 'arjun@yosogo.in', 'team123', 'designer', 'Chennai', '9840033344'),
    ('Sneha Iyer', 'sneha@yosogo.in', 'team123', 'designer', 'Coimbatore', '9840055566'),
    ('Manoj Kumar', 'manoj@yosogo.in', 'team123', 'site_manager', 'Chennai', '9840077788')
  returning id, name, role, city, phone
)
insert into team_profiles (id, name, role, city, phone, active)
select id, name, role, city, phone, true from rows;

insert into catalog_materials (category, name, finish, price_per_sqft) values
  ('carcass', 'BWP Plywood', 'Standard', 950),
  ('carcass', 'HDHMR Board', 'Premium', 1150),
  ('shutter', 'Laminate', 'Matte', 480),
  ('shutter', 'Acrylic', 'High Gloss', 780),
  ('hardware', 'Hettich Hinges & Channels', '-', 0),
  ('hardware', 'Ebco Hinges & Channels', '-', 0),
  ('countertop', 'Granite', 'Polished', 220),
  ('countertop', 'Quartz', 'Engineered', 450);

insert into payment_settings (upi_id, bank_details) values
  ('yosogo.interiors@okhdfc', 'YOSOGO Interiors Pvt Ltd · HDFC Bank · A/C 50200012345678 · IFSC HDFC0001234');

-- A sample lead + booked project so you can see the customer portal in action
with new_lead as (
  insert into leads (name, phone, email, city, source, fb_campaign_name, fb_ad_id, project_type, bhk, budget_range, status)
  values ('Meena Gopalakrishnan', '9840011223', 'meena.g@gmail.com', 'Chennai', 'facebook_ad',
          'Full Home Interiors - Chennai', 'FBAD-88240', 'full_home', '3BHK', '9-15L', 'booked')
  returning id
),
new_project as (
  insert into projects (lead_id, project_name, project_type, city, address, total_value, current_stage_order, status, start_date, target_handover_date)
  select id, 'Meena G. — 3BHK Full Home', 'full_home', 'Chennai', '14 Lake View Road, Velachery, Chennai',
         1180000, 6, 'active', current_date - 30, current_date + 30
  from new_lead
  returning id, lead_id
)
insert into project_stages (project_id, stage_order, stage_name, status, completed_date)
select np.id, s.ord, s.name, case when s.ord < 6 then 'completed' when s.ord = 6 then 'in_progress' else 'pending' end,
       case when s.ord < 6 then current_date - (30 - s.ord*6) else null end
from new_project np,
  (values (1,'Site Measurement'),(2,'Design Finalization'),(3,'Booking & Advance'),
          (4,'Material Procurement'),(5,'Production (Factory)'),(6,'Quality Check'),
          (7,'Delivery to Site'),(8,'Installation'),(9,'Final Handover')) as s(ord, name);

insert into customer_accounts (project_id, name, phone, otp)
select p.id, 'Meena Gopalakrishnan', '9840011223', '1234'
from projects p where p.project_name = 'Meena G. — 3BHK Full Home';
