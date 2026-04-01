const express = require("express");
const router = express.Router();
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const BIN = path.join(__dirname, "..", "bin");
const YTDLP = path.join(BIN, "yt-dlp.exe");
const FFPROBE = path.join(BIN, "ffprobe.exe");
const DOWNLOADS = path.join(__dirname, "..", "downloads");

// Ensure downloads folder exists
if (!fs.existsSync(DOWNLOADS)) fs.mkdirSync(DOWNLOADS, { recursive: true });

const active = new Map();

// ── MIME types for proper playback ──
const MIMES = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".aac": "audio/aac",
};

// ── GET VIDEO INFO ──
router.post("/info", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });

    const args = [
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        url,
    ];

    execFile(YTDLP, args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
        if (err) {
            console.error("yt-dlp info error:", stderr || err.message);
            return res.status(500).json({ error: "Failed to fetch info", details: stderr });
        }

        try {
            const info = JSON.parse(stdout);
            const videos = [];
            const audios = [];

            (info.formats || []).forEach((f) => {
                const entry = {
                    id: f.format_id,
                    ext: f.ext,
                    w: f.width,
                    h: f.height,
                    fps: f.fps,
                    vcodec: f.vcodec,
                    acodec: f.acodec,
                    size: f.filesize || f.filesize_approx || 0,
                    tbr: f.tbr,
                    note: f.format_note || "",
                };
                if (f.vcodec && f.vcodec !== "none") videos.push(entry);
                else if (f.acodec && f.acodec !== "none") audios.push(entry);
            });

            // Build presets
            const presets = [];
            const resMap = [
                { label: "4K", h: 2160 },
                { label: "1440p", h: 1440 },
                { label: "1080p", h: 1080 },
                { label: "720p", h: 720 },
                { label: "480p", h: 480 },
                { label: "360p", h: 360 },
            ];

            resMap.forEach((r) => {
                // Prefer mp4 codec for speed (no transcode needed)
                const match =
                    videos.find((v) => v.h === r.h && v.ext === "mp4") ||
                    videos.find((v) => v.h === r.h);
                if (match) {
                    presets.push({
                        type: "video",
                        label: r.label,
                        height: r.h,
                        formatId: match.id,
                        ext: "mp4",
                        size: match.size,
                        fps: match.fps,
                    });
                }
            });

            // Audio presets
            if (audios.length > 0) {
                presets.push({
                    type: "audio",
                    label: "MP3 Audio",
                    formatId: null,
                    ext: "mp3",
                    size: audios[0].size,
                    quality: "best",
                });
                presets.push({
                    type: "audio",
                    label: "M4A Audio",
                    formatId: null,
                    ext: "m4a",
                    size: audios[0].size,
                    quality: "best",
                });
            }

            res.json({
                title: info.title,
                thumb: info.thumbnail,
                duration: info.duration_string || "",
                channel: info.channel || info.uploader || "",
                views: info.view_count || 0,
                presets,
            });
        } catch (e) {
            console.error("Parse error:", e);
            res.status(500).json({ error: "Failed to parse info" });
        }
    });
});

// ── START DOWNLOAD ──
router.post("/download", (req, res) => {
    const { url, preset } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });

    const id = uuidv4().slice(0, 8);
    const outTemplate = path.join(DOWNLOADS, `${id}_%(title).80s.%(ext)s`);

    let args = [
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--newline",
        "--ffmpeg-location", BIN,
        "-o", outTemplate,
    ];

    if (preset?.type === "audio") {
        if (preset.ext === "m4a") {
            // ── M4A: download best m4a directly, NO transcode = FAST ──
            args.push(
                "-f", "bestaudio[ext=m4a]/bestaudio",
                "--remux-video", "m4a"
            );
        } else {
            // ── MP3: extract and convert ──
            args.push(
                "-f", "bestaudio[ext=m4a]/bestaudio",
                "-x",
                "--audio-format", "mp3",
                "--audio-quality", "192K"
            );
        }
    } else {
        // ── VIDEO: prefer mp4+m4a to avoid transcoding (just mux) ──
        if (preset?.formatId) {
            args.push(
                "-f", `${preset.formatId}+bestaudio[ext=m4a]/` +
                      `${preset.formatId}+bestaudio/best`,
                "--merge-output-format", "mp4"
            );
        } else {
            args.push(
                "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
                "--merge-output-format", "mp4"
            );
        }
    }

    args.push(url);

    // Speed optimization flags
    args.splice(1, 0,
        "--concurrent-fragments", "4",
        "--buffer-size", "16K"
    );

    active.set(id, {
        progress: 0,
        status: "starting",
        speed: "",
        eta: "",
        totalSize: "",
        filename: "",
        error: null,
    });

    const proc = spawn(YTDLP, args);

    proc.stdout.on("data", (data) => {
        const lines = data.toString().split("\n");
        lines.forEach((line) => {
            // Progress: [download]  45.2% of  125.30MiB at  4.52MiB/s ETA 00:15
            const m = line.match(
                /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\S+)\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/
            );
            if (m) {
                active.set(id, {
                    ...active.get(id),
                    progress: parseFloat(m[1]),
                    status: "downloading",
                    totalSize: m[2],
                    speed: m[3],
                    eta: m[4],
                });
            }

            // Already downloaded
            if (line.includes("has already been downloaded")) {
                active.set(id, {
                    ...active.get(id),
                    progress: 100,
                    status: "processing",
                });
            }

            // Merging/Converting
            if (
                line.includes("[Merger]") ||
                line.includes("[ExtractAudio]") ||
                line.includes("[FFmpegExtractAudio]") ||
                line.includes("Post-process")
            ) {
                active.set(id, {
                    ...active.get(id),
                    progress: 99,
                    status: "processing",
                    speed: "",
                    eta: "",
                });
            }
        });
    });

    proc.stderr.on("data", (data) => {
        const msg = data.toString();
        console.error("yt-dlp stderr:", msg);
        // Don't treat warnings as fatal errors
    });

    proc.on("close", (code) => {
        // Find the output file
        const files = fs.readdirSync(DOWNLOADS)
            .filter((f) => f.startsWith(id))
            .map((f) => ({
                name: f,
                time: fs.statSync(path.join(DOWNLOADS, f)).mtimeMs,
            }))
            .sort((a, b) => b.time - a.time);

        if (code === 0 && files.length > 0) {
            const filename = files[0].name;
            const filepath = path.join(DOWNLOADS, filename);
            const stat = fs.statSync(filepath);

            active.set(id, {
                progress: 100,
                status: "complete",
                speed: "",
                eta: "",
                totalSize: formatBytesServer(stat.size),
                filename,
                error: null,
            });

            // Cleanup after 30 min
            setTimeout(() => {
                try {
                    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                } catch (e) {}
                active.delete(id);
            }, 30 * 60 * 1000);
        } else {
            active.set(id, {
                ...active.get(id),
                status: "error",
                error: `Download failed (code ${code}). Check URL and try again.`,
            });
        }
    });

    res.json({ id });
});

// ── PROGRESS ──
router.get("/progress/:id", (req, res) => {
    const data = active.get(req.params.id);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
});

// ── SERVE FILE (fixed headers for audio playback) ──
router.get("/file/:filename", (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const filepath = path.join(DOWNLOADS, filename);

    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: "File not found" });
    }

    const stat = fs.statSync(filepath);
    const ext = path.extname(filename).toLowerCase();
    const mime = MIMES[ext] || "application/octet-stream";

    // Support range requests (needed for audio/video playback)
    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
            "Content-Type": mime,
        });

        fs.createReadStream(filepath, { start, end }).pipe(res);
    } else {
        res.writeHead(200, {
            "Content-Length": stat.size,
            "Content-Type": mime,
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        });

        fs.createReadStream(filepath).pipe(res);
    }
});

// ── PROBE ──
router.post("/probe", (req, res) => {
    const filepath = path.join(DOWNLOADS, req.body.filename || "");
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Not found" });

    execFile(
        FFPROBE,
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filepath],
        (err, stdout) => {
            if (err) return res.status(500).json({ error: "Probe failed" });
            res.json(JSON.parse(stdout));
        }
    );
});

function formatBytesServer(bytes) {
    if (!bytes) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + " " + u[i];
}

module.exports = router;