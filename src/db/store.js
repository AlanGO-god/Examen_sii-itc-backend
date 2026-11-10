import { supabase } from "../services/supabaseClient.js";

// Snapshots y notificaciones viven en Supabase (tablas "snapshots" y
// "notificaciones"). Antes eran un data.json en disco, que en Render se
// borra en cada deploy/reinicio.

export async function getSnapshot(studentKey, kind) {
  const { data, error } = await supabase
    .from("snapshots")
    .select("payload")
    .eq("student_key", studentKey)
    .eq("kind", kind)
    .maybeSingle();

  if (error) throw error;
  return data?.payload ?? null;
}

export async function saveSnapshot(studentKey, kind, payload) {
  const { error } = await supabase.from("snapshots").upsert(
    { student_key: studentKey, kind, payload, actualizado_en: new Date().toISOString() },
    { onConflict: "student_key,kind" }
  );
  if (error) throw error;
}

export async function addNotification(studentKey, message, tipo = "general") {
  const { error } = await supabase
    .from("notificaciones")
    .insert({ student_key: studentKey, message, tipo });
  if (error) throw error;
}

// Igual que addNotification, pero nunca lanza: para avisos "secundarios"
// (por ejemplo, avisar al tutor) que no deben tumbar la operación principal.
export async function notificarSeguro(studentKey, message, tipo = "general") {
  try {
    await addNotification(studentKey, message, tipo);
  } catch (err) {
    console.error("[notificaciones] no se pudo guardar:", err.message);
  }
}

export async function listNotifications(studentKey) {
  const { data, error } = await supabase
    .from("notificaciones")
    .select("id, message, tipo, leida, created_at")
    .eq("student_key", studentKey)
    .order("id", { ascending: false })
    .limit(50);

  if (error) throw error;
  // el frontend espera el campo "read"
  return data.map(({ leida, ...resto }) => ({ ...resto, read: leida }));
}

export async function markAllRead(studentKey) {
  const { error } = await supabase
    .from("notificaciones")
    .update({ leida: true })
    .eq("student_key", studentKey)
    .eq("leida", false);
  if (error) throw error;
}
