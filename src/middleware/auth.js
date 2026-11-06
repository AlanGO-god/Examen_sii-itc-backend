import crypto from "node:crypto";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Falta el token Bearer" });
  }

  req.token = token;
  // No guardamos el token tal cual como llave en la base local (sería
  // exponer la credencial de sesión en texto plano en el archivo). En vez
  // de eso, usamos su hash SHA-256: es determinístico (mismo token → mismo
  // hash siempre, así que podemos "reconocerte" entre peticiones) pero no
  // se puede revertir para obtener el token original.
  req.studentKey = crypto.createHash("sha256").update(token).digest("hex");
  next();
}