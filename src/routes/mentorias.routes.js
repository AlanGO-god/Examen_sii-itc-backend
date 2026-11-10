import { Router } from "express";
import { materiasElegibles } from "../services/mentorias.js";
import { supabase } from "../services/supabaseClient.js";
import { siiClient } from "../services/siiClient.js";
import { notificarSeguro } from "../db/store.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { esFechaValida, esHoraValida, yaPaso, seTraslapan } from "../services/fechas.js";

export const mentoriasRouter = Router();

const MAX_TEXTO = 500;
const MAX_HORARIOS_POR_PUBLICACION = 40; // tope sano para "repetir N semanas"

// Todos los ids de la URL son bigint; si no es un número, 400 en vez de un
// error de Postgres convertido en 500.
mentoriasRouter.param("id", (req, res, next, valor) => {
  if (!/^\d+$/.test(valor)) return res.status(400).json({ message: "Id inválido" });
  next();
});

const hhmm = (hora) => String(hora).slice(0, 5);

// Campos del tutor que cualquier estudiante autenticado puede ver. Se dejan
// fuera student_key y numero_control; el correo institucional se conserva
// para que alumno y tutor puedan coordinarse.
const CAMPOS_TUTOR_PUBLICOS =
  "id, nombre, email, carrera, foto, clave_materia, nombre_materia, calificacion_acreditada, descripcion, pausado, creado_en";

function validarHorarioBasico(h) {
  if (!h || typeof h !== "object") return "Horario inválido";
  const { fecha, hora_inicio, hora_fin } = h;
  if (!fecha || !hora_inicio || !hora_fin) return "Falta fecha, hora_inicio o hora_fin";
  if (!esFechaValida(fecha) || !esHoraValida(hora_inicio) || !esHoraValida(hora_fin)) {
    return "Fecha u hora con formato inválido";
  }
  if (hhmm(hora_fin) <= hhmm(hora_inicio)) return "La hora de fin debe ser después de la hora de inicio";
  if (yaPaso(fecha, hora_inicio)) return "No puedes publicar un horario que ya pasó";
  return null;
}

// ¿Alguno de los horarios candidatos se traslapa consigo mismo o con los
// horarios que ya existen (en CUALQUIERA de tus tutorías, no solo esta)?
function hayTraslape(candidatos, existentes) {
  for (let i = 0; i < candidatos.length; i++) {
    for (let j = i + 1; j < candidatos.length; j++) {
      if (
        candidatos[i].fecha === candidatos[j].fecha &&
        seTraslapan(candidatos[i].hora_inicio, candidatos[i].hora_fin, candidatos[j].hora_inicio, candidatos[j].hora_fin)
      ) {
        return true;
      }
    }
    for (const ex of existentes) {
      if (
        ex.fecha === candidatos[i].fecha &&
        seTraslapan(candidatos[i].hora_inicio, candidatos[i].hora_fin, ex.hora_inicio, ex.hora_fin)
      ) {
        return true;
      }
    }
  }
  return false;
}

// Todos los horarios que ya tienes publicados, en CUALQUIERA de tus
// tutorías (sirve para detectar que te estás agendando encimado contigo
// mismo, aunque sea en materias distintas).
async function horariosPropios(studentKey, excluirHorarioId = null) {
  const { data: misTutorias, error: errorTutorias } = await supabase
    .from("tutores")
    .select("id")
    .eq("student_key", studentKey);
  if (errorTutorias) throw errorTutorias;

  const idsTutor = (misTutorias ?? []).map((t) => t.id);
  if (idsTutor.length === 0) return [];

  let query = supabase.from("horarios_tutor").select("id, fecha, hora_inicio, hora_fin").in("tutor_id", idsTutor);
  if (excluirHorarioId) query = query.neq("id", excluirHorarioId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Materias elegibles y alta como tutor (con horarios opcionales de una vez)
// ---------------------------------------------------------------------------

mentoriasRouter.get("/materias-elegibles", requireAuth, async (req, res, next) => {
  try {
    const materias = await materiasElegibles(req.token);
    res.json({ ok: true, materias });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.post("/tutores", requireAuth, async (req, res, next) => {
  try {
    const { clave_materia, carrera, descripcion } = req.body || {};
    const horariosEntrada = Array.isArray(req.body?.horarios) ? req.body.horarios : [];

    if (!clave_materia) {
      return res.status(400).json({ message: "Falta clave_materia" });
    }
    if (descripcion && String(descripcion).length > MAX_TEXTO) {
      return res.status(400).json({ message: `La descripción no puede pasar de ${MAX_TEXTO} caracteres` });
    }
    if (horariosEntrada.length > MAX_HORARIOS_POR_PUBLICACION) {
      return res.status(400).json({ message: `No puedes publicar más de ${MAX_HORARIOS_POR_PUBLICACION} horarios de una vez` });
    }

    const horarios = horariosEntrada.map((h) => ({
      fecha: h.fecha,
      hora_inicio: h.hora_inicio,
      hora_fin: h.hora_fin,
    }));
    for (const h of horarios) {
      const error = validarHorarioBasico(h);
      if (error) return res.status(400).json({ message: error });
    }

    const materias = await materiasElegibles(req.token);
    const materia = materias.find((m) => m.clave_materia === clave_materia);
    if (!materia) {
      return res.status(403).json({ message: "No calificas como tutor de esa materia" });
    }

    if (horarios.length > 0) {
      const existentes = await horariosPropios(req.studentKey);
      if (hayTraslape(horarios, existentes)) {
        return res.status(409).json({ message: "Dos de esos horarios se traslapan (contigo mismo o con otra de tus tutorías)" });
      }
    }

    const perfil = await siiClient.getEstudiante(req.token);
    const datos = perfil?.data ?? {};

    const { data: tutor, error: errorTutor } = await supabase
      .from("tutores")
      .insert({
        student_key: req.studentKey,
        nombre: datos.persona ?? "",
        numero_control: String(datos.numero_control ?? ""),
        email: datos.email ?? "",
        carrera: (typeof carrera === "string" && carrera.trim()) || datos.carrera || null,
        foto: datos.foto ?? null,
        clave_materia: materia.clave_materia,
        nombre_materia: materia.nombre_materia,
        calificacion_acreditada: materia.calificacion,
        descripcion: descripcion ? String(descripcion).trim() : null,
      })
      .select()
      .single();

    if (errorTutor) {
      if (errorTutor.code === "23505") {
        return res.status(409).json({ message: "Ya te ofreciste como tutor de esa materia" });
      }
      throw errorTutor;
    }

    if (horarios.length === 0) {
      return res.status(201).json({ ok: true, tutor, horarios: [] });
    }

    const { data: horariosCreados, error: errorHorarios } = await supabase
      .from("horarios_tutor")
      .insert(horarios.map((h) => ({ ...h, tutor_id: tutor.id })))
      .select();

    if (errorHorarios) {
      // No dejamos una tutoría a medias: si los horarios fallan (por
      // ejemplo, dos fechas idénticas repetidas), se revierte la tutoría
      // recién creada también.
      await supabase.from("tutores").delete().eq("id", tutor.id);
      if (errorHorarios.code === "23505") {
        return res.status(409).json({ message: "Dos de los horarios que mandaste son idénticos" });
      }
      throw errorHorarios;
    }

    res.status(201).json({ ok: true, tutor, horarios: horariosCreados });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.get("/tutores", requireAuth, async (req, res, next) => {
  try {
    let query = supabase
      .from("tutores")
      .select(CAMPOS_TUTOR_PUBLICOS)
      .eq("activo", true)
      .eq("pausado", false)
      .eq("archivado", false)
      .order("creado_en", { ascending: false });

    if (req.query.clave_materia) {
      query = query.eq("clave_materia", String(req.query.clave_materia));
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ ok: true, tutores: data });
  } catch (err) {
    next(err);
  }
});

// Mis propias tutorías (aquí sí devolvemos todo, incluidas las archivadas:
// son mis datos, y el frontend decide cómo agruparlas)
mentoriasRouter.get("/tutores/mias", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("tutores")
      .select("*")
      .eq("student_key", req.studentKey)
      .order("creado_en", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, tutores: data });
  } catch (err) {
    next(err);
  }
});

// Editar la metodología/descripción (y carrera) de una tutoría propia
mentoriasRouter.patch("/tutores/:id", requireAuth, async (req, res, next) => {
  try {
    const { descripcion, carrera } = req.body || {};
    if (descripcion !== undefined && descripcion !== null && String(descripcion).length > MAX_TEXTO) {
      return res.status(400).json({ message: `La descripción no puede pasar de ${MAX_TEXTO} caracteres` });
    }

    const { data: tutor, error: errorTutor } = await supabase
      .from("tutores")
      .select("id, student_key")
      .eq("id", req.params.id)
      .maybeSingle();
    if (errorTutor) throw errorTutor;
    if (!tutor) return res.status(404).json({ message: "Tutoría no encontrada" });
    if (tutor.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes editar esta tutoría" });
    }

    const cambios = {};
    if (descripcion !== undefined) cambios.descripcion = descripcion ? String(descripcion).trim() : null;
    if (carrera !== undefined) cambios.carrera = carrera ? String(carrera).trim() : null;

    const { data, error } = await supabase
      .from("tutores")
      .update(cambios)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;

    res.json({ ok: true, tutor: data });
  } catch (err) {
    next(err);
  }
});

// Pausar / activar: lo controla el propio tutor, independiente de que un
// admin la haya desactivado (si está desactivada por admin, no se puede
// reactivar pausando/despausando).
async function cambiarPausa(req, res, next, pausado) {
  try {
    const { data: tutor, error: errorTutor } = await supabase
      .from("tutores")
      .select("id, student_key, activo, archivado")
      .eq("id", req.params.id)
      .maybeSingle();
    if (errorTutor) throw errorTutor;
    if (!tutor) return res.status(404).json({ message: "Tutoría no encontrada" });
    if (tutor.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes modificar esta tutoría" });
    }
    if (tutor.archivado) {
      return res.status(409).json({ message: "Esta tutoría está archivada" });
    }

    const { data, error } = await supabase
      .from("tutores")
      .update({ pausado })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;

    res.json({ ok: true, tutor: data });
  } catch (err) {
    next(err);
  }
}

mentoriasRouter.patch("/tutores/:id/pausar", requireAuth, (req, res, next) => cambiarPausa(req, res, next, true));
mentoriasRouter.patch("/tutores/:id/activar", requireAuth, (req, res, next) => cambiarPausa(req, res, next, false));

// "Eliminar" = archivar. No se borra de verdad para no destruirle el
// historial a los estudiantes que ya tuvieron sesiones con este tutor.
// Se bloquea si hay solicitudes pendientes o aceptadas de horarios futuros.
mentoriasRouter.delete("/tutores/:id", requireAuth, async (req, res, next) => {
  try {
    const { data: tutor, error: errorTutor } = await supabase
      .from("tutores")
      .select("id, student_key")
      .eq("id", req.params.id)
      .maybeSingle();
    if (errorTutor) throw errorTutor;
    if (!tutor) return res.status(404).json({ message: "Tutoría no encontrada" });
    if (tutor.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes eliminar esta tutoría" });
    }

    const { data: sesionesActivas, error: errorSesiones } = await supabase
      .from("sesiones")
      .select("id, estado, horarios_tutor(fecha, hora_inicio)")
      .eq("tutor_id", tutor.id)
      .in("estado", ["pendiente", "aceptada"]);
    if (errorSesiones) throw errorSesiones;

    const tienePendientes = (sesionesActivas ?? []).some(
      (s) => !s.horarios_tutor || !yaPaso(s.horarios_tutor.fecha, s.horarios_tutor.hora_inicio)
    );
    if (tienePendientes) {
      return res.status(409).json({
        message: "No puedes eliminar esta tutoría: tiene solicitudes pendientes o aceptadas por venir. Recházalas o cancélalas primero.",
      });
    }

    const { data, error } = await supabase
      .from("tutores")
      .update({ archivado: true })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;

    res.json({ ok: true, tutor: data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Horarios de un tutor
// ---------------------------------------------------------------------------

mentoriasRouter.post("/tutores/:id/horarios", requireAuth, async (req, res, next) => {
  try {
    const horariosEntrada = Array.isArray(req.body?.horarios)
      ? req.body.horarios
      : [{ fecha: req.body?.fecha, hora_inicio: req.body?.hora_inicio, hora_fin: req.body?.hora_fin }];

    if (horariosEntrada.length === 0 || horariosEntrada.length > MAX_HORARIOS_POR_PUBLICACION) {
      return res.status(400).json({ message: "Cantidad de horarios inválida" });
    }

    const horarios = horariosEntrada.map((h) => ({
      fecha: h.fecha,
      hora_inicio: h.hora_inicio,
      hora_fin: h.hora_fin,
    }));
    for (const h of horarios) {
      const error = validarHorarioBasico(h);
      if (error) return res.status(400).json({ message: error });
    }

    const { data: tutor, error: errorTutor } = await supabase
      .from("tutores")
      .select("id, student_key, activo, archivado")
      .eq("id", req.params.id)
      .maybeSingle();

    if (errorTutor) throw errorTutor;
    if (!tutor) {
      return res.status(404).json({ message: "Tutoría no encontrada" });
    }
    if (tutor.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes agregar horarios a esta tutoría" });
    }
    if (!tutor.activo) {
      return res.status(409).json({ message: "Esta tutoría fue desactivada por un administrador" });
    }
    if (tutor.archivado) {
      return res.status(409).json({ message: "Esta tutoría está archivada" });
    }

    const existentes = await horariosPropios(req.studentKey);
    if (hayTraslape(horarios, existentes)) {
      return res.status(409).json({ message: "Ese horario se traslapa con otro que ya tienes publicado" });
    }

    const { data, error } = await supabase
      .from("horarios_tutor")
      .insert(horarios.map((h) => ({ ...h, tutor_id: tutor.id })))
      .select();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ message: "Ya tienes un horario registrado en esa fecha y hora" });
      }
      if (error.code === "23514") {
        return res.status(400).json({ message: "La hora de fin debe ser después de la hora de inicio" });
      }
      throw error;
    }

    res.status(201).json({ ok: true, horarios: data });
  } catch (err) {
    next(err);
  }
});

// Editar un horario propio que todavía no tenga una sesión activa
mentoriasRouter.patch("/horarios/:id", requireAuth, async (req, res, next) => {
  try {
    const { fecha, hora_inicio, hora_fin } = req.body || {};
    const error = validarHorarioBasico({ fecha, hora_inicio, hora_fin });
    if (error) return res.status(400).json({ message: error });

    const { data: horario, error: errorHorario } = await supabase
      .from("horarios_tutor")
      .select("id, tutores(student_key)")
      .eq("id", req.params.id)
      .maybeSingle();
    if (errorHorario) throw errorHorario;
    if (!horario) return res.status(404).json({ message: "Horario no encontrado" });
    if (horario.tutores.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes editar este horario" });
    }

    const { data: sesionActiva, error: errorActiva } = await supabase
      .from("sesiones")
      .select("id")
      .eq("horario_id", req.params.id)
      .in("estado", ["pendiente", "aceptada"])
      .maybeSingle();
    if (errorActiva) throw errorActiva;
    if (sesionActiva) {
      return res.status(409).json({ message: "No puedes editar un horario con una sesión activa; cancélala primero" });
    }

    const existentes = await horariosPropios(req.studentKey, req.params.id);
    if (hayTraslape([{ fecha, hora_inicio, hora_fin }], existentes)) {
      return res.status(409).json({ message: "Ese horario se traslapa con otro que ya tienes publicado" });
    }

    const { data, error: errorUpdate } = await supabase
      .from("horarios_tutor")
      .update({ fecha, hora_inicio, hora_fin })
      .eq("id", req.params.id)
      .select()
      .single();

    if (errorUpdate) {
      if (errorUpdate.code === "23505") {
        return res.status(409).json({ message: "Ya tienes un horario registrado en esa fecha y hora" });
      }
      throw errorUpdate;
    }

    res.json({ ok: true, horario: data });
  } catch (err) {
    next(err);
  }
});

// Horarios de un tutor, vistos por quien busca ayuda: solo los que todavía
// no pasan, y solo si el tutor sigue activo, no pausado y no archivado.
mentoriasRouter.get("/tutores/:id/horarios", requireAuth, async (req, res, next) => {
  try {
    const { data: tutor, error: errorTutor } = await supabase
      .from("tutores")
      .select("id, activo, pausado, archivado")
      .eq("id", req.params.id)
      .maybeSingle();

    if (errorTutor) throw errorTutor;
    if (!tutor || !tutor.activo || tutor.pausado || tutor.archivado) {
      return res.status(404).json({ message: "Esa tutoría no está disponible" });
    }

    const { data, error } = await supabase
      .from("horarios_tutor")
      .select("*")
      .eq("tutor_id", tutor.id)
      .order("fecha", { ascending: true })
      .order("hora_inicio", { ascending: true });

    if (error) throw error;

    const horarios = data.filter((h) => !yaPaso(h.fecha, h.hora_inicio));
    if (horarios.length === 0) return res.json({ ok: true, horarios: [] });

    const { data: sesionesActivas, error: errorSesiones } = await supabase
      .from("sesiones")
      .select("horario_id")
      .in("horario_id", horarios.map((h) => h.id))
      .in("estado", ["pendiente", "aceptada"]);

    if (errorSesiones) throw errorSesiones;

    const idsOcupados = new Set(sesionesActivas.map((s) => s.horario_id));
    res.json({
      ok: true,
      horarios: horarios.map((h) => ({ ...h, disponible: !idsOcupados.has(h.id) })),
    });
  } catch (err) {
    next(err);
  }
});

// Mis horarios como tutor (todos, incluidos los pasados, para llevar historial)
mentoriasRouter.get("/horarios/mios", requireAuth, async (req, res, next) => {
  try {
    const { data: misTutorias, error: errorTutorias } = await supabase
      .from("tutores")
      .select("id")
      .eq("student_key", req.studentKey);

    if (errorTutorias) throw errorTutorias;
    const idsTutor = (misTutorias ?? []).map((t) => t.id);
    if (idsTutor.length === 0) return res.json({ ok: true, horarios: [] });

    const { data: horarios, error } = await supabase
      .from("horarios_tutor")
      .select("*, tutores(nombre_materia)")
      .in("tutor_id", idsTutor)
      .order("fecha", { ascending: true })
      .order("hora_inicio", { ascending: true });

    if (error) throw error;
    if (horarios.length === 0) return res.json({ ok: true, horarios: [] });

    const { data: sesionesActivas, error: errorSesiones } = await supabase
      .from("sesiones")
      .select("horario_id")
      .in("horario_id", horarios.map((h) => h.id))
      .in("estado", ["pendiente", "aceptada"]);

    if (errorSesiones) throw errorSesiones;

    const idsOcupados = new Set(sesionesActivas.map((s) => s.horario_id));
    res.json({
      ok: true,
      horarios: horarios.map((h) => ({ ...h, reservado: idsOcupados.has(h.id) })),
    });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.delete("/horarios/:id", requireAuth, async (req, res, next) => {
  try {
    const { data: horario, error: errorHorario } = await supabase
      .from("horarios_tutor")
      .select("id, tutores(student_key)")
      .eq("id", req.params.id)
      .maybeSingle();

    if (errorHorario) throw errorHorario;
    if (!horario) {
      return res.status(404).json({ message: "Horario no encontrado" });
    }
    if (horario.tutores.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes eliminar este horario" });
    }

    const { data: sesionActiva, error: errorActiva } = await supabase
      .from("sesiones")
      .select("id")
      .eq("horario_id", req.params.id)
      .in("estado", ["pendiente", "aceptada"])
      .maybeSingle();

    if (errorActiva) throw errorActiva;
    if (sesionActiva) {
      return res.status(409).json({ message: "No puedes eliminar un horario con una sesión activa" });
    }

    // sesiones.horario_id no tiene ON DELETE CASCADE: si el horario ya tuvo
    // sesiones rechazadas/canceladas, Postgres lo impide (23503).
    const { error } = await supabase.from("horarios_tutor").delete().eq("id", req.params.id);
    if (error) {
      if (error.code === "23503") {
        return res
          .status(409)
          .json({ message: "Este horario ya tiene historial de solicitudes y no se puede eliminar" });
      }
      throw error;
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Sesiones (solicitudes de tutoría)
// ---------------------------------------------------------------------------

const SELECT_SESION_DETALLE =
  "*, tutores(nombre_materia, nombre, email), horarios_tutor(fecha, hora_inicio, hora_fin)";

// Crear una solicitud (reservar un horario)
mentoriasRouter.post("/sesiones", requireAuth, async (req, res, next) => {
  try {
    const { horario_id } = req.body || {};
    const mensaje = typeof req.body?.mensaje === "string" ? req.body.mensaje.trim() : "";
    if (!horario_id || !mensaje) {
      return res.status(400).json({ message: "Falta horario_id o mensaje" });
    }
    if (!Number.isInteger(Number(horario_id))) {
      return res.status(400).json({ message: "horario_id inválido" });
    }
    if (mensaje.length > MAX_TEXTO) {
      return res.status(400).json({ message: `El mensaje no puede pasar de ${MAX_TEXTO} caracteres` });
    }

    const { data: horario, error: errorHorario } = await supabase
      .from("horarios_tutor")
      .select("id, tutor_id, fecha, hora_inicio, hora_fin, tutores(student_key, activo, pausado, archivado, nombre_materia)")
      .eq("id", horario_id)
      .maybeSingle();

    if (errorHorario) throw errorHorario;
    if (!horario) {
      return res.status(404).json({ message: "Horario no encontrado" });
    }
    if (!horario.tutores.activo || horario.tutores.pausado || horario.tutores.archivado) {
      return res.status(404).json({ message: "Esa tutoría ya no está activa" });
    }
    if (horario.tutores.student_key === req.studentKey) {
      return res.status(400).json({ message: "No puedes reservar tu propio horario" });
    }
    if (yaPaso(horario.fecha, horario.hora_inicio)) {
      return res.status(400).json({ message: "Ese horario ya pasó" });
    }

    const perfil = await siiClient.getEstudiante(req.token);
    const solicitanteNombre = perfil?.data?.persona ?? "";
    const solicitanteEmail = perfil?.data?.email ?? null;

    const { data, error } = await supabase
      .from("sesiones")
      .insert({
        tutor_id: horario.tutor_id,
        horario_id: horario.id,
        solicitante_student_key: req.studentKey,
        solicitante_nombre: solicitanteNombre,
        solicitante_email: solicitanteEmail,
        mensaje,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation sobre el índice parcial: alguien más ya
      // reservó este horario justo antes que tú
      if (error.code === "23505") {
        return res.status(409).json({ message: "Ese horario ya fue reservado por otro estudiante" });
      }
      throw error;
    }

    await notificarSeguro(
      horario.tutores.student_key,
      `${solicitanteNombre || "Un estudiante"} solicitó tu tutoría de ${horario.tutores.nombre_materia} ` +
        `el ${horario.fecha} de ${hhmm(horario.hora_inicio)} a ${hhmm(horario.hora_fin)}.`,
      "mentoria"
    );

    res.status(201).json({ ok: true, sesion: data });
  } catch (err) {
    next(err);
  }
});

// Sesiones que YO pedí, como estudiante que busca ayuda
mentoriasRouter.get("/sesiones/enviadas", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("sesiones")
      .select(SELECT_SESION_DETALLE)
      .eq("solicitante_student_key", req.studentKey)
      .eq("oculta_para_solicitante", false)
      .order("creado_en", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, sesiones: data });
  } catch (err) {
    next(err);
  }
});

// Sesiones que me pidieron a MÍ, como tutor
mentoriasRouter.get("/sesiones/recibidas", requireAuth, async (req, res, next) => {
  try {
    const { data: misTutorias, error: errorTutorias } = await supabase
      .from("tutores")
      .select("id")
      .eq("student_key", req.studentKey);

    if (errorTutorias) throw errorTutorias;

    const idsTutor = (misTutorias ?? []).map((t) => t.id);
    if (idsTutor.length === 0) {
      return res.json({ ok: true, sesiones: [] });
    }

    const { data, error } = await supabase
      .from("sesiones")
      .select(SELECT_SESION_DETALLE)
      .in("tutor_id", idsTutor)
      .eq("oculta_para_tutor", false)
      .order("creado_en", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, sesiones: data });
  } catch (err) {
    next(err);
  }
});

// El tutor acepta o rechaza una solicitud pendiente. Al aceptar puede
// mandar un dato de contacto (lugar, link de videollamada, etc.) que solo
// verán las dos personas de esa sesión.
mentoriasRouter.patch("/sesiones/:id/estado", requireAuth, async (req, res, next) => {
  try {
    const { estado } = req.body || {};
    const lugarOEnlace = typeof req.body?.lugar_o_enlace === "string" ? req.body.lugar_o_enlace.trim() : "";
    if (!["aceptada", "rechazada"].includes(estado)) {
      return res.status(400).json({ message: "Estado inválido" });
    }
    if (lugarOEnlace.length > MAX_TEXTO) {
      return res.status(400).json({ message: `El dato de contacto no puede pasar de ${MAX_TEXTO} caracteres` });
    }

    // Confirma que la sesión pertenezca a una tutoría tuya (no cualquiera
    // puede aceptar/rechazar solicitudes ajenas)
    const { data: sesion, error: errorSesion } = await supabase
      .from("sesiones")
      .select("*, tutores(student_key, nombre_materia)")
      .eq("id", req.params.id)
      .maybeSingle();

    if (errorSesion) throw errorSesion;
    if (!sesion) {
      return res.status(404).json({ message: "Sesión no encontrada" });
    }
    if (sesion.tutores.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes modificar esta sesión" });
    }
    if (sesion.estado !== "pendiente") {
      return res.status(409).json({ message: `Esta solicitud ya está ${sesion.estado}` });
    }

    const cambios = { estado, actualizado_en: new Date().toISOString() };
    if (estado === "aceptada" && lugarOEnlace) cambios.lugar_o_enlace = lugarOEnlace;

    // .eq("estado", "pendiente") evita pisar un cambio simultáneo (por
    // ejemplo, que el solicitante cancele justo al mismo tiempo).
    const { data, error } = await supabase
      .from("sesiones")
      .update(cambios)
      .eq("id", req.params.id)
      .eq("estado", "pendiente")
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(409).json({ message: "La solicitud cambió mientras la procesabas. Recarga la lista." });
    }

    await notificarSeguro(
      sesion.solicitante_student_key,
      `Tu solicitud de tutoría de ${sesion.tutores.nombre_materia} fue ${estado === "aceptada" ? "aceptada" : "rechazada"}.`,
      "mentoria"
    );

    res.json({ ok: true, sesion: data });
  } catch (err) {
    next(err);
  }
});

// El solicitante cancela su propia solicitud (pendiente o ya aceptada).
// Al pasar a "cancelada" el horario queda libre otra vez: el índice único
// parcial solo cuenta sesiones pendientes/aceptadas.
mentoriasRouter.patch("/sesiones/:id/cancelar", requireAuth, async (req, res, next) => {
  try {
    const { data: sesion, error: errorSesion } = await supabase
      .from("sesiones")
      .select("*, tutores(student_key, nombre_materia)")
      .eq("id", req.params.id)
      .maybeSingle();

    if (errorSesion) throw errorSesion;
    if (!sesion) {
      return res.status(404).json({ message: "Sesión no encontrada" });
    }
    if (sesion.solicitante_student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes cancelar esta solicitud" });
    }
    if (!["pendiente", "aceptada"].includes(sesion.estado)) {
      return res.status(409).json({ message: `Esta solicitud ya está ${sesion.estado}` });
    }

    const { data, error } = await supabase
      .from("sesiones")
      .update({ estado: "cancelada", actualizado_en: new Date().toISOString() })
      .eq("id", req.params.id)
      .in("estado", ["pendiente", "aceptada"])
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(409).json({ message: "La solicitud cambió mientras la procesabas. Recarga la lista." });
    }

    await notificarSeguro(
      sesion.tutores.student_key,
      `${sesion.solicitante_nombre || "Un estudiante"} canceló su solicitud de tutoría de ${sesion.tutores.nombre_materia}.`,
      "mentoria"
    );

    res.json({ ok: true, sesion: data });
  } catch (err) {
    next(err);
  }
});

// El TUTOR cancela una sesión ya aceptada (con motivo opcional)
mentoriasRouter.patch("/sesiones/:id/cancelar-tutor", requireAuth, async (req, res, next) => {
  try {
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    if (motivo.length > MAX_TEXTO) {
      return res.status(400).json({ message: `El motivo no puede pasar de ${MAX_TEXTO} caracteres` });
    }

    const { data: sesion, error: errorSesion } = await supabase
      .from("sesiones")
      .select("*, tutores(student_key, nombre_materia)")
      .eq("id", req.params.id)
      .maybeSingle();

    if (errorSesion) throw errorSesion;
    if (!sesion) return res.status(404).json({ message: "Sesión no encontrada" });
    if (sesion.tutores.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes cancelar esta sesión" });
    }
    if (!["pendiente", "aceptada"].includes(sesion.estado)) {
      return res.status(409).json({ message: `Esta solicitud ya está ${sesion.estado}` });
    }

    const cambios = { estado: "cancelada", actualizado_en: new Date().toISOString() };
    if (motivo) cambios.motivo_cancelacion = motivo;

    const { data, error } = await supabase
      .from("sesiones")
      .update(cambios)
      .eq("id", req.params.id)
      .in("estado", ["pendiente", "aceptada"])
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(409).json({ message: "La solicitud cambió mientras la procesabas. Recarga la lista." });
    }

    await notificarSeguro(
      sesion.solicitante_student_key,
      `Tu tutor canceló la sesión de ${sesion.tutores.nombre_materia}${motivo ? `: ${motivo}` : "."}`,
      "mentoria"
    );

    res.json({ ok: true, sesion: data });
  } catch (err) {
    next(err);
  }
});

// El tutor marca una sesión aceptada como concluida (solo si ya pasó la hora)
mentoriasRouter.patch("/sesiones/:id/concluir", requireAuth, async (req, res, next) => {
  try {
    const { data: sesion, error: errorSesion } = await supabase
      .from("sesiones")
      .select("*, tutores(student_key, nombre_materia), horarios_tutor(fecha, hora_inicio)")
      .eq("id", req.params.id)
      .maybeSingle();

    if (errorSesion) throw errorSesion;
    if (!sesion) return res.status(404).json({ message: "Sesión no encontrada" });
    if (sesion.tutores.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes concluir esta sesión" });
    }
    if (sesion.estado !== "aceptada") {
      return res.status(409).json({ message: "Solo puedes concluir una sesión aceptada" });
    }
    if (!yaPaso(sesion.horarios_tutor.fecha, sesion.horarios_tutor.hora_inicio)) {
      return res.status(409).json({ message: "Todavía no llega la hora de esta sesión" });
    }

    const { data, error } = await supabase
      .from("sesiones")
      .update({ estado: "completada", actualizado_en: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("estado", "aceptada")
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(409).json({ message: "La solicitud cambió mientras la procesabas. Recarga la lista." });
    }

    res.json({ ok: true, sesion: data });
  } catch (err) {
    next(err);
  }
});

// "Quitar de mi lista": cada persona oculta la sesión solo de su propia
// vista. No borra nada de la base, así que el historial del otro queda
// intacto. Solo aplica a sesiones que ya llegaron a un estado final.
mentoriasRouter.patch("/sesiones/:id/ocultar", requireAuth, async (req, res, next) => {
  try {
    const { data: sesion, error: errorSesion } = await supabase
      .from("sesiones")
      .select("id, estado, solicitante_student_key, tutores(student_key)")
      .eq("id", req.params.id)
      .maybeSingle();

    if (errorSesion) throw errorSesion;
    if (!sesion) return res.status(404).json({ message: "Sesión no encontrada" });
    if (!["rechazada", "cancelada", "completada"].includes(sesion.estado)) {
      return res.status(409).json({ message: "Solo puedes quitar sesiones que ya terminaron" });
    }

    const esSolicitante = sesion.solicitante_student_key === req.studentKey;
    const esTutor = sesion.tutores.student_key === req.studentKey;
    if (!esSolicitante && !esTutor) {
      return res.status(403).json({ message: "Esta sesión no es tuya" });
    }

    const cambios = esSolicitante ? { oculta_para_solicitante: true } : { oculta_para_tutor: true };
    const { data, error } = await supabase
      .from("sesiones")
      .update(cambios)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, sesion: data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------------

mentoriasRouter.get("/admin/ping", requireAuth, requireAdmin, (_req, res) => {
  res.json({ ok: true, esAdmin: true });
});

// Lista completa de tutores (activos e inactivos) con todos sus datos
mentoriasRouter.get("/admin/tutores", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("tutores")
      .select("*")
      .order("creado_en", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, tutores: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.get("/admin/sesiones", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("sesiones")
      .select(SELECT_SESION_DETALLE)
      .order("creado_en", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, sesiones: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.patch("/admin/tutores/:id/desactivar", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("tutores")
      .update({ activo: false })
      .eq("id", req.params.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: "Tutor no encontrado" });

    res.json({ ok: true, tutor: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.post("/admin/admins", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const student_key = typeof req.body?.student_key === "string" ? req.body.student_key.trim() : "";
    const nombre = typeof req.body?.nombre === "string" ? req.body.nombre.trim() : "";
    if (!student_key) {
      return res.status(400).json({ message: "Falta student_key" });
    }
    if (student_key.length > 100 || nombre.length > 200) {
      return res.status(400).json({ message: "student_key o nombre demasiado largos" });
    }

    const { data, error } = await supabase
      .from("admins")
      .insert({ student_key, nombre: nombre || null })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ message: "Ya es administrador" });
      }
      throw error;
    }

    res.status(201).json({ ok: true, admin: data });
  } catch (err) {
    next(err);
  }
});
