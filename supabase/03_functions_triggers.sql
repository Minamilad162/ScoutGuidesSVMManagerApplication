
-- Normalize reservations to minute precision
create or replace function public.trunc_to_minute(ts timestamptz) returns timestamptz
language sql immutable as $$ select date_trunc('minute', ts) $$;

-- BEFORE INSERT/UPDATE: normalize starts/ends to minute
create or replace function public.material_reservations_normalize()
returns trigger language plpgsql as $$
begin
  new.starts_at := date_trunc('minute', new.starts_at);
  new.ends_at   := date_trunc('minute', new.ends_at);
  return new;
end $$;

drop trigger if exists trg_matres_normalize on public.material_reservations;
create trigger trg_matres_normalize before insert or update
on public.material_reservations for each row execute function public.material_reservations_normalize();

create or replace function public.field_reservations_normalize()
returns trigger language plpgsql as $$
begin
  new.starts_at := date_trunc('minute', new.starts_at);
  new.ends_at   := date_trunc('minute', new.ends_at);
  return new;
end $$;

drop trigger if exists trg_fieldres_normalize on public.field_reservations;
create trigger trg_fieldres_normalize before insert or update
on public.field_reservations for each row execute function public.field_reservations_normalize();

-- Prevent overbooking materials quantity across overlapping reservations (minute level)
create or replace function public.check_material_overlap()
returns trigger language plpgsql as $$
declare
  overlapping_qty int;
  total int;
begin
  if (new.soft_deleted_at is not null) then
    return new;
  end if;

  select total_qty into total from public.materials where id = new.material_id;
  if total is null then
    raise exception 'Material not found';
  end if;

  select coalesce(sum(qty),0) into overlapping_qty
  from public.material_reservations r
  where r.material_id = new.material_id
    and r.soft_deleted_at is null
    and tstzrange(date_trunc('minute', r.starts_at), date_trunc('minute', r.ends_at), '[)')
        && tstzrange(new.starts_at, new.ends_at, '[)')
    and (tg_op = 'INSERT' or r.id <> new.id); -- exclude self on update

  if overlapping_qty + new.qty > total then
    raise exception 'Conflict: requested qty exceeds available due to overlapping reservations';
  end if;

  return new;
end $$;

drop trigger if exists trg_matres_overlap on public.material_reservations;
create trigger trg_matres_overlap before insert or update
on public.material_reservations for each row execute function public.check_material_overlap();

-- Attendance rule: Equipiers only for 'meeting' (not 'preparation')
create or replace function public.attendance_guard()
returns trigger language plpgsql as $$
declare
  mt public.meeting_type;
  is_eq boolean;
begin
  select m.mtype into mt from public.meetings m where m.id = new.meeting_id;
  select mem.is_equipier into is_eq from public.members mem where mem.id = new.member_id;
  if is_eq and mt <> 'meeting' then
    raise exception 'Equipier attendance allowed only for meeting days';
  end if;
  return new;
end $$;

drop trigger if exists trg_attendance_guard on public.attendance;
create trigger trg_attendance_guard before insert or update
on public.attendance for each row execute function public.attendance_guard();

-- Budget notifications (25% and 0%), fired on expense/budget changes
create or replace function public.notify_budget_threshold()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t_team uuid;
  t_term uuid;
  total numeric;
  spent numeric;
  remaining numeric;
  chef_users uuid[];
  fin_users uuid[];
begin
  if tg_table_name = 'expenses' then
    t_team := new.team_id;
    t_term := new.term_id;
  elsif tg_table_name = 'team_budgets' then
    t_team := new.team_id;
    t_term := new.term_id;
  else
    return null;
  end if;

  select amount_total into total from public.team_budgets b
   where b.team_id = t_team and b.term_id = t_term and b.soft_deleted_at is null;
  if total is null then
    return null;
  end if;

  select coalesce(sum(total),0) into spent from public.expenses e
   where e.team_id = t_team and e.term_id = t_term and e.soft_deleted_at is null;

  remaining := total - spent;

  -- collect recipients: chef_de_legion & responsable_finance of that team
  select array_agg(ur.user_id) into chef_users
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  where ur.team_id = t_team and r.role_slug = 'chef_de_legion';

  select array_agg(ur.user_id) into fin_users
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  where ur.team_id = t_team and r.role_slug = 'responsable_finance';

  if remaining <= 0 then
    perform public.push_notification(chef_users, 'budget_depleted', jsonb_build_object('team_id', t_team, 'term_id', t_term, 'remaining', remaining));
    perform public.push_notification(fin_users, 'budget_depleted', jsonb_build_object('team_id', t_team, 'term_id', t_term, 'remaining', remaining));
  elsif remaining <= total * 0.25 then
    perform public.push_notification(chef_users, 'budget_low', jsonb_build_object('team_id', t_team, 'term_id', t_term, 'remaining', remaining));
    perform public.push_notification(fin_users, 'budget_low', jsonb_build_object('team_id', t_team, 'term_id', t_term, 'remaining', remaining));
  end if;

  return new;
end $$;

create or replace function public.push_notification(recipients uuid[], ntype text, payload jsonb)
returns void language plpgsql security definer as $$
declare
  u uuid;
begin
  if recipients is null then return; end if;
  foreach u in array recipients loop
    insert into public.notifications (user_id, ntype, payload) values (u, ntype, payload);
  end loop;
end $$;

drop trigger if exists trg_budget_notify on public.team_budgets;
create trigger trg_budget_notify after insert or update on public.team_budgets
for each row execute function public.notify_budget_threshold();

drop trigger if exists trg_expense_notify on public.expenses;
create trigger trg_expense_notify after insert or update on public.expenses
for each row execute function public.notify_budget_threshold();

-- Auto audit on key tables
create or replace function public.audit_on_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, delta)
  values (auth.uid(),
          tg_op,
          tg_table_name,
          coalesce(new.id, old.id),
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else to_jsonb(old) end);
  return coalesce(new, old);
end $$;

-- Attach audit triggers
do $$
begin
  perform 1;
exception when others then
  -- ignore
end $$;

drop trigger if exists trg_audit_expenses on public.expenses;
create trigger trg_audit_expenses after insert or update or delete
on public.expenses for each row execute function public.audit_on_change();

drop trigger if exists trg_audit_matres on public.material_reservations;
create trigger trg_audit_matres after insert or update or delete
on public.material_reservations for each row execute function public.audit_on_change();

drop trigger if exists trg_audit_fieldres on public.field_reservations;
create trigger trg_audit_fieldres after insert or update or delete
on public.field_reservations for each row execute function public.audit_on_change();

drop trigger if exists trg_audit_att on public.attendance;
create trigger trg_audit_att after insert or update or delete
on public.attendance for each row execute function public.audit_on_change();

drop trigger if exists trg_audit_budget on public.team_budgets;
create trigger trg_audit_budget after insert or update or delete
on public.team_budgets for each row execute function public.audit_on_change();

-- Helper view: chef attendance stats per term
create or replace view public.v_chef_attendance_term as
with mt as (
  select m.id as meeting_id, m.team_id, m.meeting_date, m.mtype, m.term_id
  from (
    select me.*, t.id as term_id
    from public.meetings me
    left join public.terms t
      on (t.start_date is null or me.meeting_date >= t.start_date)
     and (t.end_date   is null or me.meeting_date <= t.end_date)
     and t.name is not null -- tie by date range when filled
  ) m
)
select
  a.member_id,
  mt.team_id,
  mt.term_id,
  count(*) filter (where a.is_present) as present_count,
  count(*) filter (where not a.is_present) as absent_count
from public.attendance a
join mt on mt.meeting_id = a.meeting_id
join public.members mb on mb.id = a.member_id
where mb.auth_user_id is not null -- chefs only (users)
group by a.member_id, mt.team_id, mt.term_id;

