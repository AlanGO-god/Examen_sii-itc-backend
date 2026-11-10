import crypto from "node:crypto";
import { supabase } from "../services/supabaseClient.js";
import { leerSesion } from "../services/session.js";
import { config } from "../config.js";

export const COOKIE_SESION = "sii_session";

// Decodifica el "payload" de un JWT (parte de en medio) SIN verificar firma.
// Solo se usa una vez, en el login, sobre el token que el SII acaba de
// entregarnos por HTTPS, para leer "sub" y "exp". Nunca se usa para decidir
// quién es el usuario en peticiones posteriores (eso lo hace leerSesion).
export function decodificarPayload(token) {
  try {
    const [, payload] = token.split(".");
    const json = Buffer.from(payload, "base64url").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Identificador estable del estudiante a partir del token del SII.
export function studentKeyDeToken(token) {
  const payload = decodificarPayload(token);
  return payload?.sub
    ? String(payload.sub)
    : crypto.createHash("sha256").update(token).digest("hex");
}

export function requireAuth(req, res, next) {
  // La cookie es httpOnly: JavaScript del navegador no puede leerla, y solo
  // es válida si está firmada por este backend.
  const sesion = leerSesion(req.cookies?.[COOKIE_SESION]);

  if (!sesion) {
    return res.status(401).json({ message: "No hay una sesión activa" });
  }

  req.token = sesion.t; // token del SII, para reenviarlo a su API
  req.studentKey = sesion.sub;
  req.sesionExpira = sesion.exp;
  next();
}

export async function requireAdmin(req, res, next) {
  try {
    if (config.adminStudentKeys.includes(req.studentKey)) return next();

    const { data, error } = await supabase
      .from("admins")
      .select("student_key")
      .eq("student_key", req.studentKey)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(403).json({ message: "No tienes permisos de administrador" });
    }
    next();
  } catch (err) {
    next(err);
  }
}
