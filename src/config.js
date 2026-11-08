import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 4000),
  siiBaseUrl: process.env.SII_API_BASE_URL,
  monitorIntervalMs: Number(process.env.MONITOR_INTERVAL_MS || 120000),
  isProduction: process.env.NODE_ENV === "production",
  // URLs exactas permitidas por CORS (para desarrollo local, separadas por coma)
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim()),
  // Acepta automáticamente cualquier URL de Vercel que empiece con el nombre
  // de tu proyecto (producción, previews de rama, o deploys individuales),
  // para no tener que editar CORS_ORIGIN cada vez que Vercel genera una nueva.
  corsVercelPattern: /^https:\/\/examen-sii-itc-frontend[a-z0-9-]*\.vercel\.app$/,
};