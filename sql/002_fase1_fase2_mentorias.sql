-- =========================================================
-- Migración 002: pausar/archivar tutorías, contacto tras
-- aceptar, ciclo de vida completo de una sesión, y
-- "quitar de mi lista" (oculto por persona, no borrado real)
-- =========================================================

alter table tutores add column pausado boolean not null default false;
alter table tutores add column archivado boolean not null default false;

alter table sesiones add column lugar_o_enlace text;
alter table sesiones add column motivo_cancelacion text;
alter table sesiones add column solicitante_email text;
alter table sesiones add column oculta_para_solicitante boolean not null default false;
alter table sesiones add column oculta_para_tutor boolean not null default false;

-- Los tutores pausados o archivados nunca deben verse en búsquedas
create index idx_tutores_visibles on tutores (clave_materia)
  where activo and not pausado and not archivado;
