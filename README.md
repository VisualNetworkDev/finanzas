# Payment Organizer

Repositorio web consolidado de Payment Organizer. GitHub Pages publica tres entradas que comparten una sola configuración de API:

- `/payment-organizer-finanzas/`: sitio público, registro, inicio de sesión, descargas y documentos legales.
- `/payment-organizer-finanzas/portal/`: portal autenticado de usuarios.
- `/payment-organizer-finanzas/admin/`: panel administrativo autenticado, sin enlaces desde la página pública y con `noindex,nofollow`.

El backend de Google Apps Script y la aplicación Flutter se conservan localmente bajo `_private/`, que está excluido de Git. La web nunca recibe pagos, balances, deudas, notas ni recordatorios financieros personales; esos datos permanecen en el dispositivo.

## Desarrollo y comprobación

```powershell
node --test tests\*.test.cjs
```

La URL pública de Apps Script se define una sola vez en `shared/config.js`. No deben publicarse propiedades de Apps Script, contraseñas, hashes administrativos, identificadores de hojas, tokens, códigos ni notas internas.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Despliegue](docs/DEPLOYMENT.md)
- [Backend](docs/BACKEND.md)
- [Flujo Premium](docs/PREMIUM_FLOW.md)
- [Catálogo Premium](docs/PREMIUM_FEATURES.md)
- [Guía administrativa](docs/ADMIN_GUIDE.md)
- [Pruebas](docs/TESTING.md)

Los textos de privacidad y términos son borradores técnicos y requieren revisión final del propietario y asesoría legal antes de un lanzamiento comercial.
