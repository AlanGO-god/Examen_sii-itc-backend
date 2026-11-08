import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.routes.js";
import { estudianteRouter } from "./routes/estudiante.routes.js";
import { notificacionesRouter } from "./routes/notificaciones.routes.js";
import { mentoriasRouter } from "./routes/mentorias.routes.js";

const app = express();

// Render corre detrás de un proxy; esto es necesario para que rate-limit
// identifique la IP real de quien hace la petición, no la del proxy.
app.set("trust proxy", 1);

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      // Una petición sin "origin" (curl, o checks internos de Render) no
      // viene de un navegador — la dejamos pasar.
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin) || config.corsVercelPattern.test(origin)) {
        return callback(null, true);
      }
      callback(new Error("Origen no permitido por CORS"));
    },
    credentials: true, // necesario para que el navegador mande/reciba la cookie entre dominios
  })
);

app.use(cookieParser());
app.use(express.json());

// Límite general de peticiones a la API, defensa básica contra abuso.
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", authRouter);
app.use("/api/estudiante", estudianteRouter);
app.use("/api/notificaciones", notificacionesRouter);
app.use("/api/mentorias", mentoriasRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.message === "Origen no permitido por CORS" ? 403 : 500;
  res.status(status).json({ message: err.message || "Error interno del servidor" });
});

app.listen(config.port, () => {
  console.log(`Backend escuchando en http://localhost:${config.port}`);
});