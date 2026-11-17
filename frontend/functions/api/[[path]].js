
export async function onRequest(context) {
  const { request, env } = context;

  // Validate Cloudflare environment configuration
  if (!env.VETRIAI_BACKEND_URL || !env.VETRIAI_API_KEY) {
    return new Response(
      "VetriAI backend configuration is missing.",
      { status: 503 }
    );
  }

  try {
    const incomingUrl = new URL(request.url);

    // Remove /api prefix before forwarding to FastAPI
    const apiPath = incomingUrl.pathname.replace(/^\/api(?=\/|$)/, "");

    const backendUrl =
      env.VETRIAI_BACKEND_URL.replace(/\/+$/, "") +
      apiPath +
      incomingUrl.search;

    // Copy request headers and add the secret API key
    const headers = new Headers(request.headers);

    headers.delete("host");
    headers.delete("x-vetriai-key");
    headers.set("X-VetRIAI-Key", env.VETRIAI_API_KEY);

    // Forward request, including streaming request bodies
    const response = await fetch(backendUrl, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      redirect: "manual",
    });

    // Preserve the streaming response from VetriAI
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    return new Response(
      "Unable to connect to VetriAI backend.",
      { status: 502 }
    );
  }
}
