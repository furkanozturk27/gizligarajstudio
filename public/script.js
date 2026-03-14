// ===========================
// DOM Elements
// ===========================
const editorBody = document.getElementById('editor-body');
const uploadScreen = document.getElementById('upload-screen');
const mainEditor = document.getElementById('main-editor');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const startBtn = document.getElementById('start-btn');
const progressDiv = document.getElementById('upload-progress');
const progressFill = document.getElementById('upload-progress-fill');
const statusText = document.getElementById('upload-status-text');

const subtitleList = document.getElementById('subtitle-list');
const timelineClips = document.getElementById('timeline-clips');
const ruler = document.getElementById('ruler');
const trackLabel = document.querySelector('.track-ruler');

const inspectorFilename = document.getElementById('inspector-filename');
const inspectorLanguage = document.getElementById('inspector-language');
const monitorTime = document.querySelector('.monitor-time');
const exportBtn = document.getElementById('export-btn');

let selectedFile = null;
let subtitleData = []; // Store parsed objects
let totalDuration = 0; // In seconds

// ===========================
// Utilities
// ===========================
function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Convert "HH:MM:SS,mmm" to seconds
function srtTimeToSeconds(srtTime) {
    const parts = srtTime.split(',');
    const hms = parts[0].split(':');
    return parseInt(hms[0]) * 3600 + parseInt(hms[1]) * 60 + parseInt(hms[2]) + parseInt(parts[1]) / 1000;
}

// Parse a single SRT chunk
function parseSrtChunk(chunk) {
    const lines = chunk.trim().split('\n');
    if (lines.length < 3) return null;

    const id = lines[0];
    const times = lines[1].split(' --> ');
    const startSec = srtTimeToSeconds(times[0].trim());
    const endSec = srtTimeToSeconds(times[1].trim());
    const text = lines.slice(2).join('\n');

    return { id, start: times[0].trim(), startSec, end: times[1].trim(), endSec, text };
}

// ===========================
// File Selection
// ===========================
// Removed redundant click listener for dropZone since it is a label

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => e.preventDefault());
});

dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/') && !file.name.match(/\.(mp3|wav|m4a|mp4|mov)$/i)) {
        return showToast("Lütfen geçerli bir ses dosyası seçin.");
    }
    selectedFile = file;

    document.getElementById('drop-icon-container').style.color = '#FFD700'; // Gizli garaj yellow
    document.getElementById('drop-icon-container').style.borderColor = '#FFD700';
    document.getElementById('drop-zone-title').textContent = file.name;
    document.getElementById('drop-zone-sub').textContent = (file.size / 1024 / 1024).toFixed(1) + " MB";

    startBtn.disabled = false;
    inspectorFilename.textContent = file.name;

    // Attempt to load duration via HTML5 Audio
    const url = URL.createObjectURL(file);
    const tmpAudio = new Audio(url);
    tmpAudio.onloadedmetadata = () => {
        totalDuration = tmpAudio.duration;
        buildRuler(totalDuration);
    };
}

// ===========================
// Build Ruler Elements
// ===========================
function buildRuler(durationSeconds) {
    const pixelsPerSecond = 50; // Zoom level scale
    const totalWidth = durationSeconds * pixelsPerSecond;

    document.querySelector('.track-ruler').style.width = `${totalWidth + 200}px`;
    document.getElementById('timeline-clips').style.width = `${totalWidth + 200}px`;

    ruler.innerHTML = '';
    for (let i = 0; i <= durationSeconds; i += 5) {
        const mark = document.createElement('div');
        mark.className = 'ruler-mark';
        mark.style.position = 'absolute';
        mark.style.left = `${i * pixelsPerSecond + 80}px`;
        mark.style.height = '100%';

        const min = Math.floor(i / 60);
        const sec = Math.floor(i % 60);
        mark.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
        ruler.appendChild(mark);
    }
}

// ===========================
// Rendering UI Nodes
// ===========================
function addSubtitleNode(data) {
    // 1. Add to Subtitle List
    const row = document.createElement('div');
    row.className = 'sub-row';
    row.dataset.id = data.id;

    const chars = data.text.length;
    const charClass = chars > 42 ? 'warning' : ''; // Standard broadcast safe limits

    row.innerHTML = `
        <span class="sub-marker">✥</span>
        <div class="sub-time">${data.start.substring(3, 8).replace(':', '.')}</div>
        <div class="sub-flex">
            <textarea class="sub-input">${data.text}</textarea>
            <div class="char-count ${charClass}">${chars} / 42</div>
        </div>
        <div class="sub-time" style="margin-top:8px">${data.end.substring(3, 8).replace(':', '.')}</div>
    `;

    // Char count updater
    const textarea = row.querySelector('.sub-input');
    const counter = row.querySelector('.char-count');
    textarea.addEventListener('input', () => {
        const len = textarea.value.length;
        counter.textContent = `${len} / 42`;
        counter.className = `char-count ${len > 42 ? 'warning' : ''}`;

        // Sync to backend array
        const item = subtitleData.find(s => s.id === data.id);
        if (item) item.text = textarea.value;

        // Auto-resize
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    });

    subtitleList.appendChild(row);

    // 2. Add to Timeline Clips
    const pixelsPerSecond = 50;
    const clip = document.createElement('div');
    clip.className = 'clip';

    const width = Math.max(2, (data.endSec - data.startSec) * pixelsPerSecond);
    const left = data.startSec * pixelsPerSecond;

    clip.style.left = `${left}px`;
    clip.style.width = `${width}px`;
    clip.innerHTML = `<div class="clip-text">${data.text}</div>`;

    // Sync clip text on blur
    textarea.addEventListener('blur', () => {
        clip.querySelector('.clip-text').textContent = textarea.value;
    });

    timelineClips.appendChild(clip);

    // Scroll list
    subtitleList.scrollTop = subtitleList.scrollHeight;
}

// ===========================
// Transcription Logic
// ===========================
startBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    // Transition UI
    startBtn.classList.add('hidden');
    progressDiv.classList.remove('hidden');

    const formData = new FormData();
    formData.append('audio', selectedFile);

    const modeToggle = document.getElementById('mode-toggle');
    const mode = modeToggle && modeToggle.checked ? 'word' : 'standard';
    formData.append('mode', mode);

    const langSelect = document.getElementById('language-select');
    if (langSelect && langSelect.value !== 'detect') {
        formData.append('language', langSelect.value);
    }

    try {
        statusText.textContent = "Bağlanıyor...";
        editorBody.classList.remove('hidden');

        const response = await fetch('/transcribe-stream', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.error || "Sunucu bağlantı hatası.");
        }

        // Switch screens instantly when stream begins
        uploadScreen.classList.add('hidden');
        mainEditor.classList.remove('hidden');

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;
        let partialChunk = '';

        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
                partialChunk += decoder.decode(value, { stream: true });
                const lines = partialChunk.split('\n');
                partialChunk = lines.pop(); // save incomplete

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6).trim();
                        if (!dataStr) continue;
                        try {
                            const data = JSON.parse(dataStr);

                            if (data.error) {
                                throw new Error(data.error);
                            }

                            if (data.language) {
                                inspectorLanguage.textContent = data.language.toUpperCase();
                                if (data.duration) {
                                    totalDuration = data.duration;
                                    buildRuler(totalDuration);
                                }
                            }

                            if (data.srt) {
                                const parsed = parseSrtChunk(data.srt);
                                if (parsed) {
                                    subtitleData.push(parsed);
                                    addSubtitleNode(parsed);
                                    monitorTime.textContent = parsed.end;
                                }
                            }

                            if (data.status === 'completed') {
                                showToast("Timeline Analizi Tamamlandı!");
                            }
                        } catch (e) {
                            if (e.message) throw e; // bubble up data.error
                        }
                    }
                }
            }
        }
    } catch (e) {
        showToast("Hata: " + e.message);
        // Reset UI
        startBtn.classList.remove('hidden');
        progressDiv.classList.add('hidden');
        mainEditor.classList.add('hidden');
        uploadScreen.classList.remove('hidden');
    } finally {
        // Safe reset
        startBtn.disabled = false;
    }
});

// ===========================
// Export System
// ===========================
exportBtn.addEventListener('click', () => {
    if (subtitleData.length === 0) return showToast("Zaman çizelgesi boş!");

    let finalSrt = '';
    subtitleData.forEach((item, index) => {
        finalSrt += `${index + 1}\n`;
        finalSrt += `${item.start} --> ${item.end}\n`;
        finalSrt += `${item.text}\n\n`;
    });

    const blob = new Blob([finalSrt], { type: 'application/x-subrip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = inspectorFilename.textContent.replace(/\.[^.]+$/, '.srt');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Aktarım başarılı.");
    document.querySelector('.status-label').textContent = 'Last saved just now';
});

// ===========================
// Sidebar Navigation Logic
// ===========================
const navSubtitle = document.getElementById('nav-subtitle');
const navYoutube = document.getElementById('nav-youtube');
const viewSubtitle = document.getElementById('view-subtitle');
const viewYoutube = document.getElementById('view-youtube');

navSubtitle.addEventListener('click', () => {
    navSubtitle.classList.add('active');
    navYoutube.classList.remove('active');
    viewSubtitle.classList.remove('hidden');
    viewSubtitle.classList.add('active');
    viewYoutube.classList.add('hidden');
    viewYoutube.classList.remove('active');
});

navYoutube.addEventListener('click', () => {
    navYoutube.classList.add('active');
    navSubtitle.classList.remove('active');
    viewYoutube.classList.remove('hidden');
    viewYoutube.classList.add('active');
    viewSubtitle.classList.add('hidden');
    viewSubtitle.classList.remove('active');
});

// Back to upload screen inside Subtitle editor
const backToUploadBtn = document.getElementById('back-to-upload-btn');
if (backToUploadBtn) {
    backToUploadBtn.addEventListener('click', () => {
        document.getElementById('main-editor').classList.add('hidden');
        document.getElementById('upload-screen').classList.remove('hidden');
    });
}

// ===========================
// YouTube Downloader Logic
// ===========================
const ytUrlInput = document.getElementById('yt-url');
const ytDownloadBtn = document.getElementById('yt-download-btn');
const ytStatus = document.getElementById('yt-status');

if (ytDownloadBtn) {
    ytDownloadBtn.addEventListener('click', async () => {
        const url = ytUrlInput.value.trim();
        if (!url) {
            showToast("Lütfen bir YouTube bağlantısı yapıştırın!");
            return;
        }

        ytDownloadBtn.disabled = true;
        ytUrlInput.disabled = true;
        ytStatus.classList.remove('hidden');

        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: url })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "İndirme başarısız oldu.");
            }

            // Get filename from response headers if possible
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'video.mp4';
            if (contentDisposition && contentDisposition.includes('filename=')) {
                filename = decodeURIComponent(contentDisposition.split('filename=')[1].replace(/"/g, ''));
            }

            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);

            showToast("İndirme başarılı!");
        } catch (error) {
            console.error("Download Error:", error);
            showToast("Hata: " + error.message);
        } finally {
            ytDownloadBtn.disabled = false;
            ytUrlInput.disabled = false;
            ytStatus.classList.add('hidden');
            ytUrlInput.value = '';
        }
    });
}
