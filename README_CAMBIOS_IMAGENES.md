# TuFotoEnFoco — integración de imágenes unificada

Este paquete conserva GitHub Pages como alojamiento principal y mantiene el Worker existente:
`https://tufotoenfoco-galeria.tufotoenfoco.workers.dev/`

## Qué se ha cambiado
Se han unificado las funciones `urlImagenGaleria` y `urlDescargaFoto` en:
- index.html
- album.html
- categoria.html
- galerias.html
- cultura.html
- sin-balon.html

La visualización envía al Worker únicamente URLs de Backblaze B2 (`f003.backblazeb2.com` o subdominios `*.backblazeb2.com`) y archivos servidos por el propio Worker bajo `/file/tufotoenfocogaleria/`. Las URLs externas ajenas se dejan intactas. La marca de agua se solicita solo cuando el evento la tiene activada.

Las descargas mantienen el comportamiento previo: se envían al Worker con `download=1`, y `watermark=1` cuando el evento tiene marca de agua.

## Qué NO se ha cambiado
- GitHub Pages y la estructura de publicación.
- `datos.json`, `assets/` y el resto de páginas.
- Google Apps Script y el formulario de contacto.
- Backblaze B2.
- El Worker existente y su URL.
- Los parámetros de las peticiones (`url64`, `watermark`, `download`).

## Publicación
Descomprime el ZIP y sube el contenido de la carpeta `web/` a la misma ubicación desde la que GitHub Pages publica actualmente el sitio (en tu caso, la carpeta `TUFOTOENFOCO` de la rama `main`, según la URL compartida). No subas una carpeta `web` anidada dentro del repositorio si actualmente `index.html` está en la raíz de publicación.

Haz primero una copia/commit de seguridad. Después prueba una galería con marca de agua activada, otra sin marca de agua y una descarga.

Este paquete no despliega ni modifica Cloudflare; solo actualiza el código del sitio.
