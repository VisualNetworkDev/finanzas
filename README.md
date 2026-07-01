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

## Carga inicial real

El backend local de Apps Script incluye `seedUserFinancialData()`.

Para cargar o actualizar los datos iniciales:

1. Abre el proyecto de Apps Script.
2. Ejecuta `setupSpreadsheet()`.
3. Ejecuta `seedUserFinancialData()`.
4. Ejecuta `runFinancialDataTests()` para revisar totales y calculos.
5. Haz redeploy del web app si hiciste cambios de codigo.

La carga inicial crea o actualiza cuentas, balances, ingresos, pagos, deudas, turnos recientes, alertas, checklist y configuracion. Si se corre dos veces, no duplica registros.

El cambio de aceite queda marcado como ya pagado antes; el proximo pago se calcula para dentro de 6 meses y la reserva semanal sugerida es de aproximadamente 3 dolares.

Los balances quedan editables manualmente desde la app.
