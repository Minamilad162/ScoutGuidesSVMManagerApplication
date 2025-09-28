
-- Extensions
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- Basic tables
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  name text not null,            -- Term 1 / Term 2 / Term Summer
  year smallint not null,        -- e.g., 2025
  start_date date,
  end_date date,
  unique (name, year)
);

create table if not exists public.ranks (
  id serial primary key,
  rank_slug text unique not null check (rank_slug ~ '^[a-z_]+$'),
  rank_label text not null
);

create table if not exists public.roles (
  id serial primary key,
  role_slug text unique not null check (role_slug ~ '^[a-z_]+$'),
  role_label text not null
);

-- Members (users or equipiers)
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  full_name text not null,
  team_id uuid references public.teams(id),
  rank_id int references public.ranks(id),
  is_equipier boolean default false,
  personal_phone text,
  guardian_name text,
  guardian_phone text,
  birth_date date,
  created_at timestamptz default now()
);

-- Quick self view for current user
create or replace view public.v_me as
select m.id as member_id, m.team_id
from public.members m
where m.auth_user_id = auth.uid();

-- User roles (global or team-scoped)
create table if not exists public.user_roles (
  user_id uuid references auth.users(id) on delete cascade,
  role_id int references public.roles(id) on delete cascade,
  team_id uuid references public.teams(id), -- NULL => global
  created_at timestamptz default now(),
  primary key (user_id, role_id, team_id)
);

create or replace view public.user_roles_view as
select ur.user_id, r.role_slug, ur.team_id
from user_roles ur
join roles r on r.id = ur.role_id;

-- Drive links per team
create table if not exists public.team_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  kind text not null check (kind in ('images','program')),
  url text not null,
  created_at timestamptz default now(),
  unique (team_id, kind)
);

-- Meetings & Attendance
create type public.meeting_type as enum ('preparation','meeting');

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  meeting_date date not null,
  mtype public.meeting_type not null, -- preparation or meeting
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique (team_id, meeting_date, mtype)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  is_present boolean not null,
  recorded_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique (meeting_id, member_id)
);

-- Materials inventory & reservations
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  total_qty int not null check (total_qty >= 0),
  active boolean default true,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists public.material_reservations (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  qty int not null check (qty > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  soft_deleted_at timestamptz,
  check (ends_at > starts_at)
);

-- Field zones & reservations
create table if not exists public.field_zones (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,   -- e.g., A1, A2, A3, A4
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.field_reservations (
  id uuid primary key default gen_random_uuid(),
  field_zone_id uuid not null references public.field_zones(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  range tstzrange generated always as (tstzrange(date_trunc('minute', starts_at), date_trunc('minute', ends_at), '[)')) stored,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  soft_deleted_at timestamptz,
  check (ends_at > starts_at)
);

-- Prevent overlapping reservations on the same field zone (ignoring soft-deleted)
alter table public.field_reservations
  add constraint field_reservations_no_overlap exclude using gist
  (field_zone_id with =, range with &&)
  where (soft_deleted_at is null);

-- Finance (budgets & expenses)
create table if not exists public.team_budgets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  term_id uuid not null references public.terms(id) on delete cascade,
  amount_total numeric(12,2) not null check (amount_total >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  soft_deleted_at timestamptz,
  unique (team_id, term_id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  term_id uuid not null references public.terms(id) on delete cascade,
  expense_date date not null,
  item_name text not null,
  qty int not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total numeric(12,2) generated always as (qty * unit_price) stored,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  soft_deleted_at timestamptz
);

-- Evaluation (admin-manageable questions)
create table if not exists public.evaluation_questions (
  id serial primary key,
  question_text text not null,
  weight int not null check (weight between 0 and 100),
  active boolean default true,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  evaluatee_member_id uuid not null references public.members(id) on delete cascade,
  evaluator_user_id uuid not null references auth.users(id),
  team_id uuid not null references public.teams(id) on delete cascade,
  term_id uuid not null references public.terms(id) on delete cascade,
  auto_present_count int default 0,
  auto_absent_count int default 0,
  positive_note text,
  negative_note text,
  development_plan text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (evaluatee_member_id, term_id)
);

create table if not exists public.evaluation_answers (
  evaluation_id uuid references public.evaluations(id) on delete cascade,
  question_id int references public.evaluation_questions(id) on delete cascade,
  answer boolean not null,
  primary key (evaluation_id, question_id)
);

-- Notifications (in-app)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ntype text not null,         -- budget_low, budget_depleted, eval_due, etc.
  payload jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- Audit log
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null,       -- insert/update/delete/soft_delete etc.
  entity_type text not null,  -- expense, reservation, attendance, budget...
  entity_id uuid,
  delta jsonb,
  created_at timestamptz default now()
);

-- Seed static lists (teams, ranks, roles) - may run again safely
insert into public.teams (name) values
 ('Bara3em'), ('Ashbal'), ('K.Mobtade2'), ('K.Tani'), ('K.Awal'), ('M.Tani'), ('M.Awal')
on conflict do nothing;

insert into public.ranks (rank_slug, rank_label) values
 ('chef_de_mouvement','Chef de mouvement'),
 ('chef_de_legion','Chef de legion'),
 ('assistant','Assistant'),
 ('aide','Aide'),
 ('sous_chef','Sous Chef')
on conflict do nothing;

insert into public.roles (role_slug, role_label) values
 ('admin','Admin (Chef de mouvement)'),
 ('chef_de_legion','Chef de legion'),
 ('responsable_finance','Responsable Finance'),
 ('responsable_materials','Responsable Materials'),
 ('responsable_secretary','Responsable Secretary'),
 ('ancien','Ancien'),
 ('responsable_media','Responsable Media'),
 ('normal_chef','Normal Chef'),
 ('equipier','Equipier')
on conflict do nothing;
