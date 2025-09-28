
-- Example terms for 2025 (adjust dates as needed)
insert into public.terms (name, year, start_date, end_date) values
 ('Term 1', 2025, '2025-01-15','2025-04-15'),
 ('Term 2', 2025, '2025-04-16','2025-07-15'),
 ('Term Summer', 2025, '2025-07-16','2025-09-30')
on conflict do nothing;
