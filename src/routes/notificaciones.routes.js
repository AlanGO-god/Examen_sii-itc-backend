import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listNotifications, markAllRead } from "../db/store.js";
import { revisarAhora, iniciarMonitoreo, detenerMonitoreo, estaMonitoreando } from "../services/monitor.js";

export const notificacionesRouter = Router();
notificacionesRouter.use(requireAuth);

notificacionesRouter.get("/", (req, res) => {
  res.json({
    monitoreando: estaMonitoreando(req.studentKey),
    notificaciones: listNotifications(req.studentKey),
  });
});

notificacionesRouter.post("/revisar", async (req, res) => {
  try {
    const nuevas = await revisarAhora(req.studentKey, req.token);
    res.json({ nuevas });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

notificacionesRouter.post("/monitoreo/iniciar", async (req, res) => {
  try {
    await revisarAhora(req.studentKey, req.token); // primera revisión, para tener un snapshot base
    iniciarMonitoreo(req.studentKey, req.token);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

notificacionesRouter.post("/monitoreo/detener", (req, res) => {
  detenerMonitoreo(req.studentKey);
  res.json({ ok: true });
});

notificacionesRouter.post("/leidas", (req, res) => {
  markAllRead(req.studentKey);
  res.json({ ok: true });
});