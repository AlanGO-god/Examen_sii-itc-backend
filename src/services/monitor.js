import { config } from "../config.js";
import { siiClient } from "./siiClient.js";
import { getSnapshot, saveSnapshot, addNotification } from "../db/store.js";
import { diffCalificaciones, diffHorarios } from "./diff.js";

// Monitoreos activos en memoria: studentKey -> intervalId.
// Vive mientras el proceso del backend esté corriendo; no persiste en disco
// a propósito (si reinicias el backend, el estudiante tiene que volver a
// activar el monitoreo desde el frontend — es un estado de sesión, no un dato).
const monitoreosActivos = new Map();

/**
 * Hace una revisión: trae calificaciones y horario actuales de la API real,
 * los compara contra el último snapshot guardado, genera notificaciones por
 * cada diferencia, y guarda el nuevo snapshot para la siguiente comparación.
 */
export async function revisarAhora(studentKey, token) {
  const [calificacionesActual, horariosActual] = await Promise.all([
    siiClient.getCalificaciones(token),
    siiClient.getHorarios(token),
  ]);

  const calificacionesAnterior = getSnapshot(studentKey, "calificaciones");
  const horariosAnterior = getSnapshot(studentKey, "horarios");

  const mensajes = [
    ...diffCalificaciones(calificacionesAnterior, calificacionesActual.data),
    ...diffHorarios(horariosAnterior, horariosActual.data),
  ];

  saveSnapshot(studentKey, "calificaciones", calificacionesActual.data);
  saveSnapshot(studentKey, "horarios", horariosActual.data);

  for (const mensaje of mensajes) {
    addNotification(studentKey, mensaje);
  }

  return mensajes;
}

export function iniciarMonitoreo(studentKey, token) {
  detenerMonitoreo(studentKey); // por si ya había uno corriendo, evita duplicados

  const intervalId = setInterval(() => {
    revisarAhora(studentKey, token).catch((err) => {
      // 401/403 significa que la API rechazó el token: ya caducó o ya no es
      // válido. En vez de seguir intentando para siempre, detenemos el
      // monitoreo y dejamos un aviso explicando por qué se detuvo.
      if (err.status === 401 || err.status === 403) {
        detenerMonitoreo(studentKey);
        addNotification(studentKey, "Tu sesión expiró. El monitoreo automático se detuvo — vuelve a iniciar sesión para reactivarlo.");
      } else {
        console.error(`[monitoreo] error revisando a ${studentKey}:`, err.message);
      }
    });
  }, config.monitorIntervalMs);

  monitoreosActivos.set(studentKey, intervalId);
}

export function detenerMonitoreo(studentKey) {
  const intervalId = monitoreosActivos.get(studentKey);
  if (intervalId) {
    clearInterval(intervalId);
    monitoreosActivos.delete(studentKey);
  }
}

export function estaMonitoreando(studentKey) {
  return monitoreosActivos.has(studentKey);
}