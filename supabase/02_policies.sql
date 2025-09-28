
-- Enable RLS
alter table public.teams enable row level security;
alter table public.terms enable row level security;
alter table public.ranks enable row level security;
alter table public.roles enable row level security;
alter table public.members enable row level security;
alter table public.user_roles enable row level security;
alter table public.team_links enable row level security;
alter table public.meetings enable row level security;
alter table public.attendance enable row level security;
alter table public.materials enable row level security;
alter table public.material_reservations enable row level security;
alter table public.field_zones enable row level security;
alter table public.field_reservations enable row level security;
alter table public.team_budgets enable row level security;
alter table public.expenses enable row level security;
alter table public.evaluation_questions enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_answers enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Helper function: check role (optionally by team)
create or replace function public.has_role(_role text, _team uuid default null)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.role_slug = _role
      and ( (_team is null and ur.team_id is null) or (ur.team_id = _team) )
  );
$$;

-- Helper: get user's team (null for admin/ancien)
create or replace function public.user_team_id(_user uuid)
returns uuid language sql stable as $$
  select m.team_id from public.members m where m.auth_user_id = _user;
$$;

-- Read-only tables for all authenticated
create policy "teams read" on public.teams for select using (true);
create policy "terms read" on public.terms for select using (true);
create policy "ranks read" on public.ranks for select using (true);
create policy "roles read" on public.roles for select using (true);
create policy "user_roles read self" on public.user_roles for select using (ur.user_id = auth.uid());

-- Members
create policy "members read own team or admin" on public.members
  for select using (
    public.has_role('admin') or
    (team_id is not null and team_id = public.user_team_id(auth.uid()))
  );

-- Admin can manage members
create policy "members admin modify" on public.members
  for all using (public.has_role('admin'))
  with check (true);

-- user_roles: admin manage, user read own
create policy "user_roles admin modify" on public.user_roles
  for all using (public.has_role('admin'))
  with check (true);

-- team_links: admin manage; team roles read
create policy "team_links admin modify" on public.team_links
  for all using (public.has_role('admin'))
  with check (true);

create policy "team_links read by team" on public.team_links
  for select using (
    public.has_role('admin') or team_id = public.user_team_id(auth.uid())
  );

-- Meetings: created/read by team leads (chef_de_legion, responsable_secretary) and admin
create policy "meetings read by team" on public.meetings
  for select using (
    public.has_role('admin') or team_id = public.user_team_id(auth.uid())
  );

create policy "meetings create by lead/secretary" on public.meetings
  for insert with check (
    public.has_role('admin') or team_id = public.user_team_id(auth.uid())
  );

create policy "meetings update by lead/secretary" on public.meetings
  for update using (
    public.has_role('admin') or team_id = public.user_team_id(auth.uid())
  );

-- Attendance:
--  - Chef de legion: record for chefs (meeting/preparation)
--  - Secretary: record for equipiers on meeting only (guarded by trigger)
create policy "attendance read by team" on public.attendance
  for select using (
    public.has_role('admin') or exists (
      select 1 from public.meetings mt
      join public.members mb on mb.id = attendance.member_id
      where attendance.meeting_id = mt.id
        and mt.team_id = public.user_team_id(auth.uid())
        and (mb.team_id = mt.team_id or mb.team_id is null)
    )
  );

create policy "attendance modify by team" on public.attendance
  for all using (
    public.has_role('admin') or exists (
      select 1 from public.meetings mt
      where attendance.meeting_id = mt.id
        and mt.team_id = public.user_team_id(auth.uid())
    )
  )
  with check (
    public.has_role('admin') or exists (
      select 1 from public.meetings mt
      where attendance.meeting_id = mt.id
        and mt.team_id = public.user_team_id(auth.uid())
    )
  );

-- Materials
-- Responsable Materials (global) can manage catalog; team users can read
create policy "materials read all" on public.materials for select using (true);
create policy "materials modify by global RM or admin" on public.materials
  for all using (public.has_role('admin') or public.has_role('responsable_materials')) with check (true);

-- Material reservations: team users CRUD own team; global RM can read all
create policy "matres read by team or RM" on public.material_reservations
  for select using (
    public.has_role('admin') or public.has_role('responsable_materials') or
    team_id = public.user_team_id(auth.uid())
  );
create policy "matres modify by team" on public.material_reservations
  for all using (team_id = public.user_team_id(auth.uid()) or public.has_role('admin'))
  with check (team_id = public.user_team_id(auth.uid()) or public.has_role('admin'));

-- Field zones: admin manage; all read
create policy "field_zones read" on public.field_zones for select using (true);
create policy "field_zones modify admin" on public.field_zones for all using (public.has_role('admin')) with check (true);

-- Field reservations: team users CRUD own team; admin read all
create policy "field_res read by team" on public.field_reservations
  for select using (public.has_role('admin') or team_id = public.user_team_id(auth.uid()));

create policy "field_res modify by team" on public.field_reservations
  for all using (team_id = public.user_team_id(auth.uid()) or public.has_role('admin'))
  with check (team_id = public.user_team_id(auth.uid()) or public.has_role('admin'));

-- Finance
-- Budgets: admin create; team responsable_finance read/write for own team; chef_de_legion read
create policy "budgets read" on public.team_budgets
  for select using (
    public.has_role('admin') or
    team_id = public.user_team_id(auth.uid())
  );

create policy "budgets modify" on public.team_budgets
  for all using (
    public.has_role('admin') or
    (team_id = public.user_team_id(auth.uid()) and public.has_role('responsable_finance', public.user_team_id(auth.uid())))
  )
  with check (
    public.has_role('admin') or
    (team_id = public.user_team_id(auth.uid()) and public.has_role('responsable_finance', public.user_team_id(auth.uid())))
  );

-- Expenses: create/update by team responsable_finance; read by team (incl. chef_de_legion)
create policy "expenses read" on public.expenses
  for select using (
    public.has_role('admin') or team_id = public.user_team_id(auth.uid())
  );

create policy "expenses modify" on public.expenses
  for all using (
    public.has_role('admin') or
    (team_id = public.user_team_id(auth.uid()) and public.has_role('responsable_finance', public.user_team_id(auth.uid())))
  )
  with check (
    public.has_role('admin') or
    (team_id = public.user_team_id(auth.uid()) and public.has_role('responsable_finance', public.user_team_id(auth.uid())))
  );

-- Evaluations
-- Admin full; Chef de legion can write for own team; evaluated chefs can read their evaluation; Ancien can read all evaluations
create policy "eval read" on public.evaluations
  for select using (
    public.has_role('admin') or
    public.has_role('ancien') or
    team_id = public.user_team_id(auth.uid()) or
    exists (select 1 from public.members m where m.id = evaluations.evaluatee_member_id and m.auth_user_id = auth.uid())
  );

create policy "eval write by chef_de_legion" on public.evaluations
  for all using (
    public.has_role('admin') or
    (team_id = public.user_team_id(auth.uid()) and public.has_role('chef_de_legion', public.user_team_id(auth.uid())))
  )
  with check (
    public.has_role('admin') or
    (team_id = public.user_team_id(auth.uid()) and public.has_role('chef_de_legion', public.user_team_id(auth.uid())))
  );

create policy "eval_answers follow eval" on public.evaluation_answers
  for all using (exists (select 1 from public.evaluations e where e.id = evaluation_answers.evaluation_id))
  with check (exists (select 1 from public.evaluations e where e.id = evaluation_answers.evaluation_id));

-- Evaluation questions: admin manage, all read
create policy "eval_q read" on public.evaluation_questions for select using (true);
create policy "eval_q admin modify" on public.evaluation_questions for all using (public.has_role('admin')) with check (true);

-- Notifications: only recipient reads; admin can read all
create policy "notif read own" on public.notifications for select using (user_id = auth.uid() or public.has_role('admin'));
create policy "notif insert admin" on public.notifications for insert with check (public.has_role('admin'));
create policy "notif update own" on public.notifications for update using (user_id = auth.uid() or public.has_role('admin'));

-- Audit log: admin read all; system inserts via triggers (security definer is used in functions)
create policy "audit read admin" on public.audit_log for select using (public.has_role('admin'));
