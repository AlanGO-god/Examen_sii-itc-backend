import { Router } from "express";
import { materiasElegibles } from "../services/mentorias.js";
import { supabase } from "../services/supabaseClient.js";
import { siiClient } from "../services/siiClient.js";
import { addNotification } from "../db/store.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export const mentoriasRouter = Router();

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
    const { clave_materia } = req.body;
    if (!clave_materia) {
      return res.status(400).json({ message: "Falta clave_materia" });
    }

    // Verifica que la materia realmente esté en su lista de elegibles
    // (no confiamos en que el frontend mande datos correctos)
    const materias = await materiasElegibles(req.token);
    const materia = materias.find((m) => m.clave_materia === clave_materia);
    if (!materia) {
      return res.status(403).json({ message: "No calificas como tutor de esa materia" });
    }

    // Trae nombre y número de control reales desde el perfil del SII
    const perfil = await siiClient.getEstudiante(req.token);
    const nombre = perfil?.data?.persona ?? "";
    const numeroControl = perfil?.data?.numero_control ?? "";

    const { data, error } = await supabase
      .from("tutores")
      .insert({
        student_key: req.studentKey,
        nombre,
        numero_control: String(numeroControl),
        clave_materia: materia.clave_materia,
        nombre_materia: materia.nombre_materia,
        calificacion_acreditada: materia.calificacion,
        descripcion: req.body.descripcion ?? null,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation (ya eres tutor de esa materia)
      if (error.code === "23505") {
        return res.status(409).json({ message: "Ya te ofreciste como tutor de esa materia" });
      }
      throw error;
    }

    res.status(201).json({ ok: true, tutor: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.get("/tutores", requireAuth, async (req, res, next) => {
  try {
    let query = supabase
      .from("tutores")
      .select("*")
      .eq("activo", true)
      .order("creado_en", { ascending: false });

    if (req.query.clave_materia) {
      query = query.eq("clave_materia", req.query.clave_materia);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ ok: true, tutores: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.post("/sesiones", requireAuth, async (req, res, next) => {
  try {
    const { tutor_id, mensaje, disponibilidad_propuesta } = req.body;
    if (!tutor_id || !mensaje) {
      return res.status(400).json({ message: "Falta tutor_id o mensaje" });
    }

    // Confirma que el tutor exista y esté activo antes de crear la solicitud
    const { data: tutor, error: errorTutor } = await supabase
      .from("tutores")
      .select("id, student_key, nombre_materia")
      .eq("id", tutor_id)
      .eq("activo", true)
      .single();

    if (errorTutor || !tutor) {
      return res.status(404).json({ message: "Tutor no encontrado o inactivo" });
    }

    if (tutor.student_key === req.studentKey) {
      return res.status(400).json({ message: "No puedes solicitarte una sesión a ti mismo" });
    }

    const perfil = await siiClient.getEstudiante(req.token);
    const solicitanteNombre = perfil?.data?.persona ?? "";

    const { data, error } = await supabase
      .from("sesiones")
      .insert({
        tutor_id,
        solicitante_student_key: req.studentKey,
        solicitante_nombre: solicitanteNombre,
        mensaje,
        disponibilidad_propuesta: disponibilidad_propuesta ?? null,
      })
      .select()
      .single();

    if (error) throw error;

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
      .select("*, tutores(nombre_materia, nombre)")
      .eq("solicitante_student_key", req.studentKey)
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
      .select("*")
      .in("tutor_id", idsTutor)
      .order("creado_en", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, sesiones: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.patch("/sesiones/:id/estado", requireAuth, async (req, res, next) => {
  try {
    const { estado } = req.body;
    if (!["aceptada", "rechazada"].includes(estado)) {
      return res.status(400).json({ message: "Estado inválido" });
    }

    // Confirma que la sesión pertenezca a una tutoría tuya (no cualquiera
    // puede aceptar/rechazar solicitudes ajenas)
    const { data: sesion, error: errorSesion } = await supabase
      .from("sesiones")
      .select("*, tutores(student_key, nombre_materia)")
      .eq("id", req.params.id)
      .single();

    if (errorSesion || !sesion) {
      return res.status(404).json({ message: "Sesión no encontrada" });
    }

    if (sesion.tutores.student_key !== req.studentKey) {
      return res.status(403).json({ message: "No puedes modificar esta sesión" });
    }

    const { data, error } = await supabase
      .from("sesiones")
      .update({ estado, actualizado_en: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    const mensaje =
      estado === "aceptada"
        ? `Tu solicitud de tutoría de ${sesion.tutores.nombre_materia} fue aceptada.`
        : `Tu solicitud de tutoría de ${sesion.tutores.nombre_materia} fue rechazada.`;
    addNotification(sesion.solicitante_student_key, "mentoria", mensaje);

    res.json({ ok: true, sesion: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.post("/admin/admins", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { student_key, nombre } = req.body;
    if (!student_key) {
      return res.status(400).json({ message: "Falta student_key" });
    }

    const { data, error } = await supabase
      .from("admins")
      .insert({ student_key, nombre: nombre ?? null })
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

mentoriasRouter.get("/admin/tutores", requireAuth, requireAdmin, async (req, res, next) => {
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

mentoriasRouter.patch("/admin/tutores/:id/desactivar", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("tutores")
      .update({ activo: false })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: "Tutor no encontrado" });

    res.json({ ok: true, tutor: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.get("/admin/sesiones", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("sesiones")
      .select("*, tutores(nombre_materia, nombre)")
      .order("creado_en", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, sesiones: data });
  } catch (err) {
    next(err);
  }
});

mentoriasRouter.get("/admin/ping", requireAuth, requireAdmin, (req, res) => {
  res.json({ ok: true, esAdmin: true });
});

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