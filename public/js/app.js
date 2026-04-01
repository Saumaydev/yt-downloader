/* ═══════════════════════════════════════════════
   3D PARTICLE SPHERE
   ═══════════════════════════════════════════════ */
class Sphere {
    constructor(canvas) {
        this.c = canvas;
        this.ctx = canvas.getContext("2d");
        this.pts = [];
        this.N = 180;
        this.R = Math.min(window.innerWidth, window.innerHeight) * 0.3;
        this.maxR = 280;
        if (this.R > this.maxR) this.R = this.maxR;
        this.rotX = 0;
        this.rotY = 0;
        this.mouse = { x: null, y: null };

        this.resize();
        this.generate();
        this.loop();

        window.addEventListener("resize", () => this.resize());
        window.addEventListener("mousemove", (e) => {
            this.mouse.x = (e.clientX / this.c.width - 0.5) * 2;
            this.mouse.y = (e.clientY / this.c.height - 0.5) * 2;
        });
    }

    resize() {
        this.c.width = window.innerWidth;
        this.c.height = window.innerHeight;
        this.cx = this.c.width / 2;
        this.cy = this.c.height / 2;
        this.R = Math.min(window.innerWidth, window.innerHeight) * 0.3;
        if (this.R > this.maxR) this.R = this.maxR;
    }

    generate() {
        // Fibonacci sphere — even distribution
        const phi = (1 + Math.sqrt(5)) / 2;
        for (let i = 0; i < this.N; i++) {
            const theta = Math.acos(1 - (2 * (i + 0.5)) / this.N);
            const angle = (2 * Math.PI * i) / phi;
            this.pts.push({
                ox: Math.sin(theta) * Math.cos(angle),
                oy: Math.sin(theta) * Math.sin(angle),
                oz: Math.cos(theta),
            });
        }
    }

    rotate(x, y, z) {
        // Y rotation
        let cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);
        let x1 = x * cy - z * sy;
        let z1 = x * sy + z * cy;

        // X rotation
        let cx = Math.cos(this.rotX), sx = Math.sin(this.rotX);
        let y1 = y * cx - z1 * sx;
        let z2 = y * sx + z1 * cx;

        return { x: x1, y: y1, z: z2 };
    }

    project(x, y, z) {
        const persp = 500;
        const s = persp / (persp + z * this.R);
        return {
            x: this.cx + x * this.R * s,
            y: this.cy + y * this.R * s,
            s,
            z,
        };
    }

    loop() {
        this.ctx.clearRect(0, 0, this.c.width, this.c.height);

        // Slow auto rotation + subtle mouse influence
        this.rotY += 0.002;
        this.rotX += 0.0008;

        if (this.mouse.x !== null) {
            this.rotY += this.mouse.x * 0.0003;
            this.rotX += this.mouse.y * 0.0003;
        }

        // Transform all points
        const proj = this.pts.map((p) => {
            const r = this.rotate(p.ox, p.oy, p.oz);
            return this.project(r.x, r.y, r.z);
        });

        // Draw connections
        const connDist = 85;
        for (let i = 0; i < proj.length; i++) {
            for (let j = i + 1; j < proj.length; j++) {
                const dx = proj[i].x - proj[j].x;
                const dy = proj[i].y - proj[j].y;
                const d = dx * dx + dy * dy;
                if (d < connDist * connDist) {
                    const dist = Math.sqrt(d);
                    const alpha = (1 - dist / connDist) * 0.08 *
                        Math.min(proj[i].s, proj[j].s);
                    this.ctx.beginPath();
                    this.ctx.moveTo(proj[i].x, proj[i].y);
                    this.ctx.lineTo(proj[j].x, proj[j].y);
                    this.ctx.strokeStyle = `rgba(139,92,246,${alpha})`;
                    this.ctx.lineWidth = 0.5;
                    this.ctx.stroke();
                }
            }
        }

        // Draw points — back to front
        proj.sort((a, b) => a.z - b.z);
        proj.forEach((p) => {
            const depth = (p.z + 1) / 2; // 0 (far) to 1 (near)
            const alpha = depth * 0.5 + 0.08;
            const size = p.s * 1.8;

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            this.ctx.fill();

            // Subtle glow on front particles
            if (depth > 0.7) {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(139,92,246,${(depth - 0.7) * 0.08})`;
                this.ctx.fill();
            }
        });

        requestAnimationFrame(() => this.loop());
    }
}

/* ═══════════════════════════════════════════════
   APP
   ═══════════════════════════════════════════════ */
const $ = (s) => document.querySelector(s);
const state = { url: "", info: null, dlId: null, poll: null };

const el = {
    url: $("#url"),
    clear: $("#clearBtn"),
    fetch: $("#fetchBtn"),
    err: $("#err"),
    s1: $("#s1"),
    s2: $("#s2"),
    s3: $("#s3"),
    thumb: $("#thumb"),
    dur: $("#dur"),
    title: $("#title"),
    meta: $("#meta"),
    grid: $("#fmtGrid"),
    back: $("#backBtn"),
    progCard: $("#progCard"),
    doneCard: $("#doneCard"),
    progStatus: $("#progStatus"),
    progSub: $("#progSub"),
    progPct: $("#progPct"),
    bar: $("#barFill"),
    pSpeed: $("#pSpeed"),
    pEta: $("#pEta"),
    pSize: $("#pSize"),
    save: $("#saveBtn"),
    doneName: $("#doneName"),
    newBtn: $("#newBtn"),
};

// ── Helpers ──
function fmtBytes(b) {
    if (!b) return "—";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, v = b;
    while (v >= 1024 && i < 3) { v /= 1024; i++; }
    return v.toFixed(1) + " " + u[i];
}

function fmtViews(n) {
    if (!n) return "";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M views";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K views";
    return n + " views";
}

function show(section) {
    [el.s1, el.s2, el.s3].forEach((s) => s.classList.remove("active"));
    section.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function showErr(msg) {
    el.err.textContent = msg;
    el.err.classList.add("show");
    setTimeout(() => el.err.classList.remove("show"), 5000);
}

function isValid(u) {
    return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/.test(u);
}

// ── Events ──
el.url.addEventListener("input", () => {
    const v = el.url.value.trim();
    el.clear.classList.toggle("show", v.length > 0);
    el.fetch.disabled = !isValid(v);
    el.err.classList.remove("show");
});

el.url.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !el.fetch.disabled) el.fetch.click();
});

el.url.addEventListener("paste", () => {
    setTimeout(() => {
        el.url.dispatchEvent(new Event("input"));
        if (!el.fetch.disabled) setTimeout(() => el.fetch.click(), 400);
    }, 100);
});

el.clear.addEventListener("click", () => {
    el.url.value = "";
    el.url.focus();
    el.clear.classList.remove("show");
    el.fetch.disabled = true;
});

el.fetch.addEventListener("click", fetchInfo);
el.back.addEventListener("click", () => { show(el.s1); el.url.focus(); });
el.newBtn.addEventListener("click", () => {
    if (state.poll) clearInterval(state.poll);
    el.url.value = "";
    el.fetch.disabled = true;
    el.clear.classList.remove("show");
    show(el.s1);
    el.url.focus();
});

// ── Fetch Info ──
async function fetchInfo() {
    const url = el.url.value.trim();
    if (!url) return;
    state.url = url;

    el.fetch.classList.add("loading");
    el.fetch.disabled = true;
    el.err.classList.remove("show");

    try {
        const res = await fetch("/api/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });

        if (!res.ok) {
            const e = await res.json();
            throw new Error(e.error || "Fetch failed");
        }

        const data = await res.json();
        state.info = data;
        renderInfo(data);
        show(el.s2);
    } catch (e) {
        showErr(e.message);
    } finally {
        el.fetch.classList.remove("loading");
        el.fetch.disabled = !isValid(el.url.value.trim());
    }
}

// ── Render Info ──
function renderInfo(d) {
    el.thumb.src = d.thumb || "";
    el.dur.textContent = d.duration || "";
    el.title.textContent = d.title || "Untitled";

    let metaParts = [];
    if (d.channel) metaParts.push(d.channel);
    if (d.views) metaParts.push(fmtViews(d.views));
    el.meta.textContent = metaParts.join(" · ");

    el.grid.innerHTML = "";

    if (!d.presets || d.presets.length === 0) {
        const card = mkFmt({ type: "video", label: "Best", ext: "mp4", size: 0 }, true);
        el.grid.appendChild(card);
        return;
    }

    d.presets.forEach((p, i) => {
        el.grid.appendChild(mkFmt(p, i === 0));
    });
}

function mkFmt(p, first) {
    const div = document.createElement("div");
    div.className = "fmt" + (p.type === "audio" ? " audio" : "");

    let tag = "";
    if (first && p.type === "video") {
        tag = '<span class="fmt-tag tag-best">BEST</span>';
    } else if (p.height >= 720 && p.type === "video") {
        tag = '<span class="fmt-tag tag-hd">HD</span>';
    }

    const icon = p.type === "audio" ? "♫" : "▶";
    const detail = p.type === "audio"
        ? p.ext.toUpperCase()
        : `${p.ext.toUpperCase()}${p.fps ? " · " + p.fps + "fps" : ""}`;

    div.innerHTML = `
        ${tag}
        <div class="fmt-name">${icon} ${p.label}</div>
        <div class="fmt-detail">${detail} ${p.size ? "· " + fmtBytes(p.size) : ""}</div>
    `;

    div.addEventListener("click", () => startDL(p));
    return div;
}

// ── Start Download ──
async function startDL(preset) {
    show(el.s3);

    el.progCard.style.display = "block";
    el.doneCard.classList.add("hide");
    el.bar.style.width = "0%";
    el.progPct.textContent = "0%";
    el.progStatus.textContent = "Starting...";
    el.progSub.textContent = preset.label + " · " + preset.ext.toUpperCase();
    el.pSpeed.textContent = "—";
    el.pEta.textContent = "—";
    el.pSize.textContent = "—";

    try {
        const res = await fetch("/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: state.url, preset }),
        });

        if (!res.ok) throw new Error((await res.json()).error || "Failed");

        const data = await res.json();
        state.dlId = data.id;
        pollProgress();
    } catch (e) {
        showErr("Download failed: " + e.message);
        show(el.s2);
    }
}

// ── Poll Progress ──
function pollProgress() {
    if (state.poll) clearInterval(state.poll);

    state.poll = setInterval(async () => {
        try {
            const res = await fetch(`/api/progress/${state.dlId}`);
            if (!res.ok) return;
            const d = await res.json();
            updateProg(d);

            if (d.status === "complete") {
                clearInterval(state.poll);
                showDone(d);
            } else if (d.status === "error") {
                clearInterval(state.poll);
                showErr(d.error || "Download failed");
                show(el.s2);
            }
        } catch (e) { /* retry next tick */ }
    }, 400);
}

function updateProg(d) {
    const pct = Math.round(d.progress || 0);
    el.bar.style.width = pct + "%";
    el.progPct.textContent = pct + "%";

    const labels = {
        downloading: "Downloading...",
        processing: "Processing...",
        starting: "Starting...",
    };
    el.progStatus.textContent = labels[d.status] || d.status;
    el.pSpeed.textContent = d.speed || "—";
    el.pEta.textContent = d.eta || "—";
    el.pSize.textContent = d.totalSize || "—";
}

function showDone(d) {
    el.progCard.style.display = "none";
    el.doneCard.classList.remove("hide");

    const name = d.filename || "file";
    el.doneName.textContent = name;
    el.save.href = `/api/file/${encodeURIComponent(name)}`;
    el.save.download = name;
}

/* ═══════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
    new Sphere(document.getElementById("sphere"));
    show(el.s1);
    setTimeout(() => el.url.focus(), 300);
});