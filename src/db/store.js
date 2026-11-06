import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guardamos todo en un archivo JSON plano. No usamos una base de datos de
// verdad (como better-sqlite3) a propósito: ese paquete necesita compilar
// un módulo nativo (make/g++), lo cual puede fallar según la máquina — para
// el volumen de datos de este examen (snapshots + notificaciones de un
// estudiante), un archivo JSON es más que suficiente y no depende de nada.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "..", "..", "data.json");

function load() {
  if (!fs.existsSync(dataPath)) {
    return { snapshots: {}, notifications: [], nextId: 1 };
  }
  return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
}

function save(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

export function getSnapshot(studentKey, kind) {
  const data = load();
  return data.snapshots[studentKey]?.[kind] ?? null;
}

export function saveSnapshot(studentKey, kind, payload) {
  const data = load();
  if (!data.snapshots[studentKey]) data.snapshots[studentKey] = {};
  data.snapshots[studentKey][kind] = payload;
  save(data);
}

export function addNotification(studentKey, message) {
  const data = load();
  data.notifications.push({
    id: data.nextId++,
    student_key: studentKey,
    message,
    created_at: new Date().toISOString(),
    read: false,
  });
  save(data);
}

export function listNotifications(studentKey) {
  const data = load();
  return data.notifications
    .filter((n) => n.student_key === studentKey)
    .sort((a, b) => b.id - a.id)
    .slice(0, 50);
}

export function markAllRead(studentKey) {
  const data = load();
  for (const n of data.notifications) {
    if (n.student_key === studentKey) n.read = true;
  }
  save(data);
}