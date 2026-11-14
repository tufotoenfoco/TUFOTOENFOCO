const B2_HOST = "f003.backblazeb2.com";
const WORKER_HOST = "tufotoenfoco-galeria.tufotoenfoco.workers.dev";
const BUCKET = "tufotoenfocogaleria";
const PREFIX = `/file/${BUCKET}/`;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // Cloudflare Images binding limit
const CACHE_SECONDS = 86400;

function text(message, status = 400) {
  return new Response(message, { status, headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*"
  }});
}
function decodeUrl64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function validB2Path(path) {
  if (!path.startsWith(PREFIX)) return false;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  return !decoded.includes("\\") && !decoded.includes("\0") &&
    !decoded.split("/").some(part => part === "." || part === "..");
}
function isPrivateOrInvalidHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")) return true;
  return false;
}
function contentTypeFormat(type) {
  const t = String(type || "").toLowerCase().split(";")[0].trim();
  if (["image/jpeg", "image/png", "image/webp", "image/avif"].includes(t)) return t;
  // Cloudflare Images output supports the common web formats. Other inputs are
  // converted to JPEG when a watermark is requested.
  return "image/jpeg";
}
function extensionFor(type) {
  return ({"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/avif":"avif"})[type] || "jpg";
}

async function proxyB2(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return text("Método no permitido",405);
  if (!validB2Path(url.pathname)) return text("Ruta de imagen no permitida",404);
  const target = new URL(`https://${B2_HOST}${url.pathname}${url.search}`);
  const headers = new Headers({"Accept-Encoding":"identity"});
  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);
  let upstream;
  try { upstream = await fetch(target, { method: request.method, headers, redirect:"follow" }); }
  catch { return text("No se pudo conectar con Backblaze",502); }
  if (!upstream.ok && upstream.status !== 206) {
    return text(upstream.status === 404 ? "Fotografía no encontrada" : "Error al recuperar la fotografía", upstream.status >= 400 ? upstream.status : 502);
  }
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("Access-Control-Allow-Origin","*");
  responseHeaders.set("X-Content-Type-Options","nosniff");
  responseHeaders.set("Cache-Control", range ? "no-store" : `public, max-age=3600, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`);
  responseHeaders.set("X-TFE-Image-Source","cloudflare-worker-b2");
  responseHeaders.delete("Set-Cookie");
  return new Response(request.method === "HEAD" ? null : upstream.body, {status:upstream.status, headers:responseHeaders});
}

async function getSource(source, requestUrl, externalMode) {
  let parsed;
  try { parsed = new URL(source); } catch { throw new Error("URL no válida"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    throw new Error("Origen de imagen no permitido");
  }
  if (parsed.hostname === B2_HOST && validB2Path(parsed.pathname)) {
    parsed = new URL(`https://${WORKER_HOST}${parsed.pathname}${parsed.search}`);
  }
  if (parsed.hostname === WORKER_HOST) {
    if (!validB2Path(parsed.pathname)) throw new Error("Ruta de imagen no permitida");
  } else {
    if (!externalMode || isPrivateOrInvalidHost(parsed.hostname)) throw new Error("Origen de imagen no permitido");
  }
  let current = parsed;
  for (let i=0; i<=3; i++) {
    let response;
    try { response = await fetch(current, {redirect:"manual"}); }
    catch { throw new Error("No se pudo descargar la imagen original"); }
    if ([301,302,303,307,308].includes(response.status)) {
      if (i===3) throw new Error("Demasiadas redirecciones");
      const location=response.headers.get("Location");
      if (!location) throw new Error("Redirección sin destino");
      const next=new URL(location,current);
      if (next.protocol !== "https:" || next.username || next.password || isPrivateOrInvalidHost(next.hostname)) throw new Error("Destino de imagen no permitido");
      if (next.hostname===B2_HOST && validB2Path(next.pathname)) {
        current=new URL(`https://${WORKER_HOST}${next.pathname}${next.search}`);
      } else if (next.hostname===WORKER_HOST && validB2Path(next.pathname)) current=next;
      else if (externalMode) current=next;
      else throw new Error("Destino de imagen no permitido");
      continue;
    }
    if (!response.ok) throw new Error("No se pudo obtener la imagen original");
    const type=(response.headers.get("content-type")||"").toLowerCase();
    if (!type.startsWith("image/")) throw new Error("El recurso no es una imagen");
    const declared=Number(response.headers.get("content-length")||0);
    if (declared>MAX_IMAGE_BYTES) throw new Error("Imagen superior al límite de 20 MB de Cloudflare Images");
    const bytes=await response.arrayBuffer();
    if (bytes.byteLength>MAX_IMAGE_BYTES) throw new Error("Imagen superior al límite de 20 MB de Cloudflare Images");
    return {bytes, type};
  }
  throw new Error("No se pudo descargar la imagen original");
}

async function imageEndpoint(request, env, url, externalMode) {
  if (request.method !== "GET" && request.method !== "HEAD") return text("Método no permitido",405);
  const encoded=url.searchParams.get("url64");
  let source=url.searchParams.get("url");
  try { if (encoded) source=decodeUrl64(encoded); } catch { return text("URL codificada no válida"); }
  const watermark=url.searchParams.get("watermark")==="1";
  const download=url.searchParams.get("download")==="1";
  if (!source || (!watermark && !download)) return text("Falta url o una operación válida");
  try {
    const {bytes,type}=await getSource(source,url,externalMode);
    if (download && !watermark) {
      return new Response(request.method==="HEAD"?null:bytes,{status:200,headers:{
        "Content-Type":type,"Content-Disposition":"attachment; filename=\"fotografia-original\"",
        "Cache-Control":"no-store","Access-Control-Allow-Origin":"*","X-Content-Type-Options":"nosniff"
      }});
    }
    if (!watermark) return new Response(request.method==="HEAD"?null:bytes,{headers:{"Content-Type":type,"Cache-Control":`public, max-age=${CACHE_SECONDS}`,"Access-Control-Allow-Origin":"*"}});
    if (!env.IMAGES) return text("Falta activar el binding IMAGES en Cloudflare",503);
    const info=await env.IMAGES.info(new Response(bytes).body);
    if (!info || !info.width || !info.height) return text("Formato de imagen no compatible",415);
    const logoResponse=await env.ASSETS.fetch(new Request(new URL("/watermark.png",url.origin)));
    if (!logoResponse.ok) return text("No se encuentra el logotipo de marca de agua",500);
    const logoBytes=await logoResponse.arrayBuffer();
    const logoWidth=Math.max(1,Math.round(info.width*0.70));
    const outputType=contentTypeFormat(type);
    const transform=env.IMAGES.input(new Response(bytes).body)
      .draw(env.IMAGES.input(new Response(logoBytes).body).transform({width:logoWidth}),{opacity:0.30});
    const response=await transform.output({format:outputType,quality:outputType==="image/jpeg"?92:90,anim:false}).response({headers:{
      "Cache-Control":download?"no-store":`public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
      "Access-Control-Allow-Origin":"*","X-Content-Type-Options":"nosniff",
      ...(download?{"Content-Disposition":`attachment; filename=\"fotografia-con-marca-de-agua.${extensionFor(outputType)}\"`}:{})
    }});
    if (request.method==="HEAD") return new Response(null,{status:response.status,headers:response.headers});
    return response;
  } catch (error) {
    return text(error?.message || "Error procesando la imagen",500);
  }
}

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if (request.method==="OPTIONS") return new Response(null,{status:204,headers:{
      "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type, Range","Access-Control-Max-Age":"86400"
    }});
    if (url.pathname==="/" || url.pathname==="/health") return new Response("TUFOTOENFOCO Cloudflare Worker OK",{headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    if (url.pathname.startsWith(PREFIX)) return proxyB2(request,url);
    if (url.pathname==="/imagen") return imageEndpoint(request,env,url,false);
    if (url.pathname==="/imagen-externa") return imageEndpoint(request,env,url,true);
    return text("Ruta no encontrada",404);
  }
};
