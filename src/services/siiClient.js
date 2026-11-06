import axios from "axios";
import { config } from "../config.js";

const sii = axios.create({
  baseURL: config.siiBaseUrl,
  timeout: 10000,
});

async function call(method, url, { token, data } = {}) {
  try {
    const response = await sii.request({
      method,
      url,
      data,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return response.data;
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const message = err.response.data?.message || "Error en la API del SII";
      const wrapped = new Error(message);
      wrapped.status = status;
      throw wrapped;
    }
    const wrapped = new Error("No se pudo contactar al servidor del SII ITC");
    wrapped.status = 502;
    throw wrapped;
  }
}

export const siiClient = {
  login: (email, password) => call("post", "/login", { data: { email, password } }),
  getEstudiante: (token) => call("get", "/movil/estudiante", { token }),
  getCalificaciones: (token) => call("get", "/movil/estudiante/calificaciones", { token }),
  getKardex: (token) => call("get", "/movil/estudiante/kardex", { token }),
  getHorarios: (token) => call("get", "/movil/estudiante/horarios", { token }),
};