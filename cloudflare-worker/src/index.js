const B2_ORIGIN = "https://f003.backblazeb2.com";
const B2_HOST = "f003.backblazeb2.com";
const BUCKET_PREFIX = "/file/tufotoenfocogaleria/";
const BROWSER_CACHE_SECONDS = 60 * 60 * 24;       // 1 día en navegador
const EDGE_CACHE_SECONDS = 60 * 60 * 24 * 30;    // 30 días en Cloudflare

function error(message, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function isAllowedObjectPath(pathname) {
  if (!pathname.startsWith(BUCKET_PREFIX)) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return !decoded.includes("\\") &&
    !decoded.includes("\0") &&
    !decoded.split("/").some((part) => part === "..") &&
    !decoded.split("/").some((part) => part === ".");
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return error("Método no permitido", 405);
    }

    // El Worker solo sirve objetos del bucket esperado; no es un proxy abierto.
    if (!isAllowedObjectPath(incoming.pathname)) {
      return error("Ruta no permitida", 404);
    }

    const origin = new URL(B2_ORIGIN);
    origin.pathname = incoming.pathname;
    origin.search = incoming.search;

    // IMPORTANTE: no reenviar Range ni validadores condicionales a B2.
    // Workers Cache almacena la respuesta completa (200) y Cloudflare genera
    // las respuestas 206/416 desde caché para las descargas parciales.
    const upstreamHeaders = new Headers({ "Accept-Encoding": "identity" });

    let upstream;
    let current = origin;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
      try {
        upstream = await fetch(current.toString(), {
          method: request.method,
          headers: upstreamHeaders,
          redirect: "manual",
        });
      } catch {
        return error("No se pudo conectar con el almacenamiento", 502);
      }

      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      if (redirectCount === 3) {
        return error("Demasiadas redirecciones del almacenamiento", 502);
      }

      const location = upstream.headers.get("Location");
      if (!location) return error("Redirección inválida del almacenamiento", 502);

      const target = new URL(location, current);
      if (
        target.protocol !== "https:" ||
        target.hostname !== B2_HOST ||
        !target.pathname.startsWith(BUCKET_PREFIX) ||
        target.username ||
        target.password
      ) {
        return error("Destino de redirección no permitido", 502);
      }
      current = target;
    }

    // Solo cacheamos respuestas completas 200. Los errores nunca se cachean.
    if (!upstream || upstream.status !== 200) {
      const status = upstream?.status || 502;
      return error(
        status === 404 ? "Fotografía no encontrada" : "Error al recuperar la fotografía",
        status >= 400 && status <= 599 ? status : 502,
      );
    }

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("Cache-Control", `public, max-age=${BROWSER_CACHE_SECONDS}, s-maxage=${EDGE_CACHE_SECONDS}, stale-while-revalidate=86400`);
    responseHeaders.set("X-TFE-Image-Source", "cloudflare-worker-b2");
    responseHeaders.delete("Set-Cookie");

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: 200,
      headers: responseHeaders,
    });
  },
};
