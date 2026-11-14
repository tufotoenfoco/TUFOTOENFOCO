export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        service: "TuFotoEnFoco",
        worker: "active"
      });
    }

    if (url.pathname === "/api/datos") {
      const assetUrl = new URL("/datos.json", request.url);
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));

      if (!response.ok) {
        return Response.json(
          { error: "No se pudieron cargar los datos" },
          { status: 500 }
        );
      }

      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Endpoint no encontrado" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
