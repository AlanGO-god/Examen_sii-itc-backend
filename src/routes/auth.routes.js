import { Router } from "express";
import rateLimit from "express-rate-limit";
import { siiClient } from "../services/siiClient.js";
import { crearSesion, leerSesion } from "../services/session.js";
import { detenerMonitoreo } from "../services/monitor.js";
import { requireAuth, decodificarPayload, studentKeyDeToken, COOKIE_SESION } from "../middleware/auth.js";
import { config } from "../config.js";

export const authRouter = Router();

const DOMINIOS_INSTITUCIONALES = ["celaya.tecnm.mx", "itcelaya.edu.mx"];

function esCorreoInstitucional(email) {
  if (typeof email !== "string") return false;
  const dominio = email.split("@")[1]?.toLowerCase();
  return DOMINIOS_INSTITUCIONALES.includes(dominio);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos." },
});

const opcionesCookie = (maxAge) => ({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: config.isProduction ? "none" : "lax",
  path: "/",
  maxAge,
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: "Correo y contraseña son obligatorios" });
  }

  if (!esCorreoInstitucional(email)) {
    return res.status(400).json({
      message: `Usa tu correo institucional (@${DOMINIOS_INSTITUCIONALES.join(" o @")})`,
    });
  }

  try {
    // Las credenciales se mandan al SII tal cual y no se guardan en ningún lado.
    const result = await siiClient.login(email, password);
    const token = result?.message?.login?.token;

    if (!token) {
      return res.status(502).json({ message: "La API del SII no regresó un token válido" });
    }

    // El token del SII dice cuánto dura la sesión; nuestra cookie dura lo mismo.
    const payload = decodificarPayload(token);
    const msRestantes = payload?.exp ? Math.max(payload.exp * 1000 - Date.now(), 0) : 60 * 60 * 1000;

    const sesion = crearSesion({
      siiToken: token,
      studentKey: studentKeyDeToken(token),
      expiraEnMs: msRestantes,
    });

    res.cookie(COOKIE_SESION, sesion, opcionesCookie(msRestantes));
    res.json({ ok: true, expiraEn: msRestantes });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

authRouter.post("/logout", (req, res) => {
  // Si había monitoreo automático corriendo con el token de esta sesión, se detiene.
  const sesion = leerSesion(req.cookies?.[COOKIE_SESION]);
  if (sesion) detenerMonitoreo(sesion.sub);

  res.clearCookie(COOKIE_SESION, { ...opcionesCookie(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get("/session", requireAuth, (req, res) => {
  res.json({
    ok: true,
    expiraEn: Math.max(req.sesionExpira - Date.now(), 0),
    // Útil para darte de alta como primer admin (ADMIN_STUDENT_KEYS).
    studentKey: req.studentKey,
  });
});
