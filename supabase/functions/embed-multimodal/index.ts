const rawAllowed = Deno.env.get("ALLOWED_ORIGINS") ?? "alba://";
const allowedOrigins = new Set(rawAllowed.split(",").map((o: string) => o.trim()));

function corsHeaders(origin: string | null) {
  const allowed = !origin || allowedOrigins.has(origin) ? (origin ?? "*") : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

async function getGcpAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const headerB64 = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadB64 = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyBuffer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${signingInput}.${sigB64}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) {
    throw new Error(`GCP auth failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const { text, imageUrl } = await req.json();

    if (!text && !imageUrl) {
      return new Response(JSON.stringify({ error: "text or imageUrl required" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const saJson = Deno.env.get("VERTEX_SA_JSON");
    const projectId = Deno.env.get("VERTEX_PROJECT_ID");

    if (!saJson || !projectId) {
      console.error("[embed-multimodal] VERTEX_SA_JSON or VERTEX_PROJECT_ID not configured.");
      return new Response(JSON.stringify({ error: "Not configured" }), {
        status: 503,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getGcpAccessToken(saJson);

    const instance: Record<string, unknown> = {};
    if (text) instance.text = String(text).trim().slice(0, 500);

    if (imageUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const imgResp = await fetch(imageUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (imgResp.ok) {
          const contentLength = imgResp.headers.get("content-length");
          // Skip images larger than 8MB to avoid memory issues
          if (!contentLength || parseInt(contentLength) <= 8 * 1024 * 1024) {
            const imgBuffer = await imgResp.arrayBuffer();
            const bytes = new Uint8Array(imgBuffer);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const b64 = btoa(binary);
            const contentType = imgResp.headers.get("content-type") || "image/jpeg";
            instance.image = {
              bytesBase64Encoded: b64,
              mimeType: contentType.split(";")[0].trim(),
            };
          }
        }
      } catch {
        // Image fetch failed — continue with text-only embedding
      }
    }

    const vertexResp = await fetch(
      `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/multimodalembedding@001:predict`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instances: [instance] }),
      },
    );

    if (!vertexResp.ok) {
      const err = await vertexResp.text();
      console.error("[embed-multimodal] Vertex AI error:", vertexResp.status, err);

      // If the image was invalid but we also have text, retry with text only
      if (instance.image && instance.text) {
        const retryResp = await fetch(
          `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/multimodalembedding@001:predict`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ instances: [{ text: instance.text }] }),
          },
        );
        if (retryResp.ok) {
          const retryData = await retryResp.json();
          const embedding: number[] = retryData.predictions?.[0]?.textEmbedding ?? [];
          if (embedding.length) {
            return new Response(JSON.stringify({ embedding }), {
              headers: { ...headers, "Content-Type": "application/json" },
            });
          }
        }
      }

      return new Response(JSON.stringify({ error: "Embedding failed" }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const vertexData = await vertexResp.json();
    const prediction = vertexData.predictions?.[0];

    if (!prediction) {
      return new Response(JSON.stringify({ error: "No prediction returned" }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const textEmb: number[] | undefined = prediction.textEmbedding;
    const imageEmb: number[] | undefined = prediction.imageEmbedding;

    let embedding: number[];
    if (textEmb && imageEmb) {
      // Average text and image embeddings so both modalities contribute
      embedding = textEmb.map((v, i) => (v + imageEmb[i]) / 2);
    } else {
      embedding = textEmb ?? imageEmb ?? [];
    }

    if (!embedding.length) {
      return new Response(JSON.stringify({ error: "Empty embedding returned" }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ embedding }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[embed-multimodal] error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
