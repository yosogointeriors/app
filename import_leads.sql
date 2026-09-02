-- Import 9 Facebook leads from New_Leads_ad_Leads_2026-08-30_2026-08-31.csv
-- Requires migration_lead_columns.sql to have been run first.
-- Skips any lead whose phone number already exists.

insert into leads (name, phone, email, city, source, fb_campaign_name, fb_ad_id, fb_form_id, project_type, bhk, budget_range, site_ready, job_title, exact_location, platform, status, created_at)
select * from (values
  ('Dr Syed', '9160400916', NULL, 'Nellore', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'Wardrobes', '4BHK', 'Under 5L', true, 'D', 'Nellore', 'ig', 'new', '2026-09-01T10:51:52+05:30'::timestamptz),
  ('Johnpal Yedluri', '9885428883', NULL, 'Vijayawada', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'TV Unit', '3BHK', 'Under 5L', false, 'Contractor', 'Mangalagiri', 'ig', 'new', '2026-09-01T07:59:50+05:30'::timestamptz),
  ('Jai Krishna Muvvala', '9908222207', NULL, 'Chirala', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'Pooja Unit, Modular Kitchen, Partitions, False Ceiling, Wardrobes, TV Unit', '3BHK', 'Under 25L', false, 'Business', 'Chirala', 'fb', 'new', '2026-09-01T07:45:22+05:30'::timestamptz),
  ('laxmiprasad', '9948239488', NULL, 'Hyderabad', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'Pooja Unit, Modular Kitchen, Partitions, False Ceiling, Wardrobes, TV Unit', 'Villa', 'Under 10L', true, 'Owner', '518301', 'fb', 'new', '2026-09-01T07:04:36+05:30'::timestamptz),
  ('Satya Sai', '8187877588', NULL, 'Rajahumandry', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'TV Unit', '2BHK', 'Under 5L', false, 'Private jon', 'Near by Rajahumandry', 'ig', 'new', '2026-09-01T06:10:15+05:30'::timestamptz),
  ('Arjun', '7036261111', NULL, 'Bangalore', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'Pooja Unit, Modular Kitchen, Partitions, False Ceiling, Wardrobes, TV Unit', '2BHK', 'Under 5L', true, 'business', 'Tirupathi', 'fb', 'new', '2026-08-31T19:02:34+05:30'::timestamptz),
  ('Baba Cell Point', '9030323757', NULL, 'Kandukur', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'Wardrobes', '2BHK', 'Under 5L', true, 'Business', 'Kandukur', 'ig', 'new', '2026-08-31T14:32:55+05:30'::timestamptz),
  ('Sai Sandeep Allam', '9550530250', NULL, 'Venkatagiri', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'Modular Kitchen', '2BHK', 'Under 5L', true, 'Business', 'Venkatagiri', 'fb', 'new', '2026-08-31T10:21:26+05:30'::timestamptz),
  ('Satish Kumar Yadav Yadav', '8886499499', NULL, 'Nellore', 'facebook_ad', 'Leads YOSOGO  Video Ad- Iphone- Insta Video', '120250368479060718', '2005457780080987', 'TV Unit, Modular Kitchen, Pooja Unit, Wardrobes', '3BHK', 'Under 10L', true, 'MD', 'Iskon city Nellore', 'fb', 'new', '2026-08-31T07:58:16+05:30'::timestamptz)
) as v(name, phone, email, city, source, fb_campaign_name, fb_ad_id, fb_form_id, project_type, bhk, budget_range, site_ready, job_title, exact_location, platform, status, created_at)
where not exists (select 1 from leads l where l.phone = v.phone)
returning name, phone, city, site_ready;
