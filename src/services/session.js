import crypto from "node:crypto";
import { config } from "../config.js";

// Sesión propia de este backend: una cookie firmada con HMAC-SHA256.
//
// Por qué existe: el JWT del SII no podemos verificarlo (no tenemos su
// llave), así que cualquiera podía inventar uno con el "sub" de otra persona
// y las rutas que no llaman al SII (mentorías, admin) lo creían. Ahora la
// cookie solo es válida si la firmamos nosotros, y solo la firmamos justo
// después de que el SII aceptó las credenciales.
//
// El token del SII viaja dentro (campo "t") para poder reenviarlo a la API
// institucional, igual que antes. La contraseña nunca se guarda.

function firmar(cuerpo) {
  return crypto.createHmac("sha256", config.sessionSecret).update(cuerpo).digest("base64url");
}

export function crearSesion({ siiToken, studentKey, expiraEnMs }) {
  const payload = { sub: studentKey, t: siiToken, exp: Date.now() + expiraEnMs };
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${cuerpo}.${firmar(cuerpo)}`;
}

// Regresa el payload si la cookie es auténtica y no ha caducado; si no, null.
export function leerSesion(valor) {
  if (typeof valor !== "string") return null;

  const partes = valor.split(".");
  if (partes.length !== 2) return null;
  const [cuerpo, firma] = partes;

  const esperada = Buffer.from(firmar(cuerpo));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf-8"));
    if (!payload.sub || !payload.t || !payload.exp || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
