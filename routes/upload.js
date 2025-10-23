// routes/upload.js
require("dotenv").config(); // handles environment variables like passwords, credentials, JWT secrets 
const express = require("express"); // talk to DB from JS
const jwt = require("jsonwebtoken"); // token unique to user
const multer = require("multer"); // allows passing data to DB in form form
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto"); // encrypt whatever necessary
const path = require("path"); 

// ── adjust this to PG pool export ───────────────────────────────────────
const pool = require("../db"); // e.g., module exporting a configured pg.Pool
// -----------------------------------------------------------------------------

const router = express.Router(); // container for HTTP endpoints (routes) in Express

// auth --> upload -> route handler -> Response
function auth(req, res, next) { // pass arguments: request, response, next function
  const hdr = req.headers.authorization || "";// request has header to prove user's identity
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null; // token: first 7 digits of header
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET); // verify it's the correct token
    req.user = { id: payload.id };  // request has user with verified id
    next(); // go ahead to "upload"
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

//multer: in-memory storage, video-only filter, size limit
//adjust fileSize if we allow bigger videos

const upload = multer({
  storage: multer.memoryStorage(), // open phone storage
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => { 
    const ok =
      file.mimetype.startsWith("video/") ||
      [".mp4", ".mov", ".m4v", ".webm", ".avi"].includes(
        path.extname(file.originalname || "").toLowerCase()
      ); // check video format
    cb(ok ? null : new Error("Only video uploads are allowed"), ok);
  },
});


const s3 = new S3Client({ // "Client" objects refers to our backend server
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

//make a unique key for uploaded video
function makeKey(userId, originalName = "video.mp4") {
  const ext = path.extname(originalName) || ".mp4";
  const base = crypto.randomBytes(16).toString("hex");
  return `videos/${userId}/${Date.now()}-${base}${ext}`;
}

router.post( 
  "/upload",
  auth,
  upload.single("video"),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const caption = req.body.caption || "";
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "Missing video file field 'video'" });
      }

      // Build S3 object key and put object
      const Key = makeKey(userId, file.originalname);
      const Bucket = process.env.S3_BUCKET;
      const putCmd = new PutObjectCommand({
        Bucket,
        Key,
        Body: file.buffer,
        ContentType: file.mimetype || "video/mp4",
        // NOTE: consider keeping objects private and serving via CloudFront or
        // presigned URLs. Public ACL shown here for simplicity.
        ACL: "public-read",
      });

      await s3.send(putCmd);

      // Public URL (if ACL public-read). If you keep objects private, use
      // a CloudFront URL or generate presigned URL instead.
      const videoUrl = `https://${Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${Key}`;

      // Save metadata in DB (adjust to your schema)
      const insertSql = `
        INSERT INTO posts (user_id, caption, video_url, mime_type)
        VALUES ($1, $2, $3, $4)
        RETURNING id, user_id, caption, video_url, created_at
      `;
      const { rows } = await pool.query(insertSql, [
        userId,
        caption,
        videoUrl,
        file.mimetype || null,
      ]);

      return res.json({
        success: true,
        post: rows[0],
        // Send these back if you want the client to cache or debug
        storage: { bucket: Bucket, key: Key },
      });
    } catch (err) {
      console.error("Upload error:", err);
      const msg =
        err.message && err.message.includes("File too large")
          ? "File too large"
          : err.message || "Upload failed";
      return res.status(500).json({ success: false, error: msg });
    }
  }
);

module.exports = router;
