import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { materiasElegibles } from "../services/mentorias.js";

export const mentoriasRouter = Router();

mentoriasRouter.get("/materias-elegibles", requireAuth, async (req, res, next) => {
  try {
    const materias = await materiasElegibles(req.token);
    res.json({ ok: true, materias });
  } catch (err) {
    next(err);
  }
});