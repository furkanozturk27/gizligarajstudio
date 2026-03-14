const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
const PORT = 3000;

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac'];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|ogg|flac|m4a|wma)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Desteklenmeyen dosya formatı. Lütfen MP3, WAV, OGG veya FLAC dosyası yükleyin.'));
    }
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Whisper pipeline (lazy loaded)
let pipeline = null;
let isModelLoading = false;

async function getTranscriber() {
  if (pipeline) return pipeline;
  if (isModelLoading) {
    // Wait for the model to load
    while (isModelLoading) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return pipeline;
  }

  isModelLoading = true;
  console.log('🔄 Whisper modeli yükleniyor (ilk seferde indirilecek, ~75MB)...');

  const { pipeline: createPipeline } = await import('@xenova/transformers');
  pipeline = await createPipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    quantized: true,
  });

  isModelLoading = false;
  console.log('✅ Whisper modeli hazır!');
  return pipeline;
}

// Convert audio to 16kHz mono WAV
function convertToWav(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath + '.wav';
    ffmpeg(inputPath)
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

// Read WAV file and extract float32 audio data
function readWavAsFloat32(wavPath) {
  const buffer = fs.readFileSync(wavPath);

  // Parse WAV header
  const dataStart = buffer.indexOf('data') + 8; // 'data' + 4 bytes size
  const audioData = buffer.slice(dataStart);

  // Convert Int16 PCM to Float32
  const samples = new Float32Array(audioData.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const int16 = audioData.readInt16LE(i * 2);
    samples[i] = int16 / 32768.0;
  }

  return samples;
}

// Format seconds to SRT timestamp (HH:MM:SS,mmm)
function formatSrtTime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// Generate SRT content from chunks
function generateSrt(chunks) {
  let srt = '';
  chunks.forEach((chunk, index) => {
    const startTime = formatSrtTime(chunk.timestamp[0]);
    const endTime = formatSrtTime(chunk.timestamp[1] || chunk.timestamp[0] + 5);
    srt += `${index + 1}\n`;
    srt += `${startTime} --> ${endTime}\n`;
    srt += `${chunk.text.trim()}\n\n`;
  });
  return srt;
}

// SSE endpoint for model status
app.get('/model-status', (req, res) => {
  res.json({
    loaded: pipeline !== null,
    loading: isModelLoading
  });
});

// Transcription endpoint
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Lütfen bir ses dosyası yükleyin.' });
  }

  const uploadedPath = req.file.path;
  let wavPath = null;

  try {
    console.log(`📁 Dosya alındı: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);

    // Convert to WAV
    console.log('🔄 WAV formatına dönüştürülüyor...');
    wavPath = await convertToWav(uploadedPath);

    // Read audio data
    console.log('🎵 Ses verisi okunuyor...');
    const audioData = readWavAsFloat32(wavPath);

    // Get transcriber
    const transcriber = await getTranscriber();

    // Transcribe
    console.log('🎤 Transkripsiyon başladı...');
    const result = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      language: 'turkish',
      task: 'transcribe',
    });

    console.log('✅ Transkripsiyon tamamlandı!');

    // Generate SRT
    const chunks = result.chunks || [{ text: result.text, timestamp: [0, null] }];
    const srtContent = generateSrt(chunks);

    // Generate filename
    const originalName = path.parse(req.file.originalname).name;
    const srtFilename = `${originalName}.srt`;

    res.setHeader('Content-Type', 'application/x-subrip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(srtFilename)}"`);
    res.setHeader('X-SRT-Filename', srtFilename);
    res.send(srtContent);

  } catch (error) {
    console.error('❌ Hata:', error);
    res.status(500).json({
      error: 'Transkripsiyon sırasında bir hata oluştu.',
      details: error.message
    });
  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
      if (wavPath && fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (e) {
      console.warn('Geçici dosya silinemedi:', e.message);
    }
  }
});

// Preload model endpoint
app.post('/preload-model', async (req, res) => {
  try {
    await getTranscriber();
    res.json({ status: 'ready' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.listen(PORT, () => {
  console.log(`\n🚀 MP3-to-SRT sunucusu çalışıyor: http://localhost:${PORT}\n`);
  console.log('📝 İlk dosya yüklemesinde Whisper modeli otomatik indirilecektir.\n');
});
