// index.mjs (Node 20, ESM)
import {
  RekognitionClient,
  DetectFacesCommand,
  CompareFacesCommand,
} from "@aws-sdk/client-rekognition";

const client = new RekognitionClient({ region: process.env.AWS_REGION });

function stripDataUrl(b64 = "") {
  const s = String(b64);
  return s.includes("base64,") ? s.split("base64,").pop() : s;
}

function resp(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type,authorization",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    },
    body: JSON.stringify(bodyObj),
  };
}

export const handler = async (event) => {
  const started = Date.now();
  const log = (...args) => console.log("[verify]", ...args);

  try {
    const method =
      event?.requestContext?.http?.method || event?.httpMethod || "UNKNOWN";
    if (method === "OPTIONS") return resp(200, { ok: true });

    const rawBody = event?.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";

    let body;
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      log("JSON parse error", e?.message);
      return resp(400, { error: "Invalid JSON body" });
    }

    const { userId, selfieBase64, profileBase64 } = body;
    if (!userId || !selfieBase64 || !profileBase64) {
      return resp(400, { error: "Missing parameters" });
    }

    const selfieClean = stripDataUrl(selfieBase64);
    const profileClean = stripDataUrl(profileBase64);

    log("payload sizes", {
      selfieLen: selfieClean.length,
      profileLen: profileClean.length,
      tookMs: Date.now() - started,
    });

    const selfieBytes = Buffer.from(selfieClean, "base64");
    const profileBytes = Buffer.from(profileClean, "base64");

    log("detectFaces begin");
    const detect = await client.send(
      new DetectFacesCommand({
        Image: { Bytes: selfieBytes },
        Attributes: ["DEFAULT"],
      })
    );

    const faces = detect?.FaceDetails?.length || 0;
    log("detectFaces done", { faces, tookMs: Date.now() - started });

    if (!faces) return resp(200, { faceDetected: false, match: false });

    log("compareFaces begin");
    const compare = await client.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: profileBytes },
        TargetImage: { Bytes: selfieBytes },
        SimilarityThreshold: 85,
      })
    );

    const similarity =
      compare?.FaceMatches?.length ? compare.FaceMatches[0].Similarity : 0;

    const match = similarity >= 85;

    log("compareFaces done", {
      similarity,
      matches: compare?.FaceMatches?.length || 0,
      tookMs: Date.now() - started,
    });

    return resp(200, {
      faceDetected: true,
      match,
      similarity,
      tookMs: Date.now() - started,
    });
  } catch (e) {
    console.error("[verify] Lambda error:", e);
    return resp(500, {
      error: "Internal server error",
      message: e?.message || String(e),
      tookMs: Date.now() - started,
    });
  }
};
