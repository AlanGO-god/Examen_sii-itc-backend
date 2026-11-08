import crypto from "node:crypto";
import { supabase } from "../services/supabaseClient.js";

// Decodifica el "payload" de un JWT (la parte de en medio) sin verificar la
// firma — no hace falta verificarla aquí, porque quien de verdad la valida
// es la API del SII cuando reenviamos el token. Solo necesitamos leer "sub"
// y "exp".
export function decodificarPayload(token) {
  try {
    const [, payload] = token.split(".");
    const json = Buffer.from(payload, "base64url").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  // El token ya no viene en un header: ahora vive en una cookie httpOnly que
  // el navegador adjunta solo. JavaScript del navegador no puede leerla
  // (eso es justo lo que la protege de robo vía XSS).
  const token = req.cookies?.sii_token;

  if (!token) {
    return res.status(401).json({ message: "No hay una sesión activa" });
  }

  req.token = token;

  const payload = decodificarPayload(token);
  req.studentKey = payload?.sub
    ? String(payload.sub)
    : crypto.createHash("sha256").update(token).digest("hex");

  next();
}

export async function requireAdmin(req, res, next) {
  try {
    const { data } = await supabase
      .from("admins")
      .select("student_key")
      .eq("student_key", req.studentKey)
      .maybeSingle();

    if (!data) {
      return res.status(403).json({ message: "No tienes permisos de administrador" });
    }
    next();
  } catch (err) {
    next(err);
  }
}