// Las fechas de los horarios son "de pared" (la hora que ve el estudiante en
// Celaya), así que todo se compara en la zona horaria de México, no en la del
// servidor (Render suele correr en UTC).
const ZONA = "America/Mexico_City";

export function hoyISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: ZONA }); // YYYY-MM-DD
}

export function horaActual() {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: ZONA,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }); // HH:MM
}

export function esFechaValida(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  // ida y vuelta: descarta fechas imposibles como 2026-02-31
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

export function esHoraValida(hora) {
  return typeof hora === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(hora);
}

// ¿Ese horario (fecha + hora de inicio) ya empezó o ya pasó?
export function yaPaso(fecha, horaInicio) {
  const hoy = hoyISO();
  if (fecha < hoy) return true;
  return fecha === hoy && horaInicio.slice(0, 5) <= horaActual();
}

// ¿El rango [aInicio, aFin) se traslapa con [bInicio, bFin)? Se asume que
// ambos ya son del mismo día; la comparación por fecha va aparte.
export function seTraslapan(aInicio, aFin, bInicio, bFin) {
  const a1 = aInicio.slice(0, 5);
  const a2 = aFin.slice(0, 5);
  const b1 = bInicio.slice(0, 5);
  const b2 = bFin.slice(0, 5);
  return a1 < b2 && b1 < a2;
}
