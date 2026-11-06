import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { siiClient } from "../services/siiClient.js";

export const estudianteRouter = Router();
estudianteRouter.use(requireAuth);

function proxy(fetcher) {
  return async (req, res) => {
    try {
      const data = await fetcher(req.token);
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ message: err.message });
    }
  };
}

estudianteRouter.get("/", proxy(siiClient.getEstudiante));
estudianteRouter.get("/calificaciones", proxy(siiClient.getCalificaciones));
estudianteRouter.get("/kardex", proxy(siiClient.getKardex));
estudianteRouter.get("/horarios", proxy(siiClient.getHorarios));