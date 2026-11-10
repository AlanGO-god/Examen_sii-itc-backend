import "dotenv/config";

// Falla al arrancar, con un mensaje claro, si falta algo imprescindible
// (en vez de reventar más tarde con un error críptico de Supabase o axios).
const REQUERIDAS = ["SII_API_BASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET"];
const faltantes = REQUERIDAS.filter((nombre) => !process.env[nombre]);
if (faltantes.length) {
  throw new Error(
    `Faltan variables de entorno: ${faltantes.join(", ")}. Revisa tu .env (ver .env.example).`
  );
}
if (process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET debe tener al menos 32 caracteres (ver .env.example para generarlo).");
}

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lista = (valor) =>
  (valor || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// Prefijo del proyecto en Vercel. Acepta producción, previews de rama y
// deploys individuales: https://<prefijo>*.vercel.app
const vercelPrefix = process.env.CORS_VERCEL_PREFIX || "examen-sii-itc-frontend";

export const config = {
  port: Number(process.env.PORT || 4000),
  siiBaseUrl: process.env.SII_API_BASE_URL,
  monitorIntervalMs: Number(process.env.MONITOR_INTERVAL_MS || 120000),
  isProduction: process.env.NODE_ENV === "production",
  // URLs exactas permitidas por CORS (desarrollo local, separadas por coma)
  corsOrigins: lista(process.env.CORS_ORIGIN || "http://localhost:5173"),
  corsVercelPattern: new RegExp(`^https://${escapar(vercelPrefix)}[a-z0-9-]*\\.vercel\\.app$`),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  tutorCalificacionMinima: Number(process.env.TUTOR_CALIFICACION_MINIMA || 80),
  // Secreto con el que se firma la cookie de sesión de ESTE backend.
  sessionSecret: process.env.SESSION_SECRET,
  // Administradores iniciales (student_key separados por coma). Sirve para
  // crear al primer admin sin tocar la base de datos a mano.
  adminStudentKeys: lista(process.env.ADMIN_STUDENT_KEYS),
};
