-- =========================================================
-- Migración 001 — ejecutar UNA vez en el SQL Editor de Supabase
-- (tu base ya tiene tutores, horarios_tutor, sesiones y admins;
--  esto solo agrega las tablas nuevas)
-- =========================================================

-- Notificaciones de cada estudiante (antes vivían en data.json)
create table if not exists notificaciones (
  id bigint generated always as identity primary key,
  student_key text not null,
  tipo text not null default 'general',   -- general | cambio | mentoria | sistema
  message text not null,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notificaciones_student
  on notificaciones (student_key, id desc);

alter table notificaciones enable row level security;

-- Último "snapshot" de calificaciones/horarios, para detectar cambios
create table if not exists snapshots (
  student_key text not null,
  kind text not null check (kind in ('calificaciones', 'horarios')),
  payload jsonb not null,
  actualizado_en timestamptz not null default now(),
  primary key (student_key, kind)
);

alter table snapshots enable row level security;

-- (Opcional) Primer administrador, si prefieres no usar ADMIN_STUDENT_KEYS:
-- insert into admins (student_key, nombre) values ('TU_STUDENT_KEY', 'Tu nombre');
