import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 4000),
  siiBaseUrl: process.env.SII_API_BASE_URL,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  monitorIntervalMs: Number(process.env.MONITOR_INTERVAL_MS || 120000),
};