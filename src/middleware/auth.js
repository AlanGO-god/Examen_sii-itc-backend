import crypto from "node:crypto";

// Decodifica el "payload" de un JWT (la parte de en medio, entre los dos
// puntos) sin verificar la firma — no necesitamos verificarla aquí, porque
// quien de verdad valida el token es la API del SII cuando se lo reenviamos;
// nosotros solo queremos leer el campo "sub" (el identificador del alumno).
function decodificarPayload(token) {
  try {
    const [, payload] = token.split(".");
    const json = Buffer.from(payload, "base64url").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Falta el token Bearer" });
  }

  req.token = token;

  const payload = decodificarPayload(token);
  req.studentKey = payload?.sub
    ? String(payload.sub)
    : crypto.createHash("sha256").update(token).digest("hex"); // respaldo si el token no trae "sub"

  next();
}