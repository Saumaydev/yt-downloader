const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// ✅ NEW (cross-platform)
const ytdlp = require("yt-dlp-exec");
const ffmpegPath = require("ffmpeg-static");

// Downloads folder
const DOWNLOADS = path.join(__dirname, "..", "downloads");
if (!fs.existsSync(DOWNLOADS)) fs.mkdirSync(DOWNLOADS, { recursive: true });

// Active downloads
const active = new Map();

// MIME types
const MIMES = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
};

// ── GET VIDEO INFO ──
router.post("/info", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });

    try {
        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCheckCertificates: true,
        });

        const videos = [];
        const audios = [];

        (info.formats || []).forEach((f) => {
            const entry = {
                id: f.format_id,
                ext: f.ext,
                w: f.width,
                h: f.height,
                size: f.filesize || f.filesize_approx || 0,
            };
            if (f.vcodec !== "none") videos.push(entry);
            else if (f.acodec !== "none") audios.push(entry);
        });

        const presets = [
            { label: "1080p", h: 1080 },
            { label: "720p", h: 720 },
            { label: "480p", h: 480 },
            { label: "360p", h: 360 },
        ]
        .map(r => {
            const match = videos.find(v => v.h === r.h);
            if (!match) return null;
            return {
                type: "video",
                label: r.label,
                formatId: match.id,
                ext: "mp4",
            };
        })
        .filter(Boolean);

        // Audio presets
        presets.push({
            type: "audio",
            label: "MP3",
            ext: "mp3",
        });

        res.json({
            title: info.title,
            thumb: info.thumbnail,
            duration: info.duration,
            presets,
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch info" });
    }
});

// ── START DOWNLOAD ──
router.post("/download", async (req, res) => {
    const { url, preset } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });

    const id = uuidv4().slice(0, 8);
    const output = path.join(DOWNLOADS, `${id}.%(ext)s`);

    active.set(id, { progress: 0, status: "starting" });

    try {
        let options = {
            output,
            noWarnings: true,
            noCheckCertificates: true,
        };

        if (preset?.type === "audio") {
            options.extractAudio = true;
            options.audioFormat = preset.ext;
        } else {
            options.format = preset?.formatId
                ? `${preset.formatId}+bestaudio/best`
                : "best";
            options.mergeOutputFormat = "mp4";
        }

        await ytdlp(url, options);

        // Find file
        const files = fs.readdirSync(DOWNLOADS).filter(f => f.startsWith(id));
        const filename = files[0];

        active.set(id, {
            progress: 100,
            status: "complete",
            filename,
        });

        res.json({ id });

    } catch (err) {
        console.error(err);
        active.set(id, { status: "error" });
        res.status(500).json({ error: "Download failed" });
    }
});

// ── PROGRESS ──
router.get("/progress/:id", (req, res) => {
    const data = active.get(req.params.id);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
});

// ── SERVE FILE ──
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