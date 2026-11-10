import { config } from "../config.js";

export function origenPermitido(origin) {
  return config.corsOrigins.includes(origin) || config.corsVercelPattern.test(origin);
}

// Defensa extra contra CSRF (la cookie va con SameSite=None en producción).
// CORS ya rechaza orígenes ajenos; esto además exige que las peticiones que
// modifican datos declaren su Origin. Los navegadores siempre lo mandan en
// POST/PATCH/DELETE entre sitios. Solo se aplica en producción para no
// estorbar las pruebas con curl/Postman en local.
export function exigirOrigen(req, res, next) {
  const modifica = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (config.isProduction && modifica) {
    const origin = req.get("origin");
    if (!origin || !origenPermitido(origin)) {
      return res.status(403).json({ message: "Origen no permitido" });
    }
  }
  next();
}
