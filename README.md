# Prono 7 días (web app)

Pronóstico de vuelo en parapente para 6 lugares de Córdoba y San Luis, a 7 días. Corre en el navegador y no necesita servidor. Usa la API gratuita de Open-Meteo.

## Archivos
- `index.html`: la página.
- `styles.css`: el diseño.
- `config.js`: lugares, niveles de viento, techo mínimo, pesos y umbrales. **Es el archivo que se edita.**
- `app.js`: los cálculos y la pantalla.

## Publicar gratis en GitHub Pages
1. En github.com, crear un repositorio nuevo, por ejemplo `prono-termico` (público).
2. Elegir **Add file → Upload files** y subir los 4 archivos (sin carpetas).
3. Ir a **Settings → Pages**. En *Branch* elegir `main` y la carpeta `/ (root)`, y tocar **Save**.
4. En uno o dos minutos la app queda en `https://TU-USUARIO.github.io/prono-termico/`.
5. En Chrome del celular, menú → **Agregar a pantalla principal** para abrirla como una app.

## Ajustes
Todo se cambia en `config.js`: direcciones útiles, velocidades máximas (km/h), techo mínimo (hPa), pesos del % y umbrales. Si cambiás las coordenadas, los niveles de viento o los modelos, la app descarga los datos de nuevo sola.
