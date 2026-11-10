-- =========================================================
-- Esquema COMPLETO (para crear una base desde cero).
-- Si ya tienes tutores/horarios_tutor/sesiones/admins, usa solo
-- sql/001_notificaciones_y_snapshots.sql.
-- =========================================================

-- Estudiantes que se ofrecen como tutores de una materia específica
create table tutores (
  id bigint generated always as identity primary key,
  student_key text not null,
  nombre text not null,
  numero_control text not null,
  email text,
  carrera text,
  foto text,
  clave_materia text not null,
  nombre_materia text not null,
  calificacion_acreditada numeric not null,
  descripcion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (student_key, clave_materia)
);

create index idx_tutores_materia on tutores (clave_materia) where activo;

alter table tutores enable row level security;

-- Horarios concretos que cada tutor publica como disponibles
create table horarios_tutor (
  id bigint generated always as identity primary key,
  tutor_id bigint not null references tutores(id) on delete cascade,
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  creado_en timestamptz not null default now(),
  check (hora_fin > hora_inicio),
  unique (tutor_id, fecha, hora_inicio)
);

create index idx_horarios_tutor_tutor on horarios_tutor (tutor_id);

alter table horarios_tutor enable row level security;

-- Solicitudes de sesión: cada una reserva UN horario concreto
create table sesiones (
  id bigint generated always as identity primary key,
  tutor_id bigint not null references tutores(id) on delete cascade,
  horario_id bigint not null references horarios_tutor(id),
  solicitante_student_key text not null,
  solicitante_nombre text not null,
  mensaje text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aceptada', 'rechazada', 'completada', 'cancelada')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index idx_sesiones_tutor on sesiones (tutor_id);
create index idx_sesiones_solicitante on sesiones (solicitante_student_key);

-- Solo puede existir UNA sesión activa (pendiente o aceptada) por horario.
create unique index idx_sesiones_horario_activa
  on sesiones (horario_id)
  where estado in ('pendiente', 'aceptada');

alter table sesiones enable row level security;

-- Administradores del sistema, ligados a su student_key real del SII
create table admins (
  student_key text primary key,
  nombre text,
  creado_en timestamptz not null default now()
);

alter table admins enable row level security;

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
