import { siiClient } from "./siiClient.js";
import { config } from "../config.js";

export async function materiasElegibles(token) {
  const respuesta = await siiClient.getKardex(token);
  const kardex = respuesta?.data?.kardex ?? [];

  const mejores = new Map();

  for (const materia of kardex) {
    const calificacion = Number(materia.calificacion);
    if (Number.isNaN(calificacion)) continue;

    const actual = mejores.get(materia.clave_materia);
    if (!actual || calificacion > actual.calificacion) {
      mejores.set(materia.clave_materia, {
        clave_materia: materia.clave_materia,
        nombre_materia: materia.nombre_materia,
        calificacion,
      });
    }
  }

  return Array.from(mejores.values()).filter(
    (m) => m.calificacion >= config.tutorCalificacionMinima
  );
}