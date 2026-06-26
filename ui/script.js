// ─── State ─────────────────────────────────────────────────────────
let appState = "idle";            // "idle" | "calibration" | "calibration_form" | "digitization"
let sourceImage = null;           // HTMLImageElement
let calibClicks = [];             // [{x, y}, ...] image-space coords
let calib = { a: 0, b: 0, c: 0, d: 0, valid: false };
let points = [];                  // [{x_img, y_img, x_real, y_real}, ...]

const T = { scale: 1.0, offsetX: 0.0, offsetY: 0.0 };

// Pan state
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffsetStart = { x: 0, y: 0 };

// ─── DOM Elements ──────────────────────────────────────────────────
const canvas = document.getElementById("plotCanvas");
const ctx = canvas.getContext("2d");
const magnifier = document.getElementById("magnifier");
const magCtx = magnifier.getContext("2d");
const statusBar = document.getElementById("statusBar");
const calibForm = document.getElementById("calibForm");
const confirmCalibBtn = document.getElementById("confirmCalibBtn");
const resetPointsBtn = document.getElementById("resetPointsBtn");
const formError = document.getElementById("formError");

// ─── Bridge Setup ──────────────────────────────────────────────────
window.pybridge = null;
window.addEventListener("load", function () {
    if (typeof QWebChannel !== "undefined" && typeof qt !== "undefined") {
        new QWebChannel(qt.webChannelTransport, function (channel) {
            window.pybridge = channel.objects.bridge;
        });
    }
});

// ─── Coordinate Conversion ─────────────────────────────────────────
function displayToImage(dx, dy) {
    return {
        x: (dx - T.offsetX) / T.scale,
        y: (dy - T.offsetY) / T.scale
    };
}

function imageToDisplay(ix, iy) {
    return {
        x: ix * T.scale + T.offsetX,
        y: iy * T.scale + T.offsetY
    };
}

// ─── Canvas Sizing ──────────────────────────────────────────────────
function resizeCanvas() {
    const container = document.getElementById("canvasContainer");
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    redraw();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ─── Redraw ─────────────────────────────────────────────────────────
function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!sourceImage) return;

    // Draw image
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
        sourceImage,
        T.offsetX, T.offsetY,
        sourceImage.width * T.scale,
        sourceImage.height * T.scale
    );
    ctx.restore();

    // Draw calibration crosshairs (blue)
    for (let i = 0; i < calibClicks.length; i++) {
        const dp = imageToDisplay(calibClicks[i].x, calibClicks[i].y);
        drawCrosshair(dp.x, dp.y, "#89b4fa", 12);
    }

    // Draw digitised points (red dots)
    for (let i = 0; i < points.length; i++) {
        const dp = imageToDisplay(points[i].x_img, points[i].y_img);
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#f38ba8";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawCrosshair(x, y, color, size) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
}

// ─── Status Update ──────────────────────────────────────────────────
function updateStatus() {
    switch (appState) {
        case "idle":
            statusBar.textContent = "No image loaded";
            break;
        case "calibration":
            statusBar.textContent = `Calibration Mode \u2014 click point ${calibClicks.length + 1} of 4`;
            break;
        case "calibration_form":
            statusBar.textContent = "Enter axis values and confirm";
            break;
        case "digitization":
            statusBar.textContent = `Digitization Mode \u2014 ${points.length} points recorded`;
            break;
    }
}

// ─── receiveImage (called from Python) ──────────────────────────────
function receiveImage(dataUrl) {
    const img = new Image();
    img.onload = function () {
        sourceImage = img;
        appState = "calibration";
        calibClicks = [];
        points = [];
        calib = { a: 0, b: 0, c: 0, d: 0, valid: false };

        // Fit image in canvas
        const scaleX = canvas.width / img.width;
        const scaleY = canvas.height / img.height;
        T.scale = Math.min(scaleX, scaleY) * 0.9;
        T.offsetX = (canvas.width - img.width * T.scale) / 2;
        T.offsetY = (canvas.height - img.height * T.scale) / 2;

        resetPointsBtn.style.display = "none";
        updateStatus();
        redraw();
    };
    img.src = dataUrl;
}

// ─── resetDigitizer (called from Python) ────────────────────────────
function resetDigitizer() {
    appState = "idle";
    sourceImage = null;
    calibClicks = [];
    calib = { a: 0, b: 0, c: 0, d: 0, valid: false };
    points = [];
    T.scale = 1.0;
    T.offsetX = 0.0;
    T.offsetY = 0.0;

    calibForm.style.display = "none";
    formError.style.display = "none";
    resetPointsBtn.style.display = "none";
    magnifier.style.display = "none";

    document.getElementById("formXmin").value = "";
    document.getElementById("formXmax").value = "";
    document.getElementById("formYmin").value = "";
    document.getElementById("formYmax").value = "";

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateStatus();
}

// ─── exportData (called from Python) ────────────────────────────────
function exportData() {
    if (!calib.valid) {
        if (window.pybridge) {
            window.pybridge.saveData(JSON.stringify({ error: "not_calibrated" }));
        }
        return;
    }
    if (points.length === 0) {
        if (window.pybridge) {
            window.pybridge.saveData(JSON.stringify({ error: "empty" }));
        }
        return;
    }
    const out = {
        x: points.map(p => parseFloat(p.x_real.toFixed(6))),
        y: points.map(p => parseFloat(p.y_real.toFixed(6)))
    };
    if (window.pybridge) {
        window.pybridge.saveData(JSON.stringify(out));
    }
}

// ─── Mouse Events ───────────────────────────────────────────────────
canvas.addEventListener("mousedown", function (e) {
    // Right or middle click → start panning
    if (e.button === 1 || e.button === 2) {
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        panOffsetStart = { x: T.offsetX, y: T.offsetY };
        e.preventDefault();
        return;
    }

    // Left click
    if (e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const img = displayToImage(dx, dy);

        if (appState === "calibration") {
            calibClicks.push({ x: img.x, y: img.y });
            redraw();

            if (calibClicks.length >= 4) {
                appState = "calibration_form";
                calibForm.style.display = "block";
                document.getElementById("formXmin").focus();
            }
            updateStatus();
        } else if (appState === "digitization") {
            const xReal = calib.a * img.x + calib.b;
            const yReal = calib.c * img.y + calib.d;
            points.push({ x_img: img.x, y_img: img.y, x_real: xReal, y_real: yReal });
            redraw();
            updateStatus();
        } else if (appState === "idle" && sourceImage === null) {
            // No image, ignore
        }
    }
});

canvas.addEventListener("mousemove", function (e) {
    if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        T.offsetX = panOffsetStart.x + dx;
        T.offsetY = panOffsetStart.y + dy;
        redraw();
        return;
    }

    // Magnifier
    if (sourceImage) {
        magnifier.style.display = "block";

        // Position magnifier
        let mx = e.clientX + 20;
        let my = e.clientY + 20;
        if (mx + 150 > window.innerWidth) mx = e.clientX - 170;
        if (my + 150 > window.innerHeight) my = e.clientY - 170;
        if (mx < 0) mx = 0;
        if (my < 0) my = 0;
        magnifier.style.left = mx + "px";
        magnifier.style.top = my + "px";

        // Draw magnified region
        const rect = canvas.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const imgCoord = displayToImage(dx, dy);

        const regionSize = 75; // image pixels to sample (75×75)
        const halfRegion = regionSize / 2;

        magCtx.clearRect(0, 0, 150, 150);
        magCtx.imageSmoothingEnabled = false;

        // Source rect in image space
        const sx = imgCoord.x - halfRegion;
        const sy = imgCoord.y - halfRegion;

        magCtx.drawImage(
            sourceImage,
            sx, sy, regionSize, regionSize,
            0, 0, 150, 150
        );

        // Draw crosshair at center of magnifier
        magCtx.strokeStyle = "#f38ba8";
        magCtx.lineWidth = 1;
        magCtx.beginPath();
        magCtx.moveTo(75, 65);
        magCtx.lineTo(75, 85);
        magCtx.stroke();
        magCtx.beginPath();
        magCtx.moveTo(65, 75);
        magCtx.lineTo(85, 75);
        magCtx.stroke();
    }
});

canvas.addEventListener("mouseup", function (e) {
    if (e.button === 1 || e.button === 2) {
        isPanning = false;
    }
});

canvas.addEventListener("mouseleave", function () {
    magnifier.style.display = "none";
    isPanning = false;
});

// Prevent context menu on canvas
canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
});

// ─── Mouse Wheel → Zoom ────────────────────────────────────────────
canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    if (!sourceImage) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.1, Math.min(20.0, T.scale * zoomFactor));

    // Zoom toward cursor
    const ratio = newScale / T.scale;
    T.offsetX = mx - ratio * (mx - T.offsetX);
    T.offsetY = my - ratio * (my - T.offsetY);
    T.scale = newScale;

    redraw();
}, { passive: false });

// ─── Keyboard Shortcuts ─────────────────────────────────────────────
document.addEventListener("keydown", function (e) {
    // Ctrl+Z → undo
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        if (appState === "digitization" && points.length > 0) {
            points.pop();
            redraw();
            updateStatus();
        }
        e.preventDefault();
    }
});

// ─── Calibration Form ───────────────────────────────────────────────
confirmCalibBtn.addEventListener("click", function () {
    const xminVal = parseFloat(document.getElementById("formXmin").value);
    const xmaxVal = parseFloat(document.getElementById("formXmax").value);
    const yminVal = parseFloat(document.getElementById("formYmin").value);
    const ymaxVal = parseFloat(document.getElementById("formYmax").value);

    if (!isFinite(xminVal) || !isFinite(xmaxVal) || !isFinite(yminVal) || !isFinite(ymaxVal)) {
        formError.textContent = "All four values must be valid finite numbers.";
        formError.style.display = "block";
        return;
    }

    formError.style.display = "none";

    // Pixel coords (image space)
    const x1 = calibClicks[0].x;  // X_min pixel
    const x2 = calibClicks[1].x;  // X_max pixel
    const y3 = calibClicks[2].y;  // Y_min pixel (lower on image → higher y value)
    const y4 = calibClicks[3].y;  // Y_max pixel (upper on image → lower y value)

    // Linear mapping coefficients
    const a = (xmaxVal - xminVal) / (x2 - x1);
    const b = xminVal - a * x1;

    const c = (ymaxVal - yminVal) / (y4 - y3);
    const d = ymaxVal - c * y4;

    calib = { a, b, c, d, valid: true };

    calibForm.style.display = "none";
    appState = "digitization";
    resetPointsBtn.style.display = "block";
    updateStatus();
    redraw();
});

// ─── Reset Points Button ────────────────────────────────────────────
resetPointsBtn.addEventListener("click", function () {
    points = [];
    redraw();
    updateStatus();
});
