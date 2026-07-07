// ==========================================
// CONFIGURATION
// ==========================================
const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxX9VJAIEms8rufpRS7VfCAVeLjvyFn2iVwQDT9IzUR_5yJwMngo67yNYtD5rykVMQ/exec";

// ==========================================
// STATE MANAGEMENT & DOM ELEMENTS
// ==========================================
const views = {
  landing: document.getElementById("view-landing"),
  camera: document.getElementById("view-camera"),
  result: document.getElementById("view-result"),
  gallery: document.getElementById("view-gallery"),
  drive: document.getElementById("view-drive"),
};

const video = document.getElementById("camera-feed");
const videoWrapper = document.getElementById("video-wrapper");
const mainCanvas = document.getElementById("main-canvas");
const ctx = mainCanvas.getContext("2d");
const resultDisplay = document.getElementById("result-display");
const cameraSelect = document.getElementById("camera-select");
const btnStartCapture = document.getElementById("btn-start-capture");
const galleryContainer = document.getElementById("gallery-container");

const shutterSound = new Audio(
  "https://actions.google.com/sounds/v1/ui/camera_shutter.ogg",
);

let videoStream = null;
let currentDeviceId = null;
let selectedTemplate = "SISWA";
let selectedTime = 3;
let capturedPhotos = [];
let lastFolderUrl = "";
let currentSessionId = "";
let currentFolderId = "";
let generatedGifUrl = null;
let generatedGifBlob = null;
let isGifReady = false;
let isMirrored = true;
let skipCurrentPose = false;
let gallerySessions = [];

function toggleMirror() {
  isMirrored = !isMirrored;
  video.style.transform = isMirrored ? "scaleX(-1)" : "scaleX(1)";
  const mirrorText = document.getElementById("mirror-text");
  if (mirrorText) {
    mirrorText.innerText = `Mirror: ${isMirrored ? "ON" : "OFF"}`;
  }
}

function skipPhoto() {
  skipCurrentPose = true;
}

function goToCamera() {
  // Reset capture state but keep session running
  capturedPhotos = [];
  isGifReady = false;
  generatedGifUrl = null;
  generatedGifBlob = null;
  // Reset thumbnails
  for (let n = 1; n <= 4; n++) {
    const thumb = document.getElementById(`thumb-${n}`);
    if (thumb) {
      thumb.className =
        "thumb-slot w-[72px] h-[72px] rounded-2xl bg-white/10 border-2 border-dashed border-white/25 overflow-hidden flex items-center justify-center shadow-inner";
      thumb.innerHTML = `<span class="text-white/30 font-black text-2xl font-headline">${n}</span>`;
    }
  }
  showView("camera");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Initialization
async function initApp() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");

    cameraSelect.innerHTML = videoDevices
      .map(
        (d, i) =>
          `<option value="${d.deviceId}">${d.label || "Kamera " + (i + 1)}</option>`,
      )
      .join("");

    if (videoDevices.length > 0) {
      currentDeviceId = videoDevices[0].deviceId;
      await startCamera(currentDeviceId);
    }
  } catch (err) {
    console.error("Kamera error:", err);
    alert("Akses kamera diperlukan.");
  }
}

cameraSelect.onchange = (e) => startCamera(e.target.value);
window.onload = initApp;

function showView(viewName) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[viewName].classList.remove("hidden");
  if (viewName === "landing") views[viewName].classList.add("block");
  else views[viewName].classList.add("flex");

  document
    .querySelectorAll(".nav-btn")
    .forEach((btn) => btn.classList.remove("active-nav"));
  if (viewName === "landing")
    document.getElementById("nav-landing")?.classList.add("active-nav");
  else if (viewName === "camera" || viewName === "result")
    document.getElementById("nav-camera")?.classList.add("active-nav");
  else if (viewName === "gallery") {
    document.getElementById("nav-gallery")?.classList.add("active-nav");
    renderGallery();
  } else if (viewName === "drive") {
    document.getElementById("nav-drive")?.classList.add("active-nav");
    fetchDriveFolders();
  }
}

async function startCamera(deviceId) {
  if (videoStream) videoStream.getTracks().forEach((t) => t.stop());
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    video.srcObject = videoStream;
    // Apply mirror transform immediately on camera start
    video.style.transform = isMirrored ? "scaleX(-1)" : "scaleX(1)";
  } catch (err) {
    console.error("Gagal menjalankan kamera:", err);
  }
}

function selectTemplateAndStart(templateName) {
  selectedTemplate = templateName;
  showView("camera");
}

function setTimer(seconds) {
  selectedTime = seconds;
  document.querySelectorAll(".timer-btn").forEach((btn) => {
    if (parseInt(btn.dataset.time) === seconds) {
      btn.className =
        "timer-btn py-3 px-6 rounded-full bg-primary text-on-primary font-bold text-sm shadow-md";
    } else {
      btn.className =
        "timer-btn py-3 px-6 rounded-full bg-white text-ink font-bold text-sm border-2 border-ink/10 transition-all";
    }
  });
}

// Sequence Capture
async function startSequenceCapture() {
  btnStartCapture.disabled = true;
  btnStartCapture.classList.add("opacity-50");
  capturedPhotos = [];
  currentSessionId = "SESS-" + Date.now();
  currentFolderId = "";
  isGifReady = false;
  generatedGifUrl = null;
  generatedGifBlob = null;
  skipCurrentPose = false;

  // Reset thumbnails
  for (let n = 1; n <= 4; n++) {
    const thumb = document.getElementById(`thumb-${n}`);
    if (thumb) {
      thumb.className =
        "thumb-slot w-[72px] h-[72px] rounded-2xl bg-white/10 border-2 border-dashed border-white/25 overflow-hidden flex items-center justify-center shadow-inner";
      thumb.innerHTML = `<span class="text-white/30 font-black text-2xl font-headline">${n}</span>`;
    }
  }

  const btnSaveGif = document.getElementById("btn-save-gif");
  if (btnSaveGif) {
    btnSaveGif.disabled = true;
    btnSaveGif.classList.add("opacity-50", "cursor-not-allowed");
  }

  const overlay = document.getElementById("countdown-overlay");
  const txtCount = document.getElementById("countdown-text");
  const txtPose = document.getElementById("pose-status");
  const ring = document.getElementById("countdown-ring");
  const RING_CIRCUMFERENCE = 597;

  for (let i = 1; i <= 4; i++) {
    overlay.classList.remove("hidden");
    txtPose.innerText = `Pose ${i} / 4`;
    skipCurrentPose = false;

    // Reset ring to full
    if (ring) {
      ring.style.transition = "none";
      ring.style.strokeDashoffset = "0";
      // Force reflow to reset transition
      ring.getBoundingClientRect();
      ring.style.transition = "stroke-dashoffset 0.95s linear";
    }

    for (let t = selectedTime; t > 0; t--) {
      txtCount.innerText = t;
      if (ring) {
        // offset increases as time runs out
        ring.style.strokeDashoffset =
          (RING_CIRCUMFERENCE * (selectedTime - t)) / selectedTime;
      }
      if (skipCurrentPose) break;
      await wait(1000);
      if (skipCurrentPose) break;
    }
    skipCurrentPose = false;
    overlay.classList.add("hidden");

    try {
      shutterSound.currentTime = 0;
      shutterSound
        .play()
        .catch((e) => console.warn("Suara kamera diblokir browser"));
    } catch (e) {}

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tCtx = tempCanvas.getContext("2d");

    if (isMirrored) {
      tCtx.translate(tempCanvas.width, 0);
      tCtx.scale(-1, 1);
    }
    tCtx.drawImage(video, 0, 0);

    const img = new Image();
    img.src = tempCanvas.toDataURL("image/jpeg", 0.9);
    await new Promise((r) => (img.onload = r));
    capturedPhotos.push(img);

    // Update thumbnail
    const thumb = document.getElementById(`thumb-${i}`);
    if (thumb) {
      thumb.innerHTML = `<img src="${img.src}" class="w-full h-full object-cover">`;
      thumb.className =
        "thumb-slot captured w-[72px] h-[72px] rounded-2xl overflow-hidden shadow-lg";
    }

    videoWrapper.classList.add("flash-effect");
    await wait(150);
    videoWrapper.classList.remove("flash-effect");

    if (i < 4) await wait(800);
  }

  btnStartCapture.disabled = false;
  btnStartCapture.classList.remove("opacity-50");
  showView("result");

  // Siapkan tampilan Review
  document.getElementById("review-actions-panel").classList.remove("hidden");
  document.getElementById("review-actions-panel").classList.add("flex");
  document.getElementById("cloud-status-panel").classList.add("hidden");
  document.getElementById("cloud-status-panel").classList.remove("flex");
  document.getElementById("wa-share-panel").classList.add("hidden");
  document.getElementById("download-actions-panel").classList.add("hidden");
  document.getElementById("download-actions-panel").classList.remove("flex");
  
  const retakeContainer = document.getElementById("retake-container");
  if (retakeContainer) {
    retakeContainer.classList.remove("hidden");
    retakeContainer.classList.add("flex");
  }

  await drawCompiledCanvas(false);
  renderResultThumbnails();

  // Generate GIF preview (tanpa QR dan tanpa upload)
  generateGif(false);
}

function renderResultThumbnails() {
  const container = document.getElementById("retake-thumbnails");
  if (!container) return;
  container.innerHTML = "";
  capturedPhotos.forEach((img, i) => {
    container.innerHTML += `
      <div 
        class="w-[72px] h-[72px] rounded-xl overflow-hidden cursor-pointer border-[3px] border-transparent hover:border-yellow-300 transition-all shadow-md relative group"
        onclick="retakePhoto(${i})"
      >
        <img src="${img.src}" class="w-full h-full object-cover">
        <div class="absolute inset-0 bg-ink/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span class="material-symbols-outlined text-white text-2xl">replay</span>
        </div>
      </div>
    `;
  });
}

async function retakePhoto(index) {
  showView("camera");
  const btnStart = document.getElementById("btn-start-capture");
  btnStart.classList.add("hidden"); 

  const overlay = document.getElementById("countdown-overlay");
  const txtCount = document.getElementById("countdown-text");
  const txtPose = document.getElementById("pose-status");
  const ring = document.getElementById("countdown-ring");
  const RING_CIRCUMFERENCE = 597;

  overlay.classList.remove("hidden");
  txtPose.innerText = `Retake Pose ${index + 1}`;
  skipCurrentPose = false;

  if (ring) {
    ring.style.transition = "none";
    ring.style.strokeDashoffset = "0";
    ring.getBoundingClientRect(); // force reflow
    ring.style.transition = "stroke-dashoffset 0.95s linear";
  }

  for (let t = selectedTime; t > 0; t--) {
    txtCount.innerText = t;
    if (ring) {
      ring.style.strokeDashoffset = (RING_CIRCUMFERENCE * (selectedTime - t)) / selectedTime;
    }
    if (skipCurrentPose) break;
    await wait(1000);
    if (skipCurrentPose) break;
  }
  skipCurrentPose = false;
  overlay.classList.add("hidden");

  try {
    shutterSound.currentTime = 0;
    shutterSound.play().catch((e) => console.warn("Suara kamera diblokir browser"));
  } catch (e) {}

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  const tCtx = tempCanvas.getContext("2d");

  if (isMirrored) {
    tCtx.translate(tempCanvas.width, 0);
    tCtx.scale(-1, 1);
  }
  tCtx.drawImage(video, 0, 0);

  const img = new Image();
  img.src = tempCanvas.toDataURL("image/jpeg", 0.9);
  await new Promise((r) => (img.onload = r));
  capturedPhotos[index] = img; // Timpa foto lama

  // Update thumbnail di mode camera
  const thumb = document.getElementById(`thumb-${index + 1}`);
  if (thumb) {
    thumb.innerHTML = `<img src="${img.src}" class="w-full h-full object-cover">`;
  }

  videoWrapper.classList.add("flash-effect");
  await wait(150);
  videoWrapper.classList.remove("flash-effect");

  btnStart.classList.remove("hidden");

  // Kembali ke halaman hasil & generate ulang
  showView("result");
  renderResultThumbnails();
  await drawCompiledCanvas(false);
  generateGif(false); 
}

async function confirmAndUpload() {
  document.getElementById("review-actions-panel").classList.add("hidden");
  document.getElementById("review-actions-panel").classList.remove("flex");
  
  document.getElementById("cloud-status-panel").classList.remove("hidden");
  document.getElementById("cloud-status-panel").classList.add("flex");
  
  const retakeContainer = document.getElementById("retake-container");
  if (retakeContainer) {
    retakeContainer.classList.add("hidden");
    retakeContainer.classList.remove("flex");
  }
  
  const statusText = document.getElementById("upload-status-text");
  statusText.innerText = "Membuka Sesi di Cloud... (Mohon tunggu)";
  statusText.className = "text-sm font-bold text-yellow-300 animate-pulse";
  
  // Lakukan upload (folder, qr, 4 foto original, dan grid)
  await processCloudUpload();
  
  // Generate GIF final (dengan QR) & langsung upload GIF
  generateGif(true);
  
  // Tampilkan panel WhatsApp & Download
  document.getElementById("wa-share-panel").classList.remove("hidden");
  document.getElementById("download-actions-panel").classList.remove("hidden");
  document.getElementById("download-actions-panel").classList.add("flex");
}

// Draw Canvas Framework
async function drawCompiledCanvas(withQR = false, qrCanvasElement = null) {
  mainCanvas.width = 1200;
  mainCanvas.height = 1800;

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

  const photoPositions = [
    // Baris 1 (Atas)
    { x: 117, y: 427, w: 496, h: 469 }, // Kiri Atas
    { x: 613, y: 427, w: 496, h: 469 }, // Kanan Atas

    // Baris 2 (Bawah)
    { x: 117, y: 896, w: 496, h: 469 }, // Kiri Bawah
    { x: 613, y: 896, w: 496, h: 469 }, // Kanan Bawah
  ];

  capturedPhotos.forEach((img, i) => {
    let pos = photoPositions[i];
    let photoW = pos.w,
      photoH = pos.h;
    let x = pos.x,
      y = pos.y;

    ctx.save();
    let scale = Math.max(photoW / img.width, photoH / img.height);
    let nw = img.width * scale,
      nh = img.height * scale;

    ctx.beginPath();
    ctx.rect(x, y, photoW, photoH);
    ctx.clip();
    ctx.drawImage(img, x + (photoW - nw) / 2, y + (photoH - nh) / 2, nw, nh);
    ctx.restore();
  });

  const frameImg = new Image();
  frameImg.src = `frame-${selectedTemplate.toLowerCase()}.png`;

  try {
    await new Promise((res, rej) => {
      frameImg.onload = res;
      frameImg.onerror = rej;
    });
    ctx.drawImage(frameImg, 0, 0, mainCanvas.width, mainCanvas.height);
  } catch (e) {
    ctx.fillStyle = "#0846ed";
    ctx.font = "bold 40px Arial";
    ctx.fillText(`MPLS 2026`, 50, 100);
  }

  if (withQR && qrCanvasElement) {
    ctx.drawImage(qrCanvasElement, 845, 1456, 235, 235);
  }

  resultDisplay.src = mainCanvas.toDataURL("image/jpeg", 0.95);
}

// ==========================================
// GIF GENERATION (gif.js)
// ==========================================
async function generateGif(withQR = false) {
  const statusText = document.getElementById("upload-status-text");
  const btnSaveGif = document.getElementById("btn-save-gif");

  try {
    statusText.innerText = "⏳ Sedang membuat animasi GIF...";
    statusText.className = "text-sm font-bold text-primary animate-pulse";

    // Load the GIF-specific frame overlay
    const gifFrameImg = new Image();
    gifFrameImg.src = `frame-${selectedTemplate.toLowerCase()}-gif.png`;
    await new Promise((res, rej) => {
      gifFrameImg.onload = res;
      gifFrameImg.onerror = rej;
    });

    const GIF_W = 600;
    const GIF_H = 900;

    const gif = new GIF({
      workers: 2,
      quality: 10,
      width: GIF_W,
      height: GIF_H,
      workerScript: "./gif.worker.js",
    });

    // Render each photo as a GIF frame with the gif-frame overlay
    for (let i = 0; i < capturedPhotos.length; i++) {
      const frameCanvas = document.createElement("canvas");
      frameCanvas.width = GIF_W;
      frameCanvas.height = GIF_H;
      const fCtx = frameCanvas.getContext("2d");

      // White background
      fCtx.fillStyle = "white";
      fCtx.fillRect(0, 0, GIF_W, GIF_H);

      // Draw the photo centered/cover in a region
      const img = capturedPhotos[i];
      const photoX = 62;
      const photoY = 211;
      const photoW = 488;
      const photoH = 482;

      const scale = Math.max(photoW / img.width, photoH / img.height);
      const nw = img.width * scale;
      const nh = img.height * scale;

      fCtx.save();
      fCtx.beginPath();
      fCtx.rect(photoX, photoY, photoW, photoH);
      fCtx.clip();
      fCtx.drawImage(
        img,
        photoX + (photoW - nw) / 2,
        photoY + (photoH - nh) / 2,
        nw,
        nh,
      );
      fCtx.restore();

      // Draw the gif frame overlay on top
      fCtx.drawImage(gifFrameImg, 0, 0, GIF_W, GIF_H);

      // Draw QR Code on GIF (scaled down by half compared to 1200x1800 canvas)
      if (withQR) {
        const qrElement = document.getElementById("qr-element");
        const qrCanvas = qrElement ? qrElement.querySelector("canvas") : null;
        if (qrCanvas) {
          fCtx.drawImage(qrCanvas, 422.5, 728, 117.5, 117.5);
        }
      }

      // Draw pose indicator
      fCtx.fillStyle = "rgba(255,255,255,0.85)";
      fCtx.beginPath();
      fCtx.roundRect(GIF_W - 80, GIF_H - 50, 65, 35, 8);
      fCtx.fill();
      fCtx.fillStyle = "#0846ed";
      fCtx.font = "bold 16px 'Plus Jakarta Sans', sans-serif";
      fCtx.textAlign = "center";
      fCtx.fillText(`${i + 1}/4`, GIF_W - 48, GIF_H - 27);

      gif.addFrame(frameCanvas, { delay: 800, copy: true });
    }

    // Wait for GIF to render
    const gifBlob = await new Promise((resolve, reject) => {
      gif.on("finished", (blob) => resolve(blob));
      gif.on("error", (err) => reject(err));
      gif.render();
    });

    generatedGifBlob = gifBlob;
    generatedGifUrl = URL.createObjectURL(gifBlob);
    isGifReady = true;

    // Show GIF preview
    const gifDisplay = document.getElementById("gif-display");
    if (gifDisplay) {
      gifDisplay.src = generatedGifUrl;
    }

    // Enable the GIF save button
    if (btnSaveGif) {
      btnSaveGif.disabled = false;
      btnSaveGif.classList.remove("opacity-50", "cursor-not-allowed");
    }

    // Upload GIF to Drive (jika final/withQR)
    if (withQR && currentFolderId) {
      statusText.innerText = "⏳ Mengunggah GIF ke Drive...";
      statusText.className = "text-sm font-bold text-primary animate-pulse";

      const gifBase64 = await blobToBase64(gifBlob);
      await uploadSingleFile(
        gifBase64,
        "Animasi_Photobooth.gif",
        currentFolderId,
      );

      statusText.innerHTML = "✅ Semua file tersimpan di Google Drive! (6 file)";
      statusText.className = "text-sm font-bold text-green-600";
    } else if (!withQR) {
      statusText.innerHTML = "✅ Preview siap. Silakan klik Unggah jika sudah puas.";
      statusText.className = "text-sm font-bold text-green-600";
    }
  } catch (err) {
    console.error("GIF generation error:", err);
    if (withQR) {
      statusText.innerHTML = "✅ Foto tersimpan. ⚠️ GIF gagal dibuat.";
      statusText.className = "text-sm font-bold text-amber-600";
    } else {
      statusText.innerHTML = "⚠️ Gagal membuat preview animasi GIF.";
      statusText.className = "text-sm font-bold text-red-500";
    }
  }
}

// Convert Blob to base64 data URL
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// ==========================================
// PREVIEW TOGGLE (Grid vs GIF)
// ==========================================
function switchPreview(mode) {
  const tabGrid = document.getElementById("tab-grid");
  const tabGif = document.getElementById("tab-gif");
  const gridImg = document.getElementById("result-display");
  const gifImg = document.getElementById("gif-display");

  if (mode === "grid") {
    tabGrid.className =
      "px-5 py-2.5 tab-active rounded-full font-bold text-sm transition-all";
    tabGif.className =
      "px-5 py-2.5 tab-inactive rounded-full font-bold text-sm transition-all";
    gridImg.classList.remove("hidden");
    gifImg.classList.add("hidden");
  } else {
    tabGif.className =
      "px-5 py-2.5 tab-active rounded-full font-bold text-sm transition-all";
    tabGrid.className =
      "px-5 py-2.5 tab-inactive rounded-full font-bold text-sm transition-all";
    gridImg.classList.add("hidden");
    gifImg.classList.remove("hidden");

    if (!isGifReady) {
      gifImg.alt = "⏳ GIF sedang diproses...";
    }
  }
}

// ==========================================
// DOWNLOAD FUNCTIONS
// ==========================================
function downloadImage() {
  const link = document.createElement("a");
  link.download = `Photobooth_${Date.now()}.jpg`;
  link.href = mainCanvas.toDataURL("image/jpeg", 0.98);
  link.click();
}

function downloadResult() {
  if (!isGifReady || !generatedGifUrl) {
    alert("GIF masih dalam proses. Tunggu sebentar...");
    return;
  }
  const link = document.createElement("a");
  link.download = `Photobooth_GIF_${Date.now()}.gif`;
  link.href = generatedGifUrl;
  link.click();
}

function printImage() {
  const dataUrl = mainCanvas.toDataURL("image/jpeg", 1.0);
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert("Pop-up diblokir. Harap izinkan pop-up untuk mencetak.");
    return;
  }
  printWindow.document.write(`
    <html>
      <head>
        <title>Print Photo - 4R</title>
        <style>
          @page {
            size: 4in 6in; /* 4R Size */
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
            width: 4in;
            height: 6in;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: white;
          }
          img {
            width: 100%;
            height: 100%;
            object-fit: cover; /* Fit perfectly into 4R */
          }
        </style>
      </head>
      <body>
        <img src="${dataUrl}" onload="window.print(); window.close();">
      </body>
    </html>
  `);
  printWindow.document.close();
}


// Upload & Logic integration
async function processCloudUpload() {
  const statusText = document.getElementById("upload-status-text");
  const nameInput = document.getElementById("visitor-name");
  const phoneInput = document.getElementById("visitor-phone");

  const visitorName =
    nameInput && nameInput.value ? nameInput.value : "Pengunjung Anonim";
  const visitorPhone = phoneInput && phoneInput.value ? phoneInput.value : "-";

  try {
    statusText.innerText = "Membuka Sesi di Cloud... (Mohon tunggu)";

    const res = await fetch(GOOGLE_SCRIPT_URL, {
      redirect: "follow",
      method: "POST",
      body: JSON.stringify({
        action: "create_folder_and_log",
        id_sesi: currentSessionId,
        nama_pengunjung: visitorName,
        no_telepon: visitorPhone,
        template: selectedTemplate,
      }),
    });

    const folderData = await res.json();

    if (folderData.status === "success") {
      lastFolderUrl = folderData.folderUrl;
      currentFolderId = folderData.folderId;

      // 1. Generate QR dan Tempel langsung ke Canvas
      await generateAndDrawQR(folderData.folderUrl);

      // 2. Upload 4 Foto Original (tanpa frame)
      statusText.innerText = "Mengunggah 4 foto original ke Drive... (1/4)";
      for (let i = 0; i < capturedPhotos.length; i++) {
        statusText.innerText = `Mengunggah foto original ke Drive... (${i + 1}/4)`;

        const origCanvas = document.createElement("canvas");
        origCanvas.width =
          capturedPhotos[i].naturalWidth || capturedPhotos[i].width;
        origCanvas.height =
          capturedPhotos[i].naturalHeight || capturedPhotos[i].height;
        const oCtx = origCanvas.getContext("2d");
        oCtx.drawImage(capturedPhotos[i], 0, 0);

        await uploadSingleFile(
          origCanvas.toDataURL("image/jpeg", 0.92),
          `Foto_Original_${i + 1}.jpg`,
          folderData.folderId,
        );
      }

      // 3. Upload Final Grid (dengan frame + QR)
      statusText.innerText = "Mengunggah hasil foto final ke Drive... (5/6)";
      await uploadSingleFile(
        mainCanvas.toDataURL("image/jpeg", 0.95),
        "Final_Photobooth.jpg",
        folderData.folderId,
      );

      // 4. Simpan Riwayat Lokal (Memory Only)
      gallerySessions.unshift({
        id: currentSessionId,
        image: mainCanvas.toDataURL("image/jpeg", 0.3),
        template: selectedTemplate,
        date: new Date().toLocaleString("id-ID"),
        driveUrl: lastFolderUrl,
      });

      statusText.innerHTML = "✅ 5 file terunggah! Memproses GIF...";
      statusText.className = "text-sm font-bold text-green-600";

      // GIF upload akan dilakukan oleh generateGif() setelah selesai render
    } else {
      throw new Error(folderData.message);
    }
  } catch (err) {
    console.error(err);
    statusText.innerHTML =
      "⚠️ Gagal mengunggah ke Cloud. Periksa koneksi internet Anda.";
    statusText.className = "text-sm font-bold text-red-500 mt-2";

    const qrUIContainer = document.getElementById("qrcode-ui-container");
    if (qrUIContainer) {
      qrUIContainer.classList.add("hidden");
      qrUIContainer.classList.remove("flex");
    }
  }
}

async function generateAndDrawQR(url) {
  const qrUIContainer = document.getElementById("qrcode-ui-container");
  const qrElement = document.getElementById("qr-element");

  qrElement.innerHTML = "";
  qrUIContainer.classList.remove("hidden");
  qrUIContainer.classList.add("flex");

  new QRCode(qrElement, {
    text: url,
    width: 256,
    height: 256,
    correctLevel: QRCode.CorrectLevel.H,
  });
  await wait(500);

  const qrCanvas = qrElement.querySelector("canvas");
  if (qrCanvas) {
    await drawCompiledCanvas(true, qrCanvas);
  }
}

async function uploadSingleFile(base64Str, filename, folderId) {
  const cleanBase64 = base64Str.split(",")[1];
  return fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "upload_file",
      folderId: folderId,
      image: cleanBase64,
      filename: filename,
    }),
  });
}

function shareWA() {
  const waNumber = document.getElementById("wa-number").value.trim();
  if (!waNumber || !lastFolderUrl) {
    alert("Masukkan nomor WhatsApp.");
    return;
  }

  let cleanNumber = waNumber.replace(/\D/g, "");
  if (cleanNumber.startsWith("0")) cleanNumber = "62" + cleanNumber.slice(1);

  const message = encodeURIComponent(
    `*📸 KENANGAN MPLS 2026 PHOTOBOOTH*\n\nHasil foto Anda sudah siap di Google Drive:\n*Link Foto:* ${lastFolderUrl}` +
      `\n\n--------------------------------------------\n` +
      `* INFO SPMB TA. 2026/2027*\n\n` +
      `Dapatkan pendidikan terbaik untuk buah hati Anda. Info & Registrasi:\n` +
      ` www.ppdb.ppiabaitulmaal.sch.id\n\n` +
      `*Call & WA Center SMPIP Baitul Maal:*\n` +
      ` 021-735-8755 (Kantor)\n` +
      ` wa.me/6281284422270 (WhatsApp)\n\n` +
      `*Official Account:*\n` +
      ` Instagram: @smpip_baitul_maal\n` +
      ` YouTube: SMPIP Baitul Maal\n` +
      ` TikTok: @smpip_baitulmaal\n` +
      ` FB: Smpip Baitul Maal\n\n` +
      `--------------------------------------------\n` +
      `💻 *Sistem Photobooth ini dikembangkan oleh:*\n` +
      `Syamil Muhammad Aulia\n` +
      `🌐 https://syamil.vercel.app`,
  );
  window.open(`https://wa.me/${cleanNumber}?text=${message}`, "_blank");
}

const KLIK_MASCOT_SVG = `
  <svg class="w-32 h-32 mx-auto animate-float" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="58" cy="148" rx="14" ry="7" fill="#1B2A55" opacity="0.12"/>
    <ellipse cx="102" cy="148" rx="14" ry="7" fill="#1B2A55" opacity="0.12"/>
    <rect x="50" y="118" width="16" height="28" rx="8" fill="#FF8A3D"/>
    <rect x="94" y="118" width="16" height="28" rx="8" fill="#FF8A3D"/>
    <rect x="25" y="45" width="110" height="85" rx="26" fill="#FFC93C"/>
    <rect x="60" y="28" width="40" height="22" rx="8" fill="#FFC93C"/>
    <rect x="14" y="80" width="34" height="14" rx="7" fill="#FFC93C" transform="rotate(-10 14 80)"/>
    <rect x="112" y="80" width="34" height="14" rx="7" fill="#FFC93C" transform="rotate(10 146 94)"/>
    <circle cx="80" cy="92" r="34" fill="#1B2A55"/>
    <circle cx="80" cy="92" r="26" fill="#3B82F6"/>
    <circle cx="80" cy="92" r="17" fill="#15193A"/>
    <circle cx="71" cy="86" r="6" fill="white"/>
    <circle cx="89" cy="86" r="6" fill="white"/>
    <circle cx="72.5" cy="87.5" r="2.6" fill="#1B2A55"/>
    <circle cx="90.5" cy="87.5" r="2.6" fill="#1B2A55"/>
    <path d="M73 100 Q80 106 87 100" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="118" cy="58" r="6" fill="#FF8A3D"/>
  </svg>`;

function renderGallery() {
  galleryContainer.innerHTML =
    gallerySessions.length === 0
      ? `<div class="col-span-full text-center py-16">
          ${KLIK_MASCOT_SVG}
          <p class="text-white font-bold text-lg mt-4">Belum ada foto di sini</p>
          <p class="text-white/70 text-sm mt-1">Yuk mulai sesi foto pertamamu!</p>
        </div>`
      : gallerySessions
          .map(
            (s) => `
        <div class="pixar-card p-4">
          <img src="${s.image}" class="w-full h-auto rounded-2xl">
          <p class="text-xs font-bold text-primary mt-3 uppercase tracking-wide">${s.template} • ${s.date}</p>
        </div>
      `,
          )
          .join("");
}

function resetApp() {
  if (confirm("Mulai ulang sesi baru?")) location.reload();
}

async function fetchDriveFolders() {
  const container = document.getElementById("drive-container");
  if (!container) return;

  container.innerHTML = `<p class="text-center text-white font-semibold py-10">Memuat data dari Google Drive...</p>`;

  try {
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      redirect: "follow",
      method: "POST",
      body: JSON.stringify({ action: "get_folders_with_photos" }),
    });
    const data = await response.json();

    if (data.status === "success" && data.folders) {
      container.innerHTML =
        data.folders.length === 0
          ? `<div class="text-center py-16">
              ${KLIK_MASCOT_SVG}
              <p class="text-white font-bold text-lg mt-4">Drive masih kosong</p>
              <p class="text-white/70 text-sm mt-1">Folder pengunjung akan muncul di sini setelah sesi pertama.</p>
            </div>`
          : data.folders
              .map(
                (f) => `
            <div class="pixar-card p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <h3 class="font-bold text-ink text-lg">${f.name}</h3>
              <a href="${f.url}" target="_blank" class="hero-gradient px-5 py-2.5 rounded-full text-sm inline-flex items-center gap-2 w-fit">
                Buka di Drive <span class="material-symbols-outlined text-base">open_in_new</span>
              </a>
            </div>
          `,
              )
              .join("");
    }
  } catch (err) {
    container.innerHTML = `<p class="text-center text-red-300 font-semibold py-10">Gagal memuat Drive. Pastikan script sudah di-deploy dengan benar.</p>`;
  }
}
