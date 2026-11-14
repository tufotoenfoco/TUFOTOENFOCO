
(() => {
  'use strict';
  const CACHE_NAME = 'tufotoenfoco-datos-v1';
  const MAX_AGE_MS = 30 * 1000;

  async function guardar(cache, url, response) {
    const text = await response.clone().text();
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('X-TFE-Cached-At', String(Date.now()));
    await cache.put(url, new Response(text, {
      status: 200,
      headers
    }));
    return JSON.parse(text);
  }

  async function descargar(url, cache) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo descargar datos.json (${response.status})`);
    const data = await guardar(cache, url, response);
    if (!data || typeof data !== 'object' || !Array.isArray(data.galerias) || !data.gestionWeb) {
      await cache.delete(url);
      throw new Error('El contenido descargado de datos.json no tiene el formato esperado');
    }
    return data;
  }

  async function get(url) {
    if (!('caches' in window)) {
      const response = await fetch(url, { cache: 'default' });
      if (!response.ok) throw new Error(`No se pudo descargar datos.json (${response.status})`);
      return response.json();
    }

    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);

    if (!cached) return descargar(url, cache);

    let cachedData;
    try {
      cachedData = await cached.clone().json();
      if (!cachedData || typeof cachedData !== 'object' || !Array.isArray(cachedData.galerias) || !cachedData.gestionWeb) {
        throw new Error('Caché no válida');
      }
    } catch (_) {
      await cache.delete(url);
      return descargar(url, cache);
    }

    const savedAt = Number(cached.headers.get('X-TFE-Cached-At') || 0);
    if (Date.now() - savedAt > MAX_AGE_MS) {
      try {
        return await descargar(url, cache);
      } catch (error) {
        console.warn('No se pudo actualizar datos.json; se utilizará la última copia válida:', error);
      }
    }
    return cachedData;
  }

  window.TFEDataCache = Object.freeze({ get });
})();
