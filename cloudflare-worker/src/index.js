const B2_ORIGIN = "https://f003.backblazeb2.com";
const BUCKET_PREFIX = "/file/tufotoenfocogaleria/";
const CACHE_SECONDS = 60 * 60 * 24 * 30; // 30 días en caché compartida

function error(message, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return error("Método no permitido", 405);
    }

    // Este Worker solo puede servir objetos del bucket esperado; no es un proxy abierto.
    if (!incoming.pathname.startsWith(BUCKET_PREFIX)) {
      return error("Ruta no permitida", 404);
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(incoming.pathname);
    } catch {
      return error("Ruta no válida", 400);
    }
    if (decodedPath.includes("\\") || decodedPath.includes("\0") || decodedPath.split("/").some(part => part === "..")) {
      return error("Ruta no válida", 400);
    }

    const origin = new URL(B2_ORIGIN);
    origin.pathname = incoming.pathname;
    origin.search = incoming.search;

    const headers = new Headers();
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) headers.set("If-None-Match", ifNoneMatch);
    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) headers.set("If-Modified-Since", ifModifiedSince);

    let upstream;
    let current = origin;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
      try {
        upstream = await fetch(current.toString(), {
          method: request.method,
          headers,
          redirect: "manual",
        });
      } catch {
        return error("No se pudo conectar con el almacenamiento", 502);
      }
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      if (redirectCount === 3) return error("Demasiadas redirecciones del almacenamiento", 502);
      const location = upstream.headers.get("Location");
      if (!location) return error("Redirección inválida del almacenamiento", 502);
      const target = new URL(location, current);
      if (target.protocol !== "https:" || target.hostname !== "f003.backblazeb2.com" || !target.pathname.startsWith(BUCKET_PREFIX)) {
        return error("Destino de redirección no permitido", 502);
      }
      current = target;
    }

    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      return error(upstream.status === 404 ? "Fotografía no encontrada" : "Error al recuperar la fotografía", upstream.status);
    }

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.delete("Set-Cookie");

    // No cachear respuestas parciales, errores ni validaciones condicionales.
    if (upstream.status === 200 && !range) {
      responseHeaders.set(
        "Cache-Control",
        `public, max-age=86400, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`
      );
    } else {
      responseHeaders.set("Cache-Control", "no-store");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
