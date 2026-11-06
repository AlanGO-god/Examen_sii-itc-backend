# SII ITC — Backend

Backend intermediario entre el frontend y la API institucional del SII ITC
(`https://sii.celaya.tecnm.mx/api`), para el Examen 3 de Consumo de API y
Desarrollo de Interfaz Web.

Repositorio del frontend: <LINK-A-TU-REPO-FRONTEND>

## ¿Por qué Node.js + Express?

El backend aquí es principalmente un **intermediario**: recibe las peticiones
del frontend, las reenvía a la API institucional con el token correspondiente,
y añade la lógica propia (el sistema de notificaciones). Para ese trabajo no
se necesita un framework grande — Express da justo lo necesario (rutas,
middlewares) con una curva de aprendizaje mínima, y comparte lenguaje
(JavaScript) con el frontend en Vue, lo que simplifica el desarrollo al ser
un solo desarrollador.

## Arquitectura

Frontend (Vue 3) → Backend local (Express, este repo) → API SII ITC


- La API del SII ITC es la única fuente de verdad para autenticación y datos
  académicos.
- Este backend no duplica esos datos de forma permanente — solo guarda
  *snapshots* temporales (`data.json`) para poder detectar cambios entre
  revisiones (ver la sección de Notificaciones).

## Endpoints

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/api/login` | Reenvía credenciales a la API del SII, regresa el JWT | — |
| GET | `/api/estudiante` | Perfil del estudiante | Bearer |
| GET | `/api/estudiante/calificaciones` | Calificaciones por periodo | Bearer |
| GET | `/api/estudiante/kardex` | Historial académico completo | Bearer |
| GET | `/api/estudiante/horarios` | Horario del periodo actual | Bearer |
| GET | `/api/notificaciones` | Lista de notificaciones + estado del monitoreo | Bearer |
| POST | `/api/notificaciones/revisar` | Revisión manual de cambios | Bearer |
| POST | `/api/notificaciones/monitoreo/iniciar` | Activa el sondeo automático | Bearer |
| POST | `/api/notificaciones/monitoreo/detener` | Detiene el sondeo automático | Bearer |
| POST | `/api/notificaciones/leidas` | Marca todas las notificaciones como leídas | Bearer |

## Funcionalidad extra: notificaciones de cambios

Un estudiante normalmente tiene que entrar manualmente a revisar si ya le
subieron una calificación o le cambiaron de aula. Esta función resuelve eso:

- Cada revisión compara las calificaciones y el horario actuales contra el
  último snapshot guardado, y genera una notificación por cada diferencia
  real (nueva calificación capturada, calificación corregida, cambio de
  horario o salón, materia nueva).
- El estudiante puede revisar manualmente ("Revisar ahora") o activar un
  sondeo automático cada 2 minutos (`MONITOR_INTERVAL_MS` en `.env`).
- El monitoreo vive en memoria del proceso, asociado al estudiante (vía el
  `sub` de su JWT, estable entre logins) — **no se guarda la contraseña en
  ningún lado**. Cuando el token expira, el siguiente intento automático lo
  detecta, detiene el monitoreo y deja una notificación explicando que hay
  que volver a iniciar sesión.

## Instalación y ejecución

```bash
npm install
cp .env.example .env
npm run dev
```

Corre en `http://localhost:4000`. Verifica con `curl http://localhost:4000/health`.

### Variables de entorno (`.env`)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto donde corre el servidor (default 4000) |
| `SII_API_BASE_URL` | Base de la API institucional |
| `CORS_ORIGIN` | Origen permitido para CORS (la URL del frontend en desarrollo) |
| `MONITOR_INTERVAL_MS` | Cada cuánto se revisa automáticamente, en milisegundos |

## Capturas de pantalla

<!-- TODO: agregar capturas del login, dashboard, calificaciones, kardex, horario y la campanita de notificaciones antes de entregar -->