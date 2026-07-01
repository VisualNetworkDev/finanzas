# Mi Control Financiero

Frontend web personal para administrar balances manuales, pagos, deudas, ingresos, cheques, turnos, alertas, calendario y checklist semanal.

## Stack

- Frontend: GitHub Pages.
- Backend: Google Apps Script.
- Base de datos: Google Sheets.

El backend de Apps Script no se publica en este repositorio. Este repo contiene solo los archivos necesarios para la pagina web.

## Archivos publicados

- `index.html`: pagina principal.
- `styles.css`: diseno responsive.
- `app.js`: logica del frontend y conexion con el web app de Apps Script.

## Uso

1. Publicar este repositorio en GitHub Pages desde la rama `main`.
2. Abrir la URL de GitHub Pages.
3. Iniciar sesion.
4. Cambiar la contrasena temporal en el primer login.
5. Registrar balances reales manualmente.

## Seguridad

- No hay contrasenas guardadas en el frontend.
- El frontend solo guarda el token de sesion local.
- El backend valida sesion antes de leer o modificar datos.
- Los datos financieros viven en Google Sheets, no en GitHub.
