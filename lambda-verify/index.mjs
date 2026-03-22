// index.mjs (Node 20, ESM)
import {
  RekognitionClient,
  DetectFacesCommand,
  CompareFacesCommand,
} from "@aws-sdk/client-rekognition";

const client = new RekognitionClient({ region: process.env.REKOGNITION_REGION ?? process.env.AWS_REGION });

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

// ── Quality gate ─────────────────────────────────────────────────────────────
// Returns a rejection reason string, or null if the frame passes.
function qualityRejection(faceDetail) {
  const sharpness  = faceDetail.Quality?.Sharpness  ?? 100;
  const brightness = faceDetail.Quality?.Brightness ?? 50;
  const eyesOpen   = faceDetail.EyesOpen?.Value;
  const eyeConf    = faceDetail.EyesOpen?.Confidence ?? 0;

  // Photos of screens / printed photos commonly fail sharpness due to Moiré or texture
  if (sharpness < 35)                         return "low_sharpness";
  // Overexposed (screen glare) or near-black (phone hidden) images
  if (brightness < 15 || brightness > 92)    return "bad_lighting";
  // Printed photos with open-eyes can still pass, but clearly-closed eyes won't
  if (eyesOpen === false && eyeConf > 85)    return "eyes_closed";

  return null;
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

    const { userId, selfieBase64, selfie2Base64, profileBase64 } = body;
    if (!userId || !selfieBase64 || !profileBase64) {
      return resp(400, { error: "Missing parameters" });
    }

    const selfieBytes   = Buffer.from(stripDataUrl(selfieBase64),  "base64");
    const profileBytes  = Buffer.from(stripDataUrl(profileBase64), "base64");
    const selfie2Bytes  = selfie2Base64
      ? Buffer.from(stripDataUrl(selfie2Base64), "base64")
      : null;

    log("payload sizes", {
      selfieLen:  selfieBytes.length,
      selfie2Len: selfie2Bytes?.length ?? 0,
      profileLen: profileBytes.length,
      tookMs: Date.now() - started,
    });

    // ── Frame 1: DetectFaces with full attributes ─────────────────────────────
    log("detectFaces frame1 begin");
    const detect1 = await client.send(
      new DetectFacesCommand({
        Image: { Bytes: selfieBytes },
        Attributes: ["ALL"],
      })
    );

    const faces1 = detect1?.FaceDetails?.length || 0;
    log("detectFaces frame1 done", { faces: faces1, tookMs: Date.now() - started });

    if (!faces1) return resp(200, { faceDetected: false, match: false });

    // ── Anti-spoofing check 1: multiple faces ─────────────────────────────────
    if (faces1 > 1) {
      log("rejected: multiple faces detected", faces1);
      return resp(200, { faceDetected: false, match: false, reason: "multiple_faces" });
    }

    // ── Anti-spoofing check 2: quality gate on frame 1 ────────────────────────
    const qReject1 = qualityRejection(detect1.FaceDetails[0]);
    if (qReject1) {
      log("rejected: quality gate frame1", qReject1);
      return resp(200, { faceDetected: false, match: false, reason: qReject1 });
    }

    const yaw1 = detect1.FaceDetails[0]?.Pose?.Yaw ?? null;

    // ── Frame 2: pose liveness check (if provided) ────────────────────────────
    if (selfie2Bytes) {
      log("detectFaces frame2 begin");
      const detect2 = await client.send(
        new DetectFacesCommand({
          Image: { Bytes: selfie2Bytes },
          Attributes: ["ALL"],
        })
      );

      const faces2 = detect2?.FaceDetails?.length || 0;
      log("detectFaces frame2 done", { faces: faces2, tookMs: Date.now() - started });

      if (!faces2) {
        // Frame 2 lost the face — fall through to single-frame comparison
        log("frame2: no face, skipping pose check");
      } else {
        // ── Anti-spoofing check 3: pose difference between frames ─────────────
        const qReject2 = qualityRejection(detect2.FaceDetails[0]);
        const yaw2 = detect2.FaceDetails[0]?.Pose?.Yaw ?? null;

        log("pose check", { yaw1, yaw2, diff: yaw1 !== null && yaw2 !== null ? Math.abs(yaw1 - yaw2) : "n/a" });

        if (!qReject2 && yaw1 !== null && yaw2 !== null) {
          const poseDiff = Math.abs(yaw1 - yaw2);
          if (poseDiff < 1) {
            // Faces in both frames are at nearly identical angles — static image
            log("rejected: pose too similar across frames", { poseDiff });
            return resp(200, { faceDetected: false, match: false, reason: "no_liveness" });
          }
        }

        // ── CompareFaces on frame 2 vs profile ────────────────────────────────
        log("compareFaces frame2 begin");
        const compare2 = await client.send(
          new CompareFacesCommand({
            SourceImage: { Bytes: profileBytes },
            TargetImage: { Bytes: selfie2Bytes },
            SimilarityThreshold: 80,
          })
        );

        const similarity2 = compare2?.FaceMatches?.length
          ? compare2.FaceMatches[0].Similarity
          : 0;

        log("compareFaces frame2 done", { similarity2, tookMs: Date.now() - started });

        // Both frames must independently match the profile photo
        if (similarity2 < 80) {
          log("rejected: frame2 did not match profile", { similarity2 });
          return resp(200, { faceDetected: true, match: false, reason: "frame2_mismatch" });
        }
      }
    }

    // ── CompareFaces: frame 1 vs profile (primary check) ─────────────────────
    log("compareFaces frame1 begin");
    const compare1 = await client.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: profileBytes },
        TargetImage: { Bytes: selfieBytes },
        SimilarityThreshold: 85,
      })
    );

    const similarity = compare1?.FaceMatches?.length
      ? compare1.FaceMatches[0].Similarity
      : 0;

    const match = similarity >= 85;

    log("compareFaces frame1 done", {
      similarity,
      matches: compare1?.FaceMatches?.length || 0,
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
