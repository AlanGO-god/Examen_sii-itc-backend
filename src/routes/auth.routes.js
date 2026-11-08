import { Router } from "express";
import rateLimit from "express-rate-limit";
import { siiClient } from "../services/siiClient.js";
import { requireAuth, decodificarPayload } from "../middleware/auth.js";
import { config } from "../config.js";

export const authRouter = Router();

// Máximo 10 intentos de login por IP cada 15 minutos — defensa real contra
// fuerza bruta de contraseñas.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos." },
});

function opcionesCookie(token) {
  const payload = decodificarPayload(token);
  // La cookie dura lo mismo que el token real (leído de su campo "exp"),
  // nunca más — así nunca queda una cookie viva después de que el token ya
  // no sirve.
  const msRestantes = payload?.exp ? payload.exp * 1000 - Date.now() : 60 * 60 * 1000;

  return {
    httpOnly: true,
    secure: config.isProduction,
    // "none" es obligatorio para cookies entre dominios distintos (Vercel y
    // Render) en producción; en local, frontend y backend comparten el mismo
    // "sitio" (localhost), así que "lax" basta y no requiere HTTPS.
    sameSite: config.isProduction ? "none" : "lax",
    path: "/",
    maxAge: Math.max(msRestantes, 0),
  };
}

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: "Correo y contraseña son obligatorios" });
  }

  try {
    const result = await siiClient.login(email, password);
    const token = result?.message?.login?.token;

    if (!token) {
      return res.status(502).json({ message: "La API del SII no regresó un token válido" });
    }

    res.cookie("sii_token", token, opcionesCookie(token));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("sii_token", { path: "/" });
  res.json({ ok: true });
});

// El frontend llama esto al cargar la página para saber si la cookie sigue
// siendo válida (no puede leer su contenido, así que pregunta al backend).
authRouter.get("/session", requireAuth, (_req, res) => {
  res.json({ ok: true });
});