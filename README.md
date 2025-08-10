# Caja de Ahorro

Sitio estático para la administración de la caja de ahorro del grupo. Incluye autenticación y gestión de usuarios, pagos y egresos utilizando Firebase como backend.

## Requisitos

- Navegador moderno con soporte para módulos ES.
- Cuenta de Firebase con Firestore y Authentication habilitados.

## Configuración

1. Copia el archivo `js/firebase.js` y reemplaza la configuración por las credenciales de tu proyecto de Firebase.
2. Servir los archivos en cualquier hosting estático o mediante GitHub Pages.

## Desarrollo local

Puedes utilizar un servidor estático simple como [serve](https://www.npmjs.com/package/serve).

```bash
npx serve .
```

## Estructura del proyecto

- `index.html`: Página principal y contenedor de la aplicación.
- `js/`: Código JavaScript modular para la lógica de la aplicación.
- `assets/`: Recursos estáticos como imágenes.

## Contribuir

1. Realiza un fork del repositorio.
2. Crea un branch con tu funcionalidad o corrección.
3. Envía un Pull Request describiendo los cambios realizados.

## Licencia

Este proyecto se distribuye bajo la Licencia MIT.
