// routes/face.js
import express from "express";
import { RekognitionClient, DetectFacesCommand } from "@aws-sdk/client-rekognition";

const router = express.Router();

const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION,
  // Uses default AWS credential chain:
  // - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (and optional AWS_SESSION_TOKEN)
  // - or IAM role (EC2/ECS/Lambda)
});

router.post("/verify", async (req, res) => {
  // keep your existing /verify here (or import it)
  return res.status(501).json({ error: "verify not implemented in this file" });
});

/**
 * POST /api/face/detect-avatar
 * Body: { imageBase64: string }  // base64 WITHOUT data:image/... prefix recommended
 * Returns: { faceDetected: boolean, faceCount: number, confidence?: number }
 */
router.post("/detect-avatar", async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    // Strip possible data URL prefix
    const cleaned = imageBase64.includes("base64,")
      ? imageBase64.split("base64,").pop()
      : imageBase64;

    const bytes = Buffer.from(cleaned, "base64");
    if (!bytes || bytes.length < 50) {
      return res.status(400).json({ error: "Invalid base64 image" });
    }

    const cmd = new DetectFacesCommand({
      Image: { Bytes: bytes },
      Attributes: ["DEFAULT"],
    });

    const out = await rekognition.send(cmd);
    const faces = Array.isArray(out.FaceDetails) ? out.FaceDetails : [];
    const faceCount = faces.length;

    // If there is at least one face, consider it detected.
    // Optionally require a minimum confidence:
    const topConfidence =
      faceCount > 0 ? Number(faces[0]?.Confidence ?? 0) : 0;

    const MIN_CONFIDENCE = Number(process.env.AVATAR_MIN_FACE_CONFIDENCE ?? 80);
    const faceDetected = faceCount > 0 && topConfidence >= MIN_CONFIDENCE;

    return res.json({
      faceDetected,
      faceCount,
      confidence: faceCount > 0 ? topConfidence : undefined,
      minConfidence: MIN_CONFIDENCE,
    });
  } catch (err) {
    console.warn("[detect-avatar] error:", err?.name, err?.message);
    return res.status(500).json({ error: "DetectFaces failed" });
  }
});

export default router;
