import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { materiasElegibles } from "../services/mentorias.js";
import { supabase } from "../services/supabaseClient.js";
import { siiClient } from "../services/siiClient.js";

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