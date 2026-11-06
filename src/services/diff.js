// Compara dos snapshots de /calificaciones (ambos son el arreglo real que
// regresa la API: periodos -> materias -> calificaiones[]).
// Regresa un arreglo de mensajes legibles, uno por cada cambio detectado.
export function diffCalificaciones(anterior, actual) {
  if (!anterior) return []; // primera vez que se revisa: no hay nada que comparar todavía

  const mensajes = [];

  for (const periodoActual of actual) {
    const periodoAnterior = anterior.find(
      (p) => p.periodo.clave_periodo === periodoActual.periodo.clave_periodo
    );
    if (!periodoAnterior) continue; // periodo nuevo completo; no es un "cambio" que avisar

    for (const materiaActual of periodoActual.materias) {
      const materiaAnterior = periodoAnterior.materias.find(
        (m) => m.materia.clave_materia === materiaActual.materia.clave_materia
      );
      if (!materiaAnterior) continue;

      for (const calActual of materiaActual.calificaiones) {
        const calAnterior = materiaAnterior.calificaiones.find(
          (c) => c.numero_calificacion === calActual.numero_calificacion
        );
        if (!calAnterior) continue;

        const antes = calAnterior.calificacion;
        const despues = calActual.calificacion;

        if (antes !== despues) {
          mensajes.push(
            `${materiaActual.materia.nombre_materia}: parcial ${calActual.numero_calificacion} ` +
              (antes === null ? `se capturó: ${despues}` : `cambió de ${antes} a ${despues}`)
          );
        }
      }
    }
  }

  return mensajes;
}

// Compara dos snapshots de /horarios (arreglo de periodos -> horario[]).
export function diffHorarios(anterior, actual) {
  if (!anterior) return [];

  const mensajes = [];
  const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

  for (const periodoActual of actual) {
    const periodoAnterior = anterior.find(
      (p) => p.periodo.clave_periodo === periodoActual.periodo.clave_periodo
    );
    if (!periodoAnterior) continue;

    for (const claseActual of periodoActual.horario) {
      const claseAnterior = periodoAnterior.horario.find((c) => c.id_grupo === claseActual.id_grupo);
      if (!claseAnterior) {
        mensajes.push(`Nueva clase agregada a tu horario: ${claseActual.nombre_materia}`);
        continue;
      }

      for (const dia of DIAS) {
        const salonCampo = `${dia}_clave_salon`;
        if (claseAnterior[dia] !== claseActual[dia] || claseAnterior[salonCampo] !== claseActual[salonCampo]) {
          mensajes.push(
            `${claseActual.nombre_materia}: cambió el horario del ${dia} (antes "${claseAnterior[dia] ?? "sin clase"}" en "${claseAnterior[salonCampo] ?? "—"}", ahora "${claseActual[dia] ?? "sin clase"}" en "${claseActual[salonCampo] ?? "—"}")`
          );
        }
      }
    }
  }

  return mensajes;
}