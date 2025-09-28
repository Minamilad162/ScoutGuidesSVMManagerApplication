# Scout Manager — Supabase + React (Vite + TS)

A production-ready starter for your **Scout** system using **Supabase (Auth + Postgres + RLS)** and **React**.
It includes:
- Auth + Role-based access (team-scoped and global roles)
- Teams, Terms, Members (users and non-users / equipiers)
- Attendance (meetings), Finance (budgets + expenses), Materials (inventory + reservations), Field zones (reservations), Evaluations
- Notifications (in-app), Audit log, Soft delete, CSV import/export hooks
- Strict RLS and helpful SQL functions (e.g., `has_role`), conflict prevention (EXCLUDE / triggers)

> Start by running the SQL files in order:
1. `supabase/01_schema.sql`
2. `supabase/02_policies.sql`
3. `supabase/03_functions_triggers.sql`
4. `supabase/04_seed.sql` (optional demo data)

## Quickstart

**Prereqs:** Node 18+, Supabase project.

1) Create `.env` from `.env.example` and fill your Supabase URL + anon key
2) Install & run:
```bash
npm i
npm run dev
```

## Roles & Ranks

- **Roles (permissions):** admin (chef_de_mouvement), chef_de_legion, responsable_finance, responsable_materials, responsable_secretary, ancien, responsable_media, normal_chef, equipier.
  - Roles can be **global** (team_id NULL) or **team-scoped** (team_id is your team).
- **Ranks (titles):** chef_de_mouvement, chef_de_legion, assistant, aide, sous_chef.

## Notes

- Every user belongs to exactly one team **except** Admin and Ancien (they can have no team).
- Equipiers may not have a user account — they still exist as members (with guardian info).
- Attendance rules:
  - **Equipier** attendance is for **meeting** days only (not preparation).
  - **Chefs** attendance (users with chef roles) can be for **meeting** and **preparation**.
- Finance warnings: at **25% remaining** and **0%** remaining → in-app notifications to Chef de legion & Responsable Finance of that team.
- Materials reservations check minute-level overlap; Field reservations use `EXCLUDE` constraints.
- Admin can manage: users/roles, evaluation questions (with weights), terms, field zones, team drive links.

