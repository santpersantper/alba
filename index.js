// index.js (Backend entry point)
import express from "express";
import pkg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";

const { Pool } = pkg;
const app = express();
const PORT = 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Postgres connection
const pool = new Pool({
  user: "your_db_user",
  host: "localhost",
  database: "alba_db",
  password: "your_db_password",
  port: 5432,
});


function generateToken(userId) {
  return jwt.sign({ id: userId }, "secret_key", { expiresIn: "7d" });
} // JSON web token with signature created for user, sent from now on with every request he makes to the DB

// --- ROUTES --- //

// Signup
app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10); // function stopped until hashing is complete
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [name, email, hashedPassword]
    );
    const token = generateToken(result.rows[0].id);
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (result.rows.length === 0) return res.status(400).json({ success: false, message: "No user" });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(400).json({ success: false, message: "Wrong password" });

    const token = generateToken(user.id);
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Feed
app.get("/feed", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM posts ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Events
app.get("/events", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM events ORDER BY event_date ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Event
app.post("/events", async (req, res) => {
  const { organizer_id, title, description, location, event_date } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO events (organizer_id, title, description, location, event_date) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [organizer_id, title, description, location, event_date]
    );
    res.json({ success: true, event: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// make post
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    const file = req.file;
    const userId = req.user.id; // from decoded token

    // Upload to S3
    const uploadResult = await s3.upload({
      Bucket: "your-bucket-name",
      Key: `${userId}/${Date.now()}-${file.originalname}`,
      Body: file.buffer,
      ContentType: file.mimetype,
    }).promise();

    // Save video URL in DB
    await pool.query(
      "INSERT INTO posts (user_id, video_url) VALUES ($1, $2)",
      [userId, uploadResult.Location]
    );

    res.json({ success: true, url: uploadResult.Location });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


const uploadRouter = require("./routes/upload");

app.use(cors());
app.use(express.json());

app.use("/api", uploadRouter); // <-- mounts /api/upload

app.listen(process.env.PORT || 4000, () => {
  console.log("API running on port", process.env.PORT || 4000);
});


app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
