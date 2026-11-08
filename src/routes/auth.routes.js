import { Router } from "express";
import rateLimit from "express-rate-limit";
import { siiClient } from "../services/siiClient.js";
import { requireAuth, decodificarPayload } from "../middleware/auth.js";
import { config } from "../config.js";

export const authRouter = Router();

const DOMINIOS_INSTITUCIONALES = ["celaya.tecnm.mx", "itcelaya.edu.mx"];

function esCorreoInstitucional(email) {
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

// Calcula cuánto tiempo real le queda al token (según su propio campo "exp")
// y arma, a partir de eso, tanto las opciones de la cookie como el dato que
// le mandamos al frontend para que sepa cuándo debe cerrar la sesión sola.
function datosSesion(token) {
  const payload = decodificarPayload(token);
  const msRestantes = payload?.exp ? Math.max(payload.exp * 1000 - Date.now(), 0) : 60 * 60 * 1000;

  return {
    msRestantes,
    opcionesCookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: config.isProduction ? "none" : "lax",
      path: "/",
      maxAge: msRestantes,
    },
  };
}

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
    const result = await siiClient.login(email, password);
    const token = result?.message?.login?.token;

    if (!token) {
      return res.status(502).json({ message: "La API del SII no regresó un token válido" });
    }

    const { msRestantes, opcionesCookie } = datosSesion(token);
    res.cookie("sii_token", token, opcionesCookie);
    res.json({ ok: true, expiraEn: msRestantes });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("sii_token", { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/session", requireAuth, (req, res) => {
  const { msRestantes } = datosSesion(req.token);
  res.json({ ok: true, expiraEn: msRestantes });
});