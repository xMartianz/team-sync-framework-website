-- =====================================================================
-- TeamSync — skema database Supabase
-- Jalankan sekali di Supabase Dashboard → SQL Editor → New query → Run.
-- Aman dijalankan ulang (idempoten) untuk tabel, fungsi, dan policy.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  level       text not null default 'Junior' check (level in ('Junior','Middle','Senior','Lead')),
  capacity    integer not null check (capacity between 10 and 1000),
  status      text not null default 'Aktif' check (status in ('Aktif','Cuti','Sakit','Izin')),
  skills      text not null default '' check (char_length(skills) <= 80),
  demo        boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  email         text,
  display_name  text,
  role          text not null default 'member' check (role in ('lead','member')),
  member_id     uuid references public.members on delete set null,
  created_at    timestamptz not null default now()
);
-- satu akun per profil anggota
create unique index if not exists profiles_member_unique on public.profiles(member_id) where member_id is not null;

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 120),
  descr         text not null default '' check (char_length(descr) <= 1000),
  complexity    integer not null check (complexity between 1 and 5),
  urgency       integer not null check (urgency between 1 and 5),
  urgency_mode  text not null default 'auto' check (urgency_mode in ('auto','manual')),
  hours         numeric(6,1) not null check (hours > 0 and hours <= 400),
  deadline      date,
  weight        integer not null check (weight >= 1),
  pic_id        uuid references public.members on delete set null,
  backup_id     uuid references public.members on delete set null,
  status        text not null default 'todo' check (status in ('todo','progress','review','done')),
  created_at    timestamptz not null default now(),
  done_at       timestamptz,
  created_by    uuid default auth.uid() references auth.users on delete set null,
  auto_picked   boolean not null default false,
  handovers     jsonb not null default '[]'::jsonb,
  demo          boolean not null default false,
  constraint pic_backup_different check (pic_id is null or backup_id is null or pic_id <> backup_id)
);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_pic_idx on public.tasks(pic_id);
create index if not exists tasks_backup_idx on public.tasks(backup_id);

create table if not exists public.activity_logs (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  type       text not null check (type in ('task_new','status','handover','member')),
  text       text not null check (char_length(text) <= 600),
  by_user    uuid default auth.uid() references auth.users on delete set null,
  by_member  uuid references public.members on delete set null,
  task_id    uuid,              -- sengaja tanpa FK: log tetap ada walau tugas dihapus
  demo       boolean not null default false
);
create index if not exists activity_logs_at_idx on public.activity_logs(at desc);

create table if not exists public.settings (
  id          integer primary key default 1 check (id = 1),
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
insert into public.settings(id) values (1) on conflict do nothing;

-- Kolom tambahan (aman untuk proyek yang sudah berjalan)
alter table public.members add column if not exists hours_per_day numeric(4,1) not null default 7 check (hours_per_day between 1 and 12);
alter table public.members add column if not exists routine_hours numeric(5,1) not null default 0 check (routine_hours between 0 and 60);
alter table public.members add column if not exists routine_note text not null default '' check (char_length(routine_note) <= 120);
alter table public.tasks add column if not exists skills text[] not null default '{}';
alter table public.tasks add column if not exists start_date date;
alter table public.activity_logs add column if not exists meta jsonb;

-- Jadwal cuti / izin / sakit (untuk kalender kapasitas)
create table if not exists public.leaves (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members on delete cascade,
  start_date  date not null,
  end_date    date not null,
  type        text not null default 'Cuti' check (type in ('Cuti','Sakit','Izin')),
  note        text not null default '' check (char_length(note) <= 120),
  demo        boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users on delete set null,
  constraint leave_range check (end_date >= start_date and end_date - start_date <= 365)
);
create index if not exists leaves_member_idx on public.leaves(member_id, start_date);

-- ---------------------------------------------------------------------
-- Fungsi bantu peran
-- ---------------------------------------------------------------------
create or replace function public.is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'lead');
$$;

create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select member_id from public.profiles where id = auth.uid();
$$;

-- Pengguna pertama yang mendaftar otomatis menjadi Team Lead.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles where role = 'lead') then 'member' else 'lead' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anggota tidak boleh menaikkan perannya sendiri; minimal harus ada satu Team Lead.
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- dijalankan dari SQL Editor / admin (tanpa pengguna login): tidak dibatasi
  if auth.uid() is null then return new; end if;
  if new.role is distinct from old.role then
    if not public.is_lead() then
      raise exception 'Hanya Team Lead yang dapat mengubah peran';
    end if;
    if old.role = 'lead' and not exists (select 1 from public.profiles where role = 'lead' and id <> old.id) then
      raise exception 'Minimal harus ada satu Team Lead';
    end if;
  end if;
  -- anggota boleh menautkan dirinya ke profil anggota sekali; mengganti tautan perlu Team Lead
  if new.member_id is distinct from old.member_id and old.member_id is not null and not public.is_lead() then
    raise exception 'Hubungi Team Lead untuk mengganti profil anggota yang tertaut';
  end if;
  new.id := old.id;
  new.email := old.email;
  return new;
end $$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- Anggota (bukan Team Lead) hanya boleh mengubah status progres tugas.
-- Pengalihan PIC/Backup oleh anggota hanya lewat fungsi handover_task().
create or replace function public.guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_lead() or coalesce(current_setting('teamsync.handover', true), '') = 'on' then
    return new;
  end if;
  if (new.title, new.descr, new.complexity, new.urgency, new.urgency_mode, new.hours, new.deadline,
      new.weight, new.pic_id, new.backup_id, new.created_at, new.created_by, new.auto_picked,
      new.handovers, new.demo, new.skills, new.start_date)
     is distinct from
     (old.title, old.descr, old.complexity, old.urgency, old.urgency_mode, old.hours, old.deadline,
      old.weight, old.pic_id, old.backup_id, old.created_at, old.created_by, old.auto_picked,
      old.handovers, old.demo, old.skills, old.start_date) then
    raise exception 'Anggota hanya dapat mengubah status progres tugas';
  end if;
  return new;
end $$;

drop trigger if exists guard_task_update on public.tasks;
create trigger guard_task_update before update on public.tasks
  for each row execute function public.guard_task_update();

-- Handover: PIC digantikan Backup, bobot tugas ikut berpindah.
-- Boleh dipanggil oleh Team Lead atau oleh Backup tugas tersebut.
drop function if exists public.handover_task(uuid, uuid, text);
create or replace function public.handover_task(p_task uuid, p_new_backup uuid, p_reason text, p_meta jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
  me uuid := public.my_member_id();
  v_reason text := left(coalesce(nullif(p_reason, ''), 'dialihkan Team Lead'), 200);
begin
  if auth.uid() is null then raise exception 'Harus masuk terlebih dahulu'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Tugas tidak ditemukan'; end if;
  if t.status = 'done' then raise exception 'Tugas sudah selesai'; end if;
  if t.backup_id is null then raise exception 'Tugas ini belum memiliki Backup'; end if;
  if not (public.is_lead() or me = t.backup_id) then
    raise exception 'Hanya Team Lead atau Backup tugas ini yang dapat melakukan handover';
  end if;
  if p_new_backup is not null and (p_new_backup = t.pic_id or p_new_backup = t.backup_id) then
    p_new_backup := null;
  end if;

  perform set_config('teamsync.handover', 'on', true);
  update public.tasks
     set pic_id = t.backup_id,
         backup_id = p_new_backup,
         handovers = handovers || jsonb_build_array(jsonb_build_object(
           'from', t.pic_id, 'to', t.backup_id, 'at', now(), 'reason', v_reason, 'by', auth.uid()))
   where id = p_task;
  perform set_config('teamsync.handover', 'off', true);

  insert into public.activity_logs (type, text, by_user, by_member, task_id, meta)
  values ('handover',
          format('Handover: "%s" dialihkan dari %s ke %s (%s). Backup baru: %s.',
                 t.title,
                 coalesce((select name from public.members where id = t.pic_id), '—'),
                 coalesce((select name from public.members where id = t.backup_id), '—'),
                 v_reason,
                 coalesce((select name from public.members where id = p_new_backup), '—')),
          auth.uid(), me, p_task, p_meta);
end $$;

revoke all on function public.handover_task(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.handover_task(uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.members       enable row level security;
alter table public.profiles      enable row level security;
alter table public.tasks         enable row level security;
alter table public.activity_logs enable row level security;
alter table public.settings      enable row level security;
alter table public.leaves        enable row level security;

-- members: semua pengguna masuk dapat membaca; hanya Team Lead yang mengubah
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (true);
drop policy if exists members_lead_insert on public.members;
create policy members_lead_insert on public.members for insert to authenticated with check (public.is_lead());
drop policy if exists members_lead_update on public.members;
create policy members_lead_update on public.members for update to authenticated using (public.is_lead()) with check (public.is_lead());
drop policy if exists members_lead_delete on public.members;
create policy members_lead_delete on public.members for delete to authenticated using (public.is_lead());

-- profiles: semua dapat membaca (untuk nama di log); ubah profil sendiri atau oleh Team Lead
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_lead()) with check (id = auth.uid() or public.is_lead());

-- tasks: transparan untuk semua; Team Lead membuat/menghapus; PIC/Backup/Lead memperbarui
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using (true);
drop policy if exists tasks_lead_insert on public.tasks;
create policy tasks_lead_insert on public.tasks for insert to authenticated with check (public.is_lead());
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_lead() or public.my_member_id() in (pic_id, backup_id))
  with check (public.is_lead() or public.my_member_id() in (pic_id, backup_id));
drop policy if exists tasks_lead_delete on public.tasks;
create policy tasks_lead_delete on public.tasks for delete to authenticated using (public.is_lead());

-- activity_logs: hanya tambah (tidak bisa diedit) — jejak audit; Team Lead boleh menghapus
drop policy if exists logs_read on public.activity_logs;
create policy logs_read on public.activity_logs for select to authenticated using (true);
drop policy if exists logs_insert on public.activity_logs;
create policy logs_insert on public.activity_logs for insert to authenticated
  with check (by_user = auth.uid() and (by_member is null or by_member = public.my_member_id() or public.is_lead()));
drop policy if exists logs_lead_delete on public.activity_logs;
create policy logs_lead_delete on public.activity_logs for delete to authenticated using (public.is_lead());

-- settings: semua membaca; Team Lead mengubah
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);
drop policy if exists settings_lead_write on public.settings;
create policy settings_lead_write on public.settings for update to authenticated using (public.is_lead()) with check (public.is_lead());
drop policy if exists settings_lead_insert on public.settings;
create policy settings_lead_insert on public.settings for insert to authenticated with check (public.is_lead());

-- leaves: semua membaca (kalender transparan); Team Lead atau anggota itu sendiri yang mengatur
drop policy if exists leaves_read on public.leaves;
create policy leaves_read on public.leaves for select to authenticated using (true);
drop policy if exists leaves_insert on public.leaves;
create policy leaves_insert on public.leaves for insert to authenticated with check (public.is_lead() or member_id = public.my_member_id());
drop policy if exists leaves_update on public.leaves;
create policy leaves_update on public.leaves for update to authenticated
  using (public.is_lead() or member_id = public.my_member_id()) with check (public.is_lead() or member_id = public.my_member_id());
drop policy if exists leaves_delete on public.leaves;
create policy leaves_delete on public.leaves for delete to authenticated using (public.is_lead() or member_id = public.my_member_id());

-- ---------------------------------------------------------------------
-- Hak akses API (diperlukan jika proyek tidak otomatis mengekspos tabel baru)
-- RLS di atas tetap membatasi baris dan aksi yang boleh dilakukan.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.members, public.profiles, public.tasks, public.activity_logs, public.settings, public.leaves to authenticated;
grant usage, select on sequence public.activity_logs_id_seq to authenticated;
grant execute on function public.is_lead() to authenticated;
grant execute on function public.my_member_id() to authenticated;

-- ---------------------------------------------------------------------
-- Akun yang mendaftar sebelum skrip ini dijalankan: buatkan profilnya,
-- dan jadikan akun paling awal sebagai Team Lead bila belum ada.
-- ---------------------------------------------------------------------
insert into public.profiles (id, email, display_name, role)
select u.id, u.email,
       coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1)),
       'member'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles set role = 'lead'
where id = (select p.id from public.profiles p join auth.users u on u.id = p.id order by u.created_at limit 1)
  and not exists (select 1 from public.profiles where role = 'lead');

-- ---------------------------------------------------------------------
-- Realtime: perubahan dikirim langsung ke semua browser yang terbuka
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['members','tasks','activity_logs','settings','profiles','leaves'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
