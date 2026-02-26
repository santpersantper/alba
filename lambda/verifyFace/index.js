import AWS from "aws-sdk";
import express from "express";
import faceRoutes from "./routes/face.js";

const rekognition = new AWS.Rekognition();
const app = express();

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { userId, selfieBase64, profileBase64 } = body;

    if (!userId || !selfieBase64 || !profileBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing parameters" }),
      };
    }

    // Convert Base64 images
    const selfieBytes = Buffer.from(selfieBase64, "base64");
    const profileBytes = Buffer.from(profileBase64, "base64");

    // Step 1 — detect face
    const detect = await rekognition
      .detectFaces({ Image: { Bytes: selfieBytes }, Attributes: ["DEFAULT"] })
      .promise();

    if (!detect.FaceDetails || detect.FaceDetails.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          faceDetected: false,
          match: false,
        }),
      };
    }

    // Step 2 — compare with profile picture
    const compare = await rekognition
      .compareFaces({
        SourceImage: { Bytes: profileBytes }, // profile photo
        TargetImage: { Bytes: selfieBytes },  // selfie
        SimilarityThreshold: 85,
      })
      .promise();

    const match =
      compare.FaceMatches && compare.FaceMatches.length > 0
        ? compare.FaceMatches[0].Similarity
        : 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        faceDetected: true,
        match: match >= 85,
        similarity: match,
      }),
    };
  } catch (e) {
    console.error("Lambda error:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: e.message,
      }),
    };
  }
};

// IMPORTANT: allow big payloads (base64 can be large)
app.use(express.json({ limit: "15mb" }));

app.use("/api/face", faceRoutes);

app.listen(4000, "0.0.0.0", () => {
  console.log("API listening on :4000");
});