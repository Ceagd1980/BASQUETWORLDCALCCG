# Radar Básquet Mundial

Web de básquet multiliga con datos de AnnaBet.com: se elige la liga en el menú y aparecen sus
partidos por fecha (◀ ▶ saltan entre fechas con partidos), con buscador de equipos.
Por partido: posición, % de victorias, tabla general + casa (local) / fuera (visita),
1X2 (general y LL/VV), totales (cruzado y suma de anotados, con marcador posible) y spread A/B.

## Estructura
- `public/index.html` — la página
- `netlify/functions/basket.mjs` — lee AnnaBet:
  - `/api/basket?league=serie_20_Euroleague` posiciones y partidos de una liga
  - `/api/basket?part=leagues` lista de ligas
  - `/api/basket?debug=1&league=serie_20_Euroleague` diagnóstico
- `netlify.toml` — configuración de Netlify (no cambiar)

## Publicar
1. Repositorio nuevo en GitHub: arrastrar las carpetas `public` y `netlify` más
   `netlify.toml`, `package.json` y `README.md`.
2. Netlify → Add new site → Import from GitHub → Deploy.
