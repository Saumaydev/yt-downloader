const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { execFile } = require("child_process");

// 📍 Path for yt-dlp (downloaded at runtime)
const YTDLP_PATH = path.join(__dirname, "..", "yt-dlp");

// 📁 Downloads folder
const DOWNLOADS = path.join(__dirname, "..", "downloads");
if (!fs.existsSync(DOWNLOADS)) fs.mkdirSync(DOWNLOADS, { recursive: true });

// 🔄 Active downloads
const active = new Map();

// 🎥 MIME types
const MIMES = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
};

// ─────────────────────────────────────────────
// 🔥 AUTO DOWNLOAD yt-dlp
// ─────────────────────────────────────────────
async function ensureYtDlp() {
    if (!fs.existsSync(YTDLP_PATH)) {
        console.log("Downloading yt-dlp...");

        const response = await axios({
            method: "GET",
            url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
            responseType: "stream",
        });

        const writer = fs.createWriteStream(YTDLP_PATH);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });

        fs.chmodSync(YTDLP_PATH, "755");
        console.log("yt-dlp ready ✅");
    }
}

// ─────────────────────────────────────────────
// 🎬 GET VIDEO INFO
// ─────────────────────────────────────────────
router.post("/info", async (req, res) => {
    try {
        await ensureYtDlp();

        const { url } = req.body;

        execFile(YTDLP_PATH, [
            "--dump-single-json",
            "--no-warnings",
            "--no-check-certificates",
            url
        ], (err, stdout) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: "Failed to fetch info" });
            }

            res.json(JSON.parse(stdout));
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Setup failed" });
    }
});

// ─────────────────────────────────────────────
// 📥 DOWNLOAD VIDEO / AUDIO
// ─────────────────────────────────────────────
router.post("/download", async (req, res) => {
    const { url, preset } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });

    try {
        await ensureYtDlp();

        const id = uuidv4().slice(0, 8);
        const output = path.join(DOWNLOADS, `${id}.%(ext)s`);

        active.set(id, { progress: 0, status: "starting" });

        let args = [
            "--no-playlist",
            "--no-warnings",
            "--no-check-certificates",
            "-o", output,
        ];

        if (preset?.type === "audio") {
            args.push(
                "-x",
                "--audio-format", preset.ext || "mp3"
            );
        } else {
            args.push(
                "-f", preset?.formatId
                    ? `${preset.formatId}+bestaudio/best`
                    : "best",
                "--merge-output-format", "mp4"
            );
        }

        args.push(url);

        execFile(YTDLP_PATH, args, (err) => {
            if (err) {
                console.error(err);
                active.set(id, { status: "error" });
                return res.status(500).json({ error: "Download failed" });
            }

            const files = fs.readdirSync(DOWNLOADS).filter(f => f.startsWith(id));
            const filename = files[0];

            active.set(id, {
                progress: 100,
                status: "complete",
                filename,
            });

            res.json({ id });
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Download setup failed" });
    }
});

// ─────────────────────────────────────────────
// 📊 PROGRESS
// ─────────────────────────────────────────────
router.get("/progress/:id", (req, res) => {
    const data = active.get(req.params.id);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
});

// ─────────────────────────────────────────────
// 📁 SERVE FILE
// ─────────────────────────────────────────────
router.get("/file/:filename", (req, res) => {
    const filepath = path.join(DOWNLOADS, req.params.filename);

    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: "File not found" });
    }

    const ext = path.extname(filepath);
    const mime = MIMES[ext] || "application/octet-stream";

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.filename}"`);

    fs.createReadStream(filepath).pipe(res);
});

module.exports = router;