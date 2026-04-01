const express = require("express");
const cors = require("cors");
const path = require("path");
const api = require("./routes/api");

const app = express();

// ✅ FIX: use dynamic port
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/api", api);

// Serve downloads folder
app.use("/downloads", express.static(path.join(__dirname, "downloads")));

// SPA fallback
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
app.listen(PORT, () => {
    console.log(`⚡ MediaFlow running → http://localhost:${PORT}`);
});