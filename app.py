import os
import time
import json
import subprocess
from flask import Flask, request, jsonify, send_file, Response, stream_with_context
from flask_cors import CORS
from werkzeug.utils import secure_filename
import threading

# Add local FFmpeg to PATH for Windows local usage
FFMPEG_DIR = r"C:\Users\omerf\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin"
if os.path.exists(FFMPEG_DIR):
    os.environ["PATH"] += os.pathsep + FFMPEG_DIR

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

model = None
model_loading = False
model_ready = False

def init_model():
    global model, model_loading, model_ready
    if model_loading or model_ready:
        return
    model_loading = True
    print("🔄 Faster-Whisper modeli yükleniyor ('large-v3')... Lütfen bekleyin.")
    start_time = time.time()
    try:
        from faster_whisper import WhisperModel
        # compute_type="int8" reduces memory usage
        global_model = WhisperModel("large-v3", device="cpu", compute_type="int8")
        model = global_model
        model_ready = True
        print(f"✅ Model hazır! ({time.time() - start_time:.2f} saniye)")
    except Exception as e:
        print(f"❌ Model yükleme hatası: {e}")
    finally:
        model_loading = False

# Start model initialization in background
threading.Thread(target=init_model, daemon=True).start()

def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    msecs = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{msecs:03d}"

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/status')
def status():
    return jsonify({
        'ready': model_ready,
        'loading': model_loading
    })

@app.route('/transcribe-stream', methods=['POST'])
def transcribe_stream():
    if not model_ready:
        return jsonify({'error': 'Model henüz yükleniyor. Lütfen birkaç dakika bekleyip tekrar deneyin.'}), 503
        
    if 'audio' not in request.files:
        return jsonify({'error': 'Lütfen bir ses dosyası yükleyin.'}), 400
        
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'Dosya seçilmedi.'}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    print(f"📁 Dosya işlem için alındı: {filename}")

    def generate():
        mode = request.form.get('mode', 'standard')
        req_lang = request.form.get('language')
        
        # If user picked 'detect' on frontend, req_lang would be None or empty.
        lang_param = req_lang if req_lang else None
        
        try:
            word_timestamps = (mode == 'word')
            segments, info = model.transcribe(
                filepath, 
                beam_size=5,
                language=lang_param,
                task="transcribe",
                word_timestamps=word_timestamps
            )
            
            # Send initial language detection info
            yield f"event: info\ndata: {json.dumps({'language': info.language, 'probability': info.language_probability, 'duration': info.duration})}\n\n"
            
            srt_idx = 1
            for segment in segments:
                if word_timestamps and segment.words:
                    for w in segment.words:
                        start_time = format_timestamp(w.start)
                        end_time = format_timestamp(w.end)
                        text = w.word.strip()
                        if not text: continue
                        
                        srt_chunk = f"{srt_idx}\n{start_time} --> {end_time}\n{text}\n\n"
                        # Print to terminal so we see progress
                        print(f"[{start_time} -> {end_time}] {text}")
                        
                        progress = min(100, (w.end / info.duration) * 100) if getattr(info, 'duration', 0) > 0 else 0
                        # Yield SSE chunk
                        yield f"event: segment\ndata: {json.dumps({'srt': srt_chunk, 'progress': progress})}\n\n"
                        srt_idx += 1
                else:
                    start_time = format_timestamp(segment.start)
                    end_time = format_timestamp(segment.end)
                    text = segment.text.strip()
                    
                    srt_chunk = f"{srt_idx}\n{start_time} --> {end_time}\n{text}\n\n"
                    # Print to terminal so we see progress
                    print(f"[{start_time} -> {end_time}] {text}")
                    
                    progress = min(100, (segment.end / info.duration) * 100) if getattr(info, 'duration', 0) > 0 else 0
                    # Yield SSE chunk
                    yield f"event: segment\ndata: {json.dumps({'srt': srt_chunk, 'progress': progress})}\n\n"
                    srt_idx += 1
                
            yield f"event: done\ndata: {json.dumps({'status': 'completed'})}\n\n"
            
        except Exception as e:
            print(f"❌ Transkripsiyon hatası: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
            
        finally:
            if os.path.exists(filepath):
                os.remove(filepath)
                
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

import yt_dlp

@app.route('/api/download', methods=['POST'])
def download_youtube():
    data = request.json
    url = data.get('url')
    if not url:
        return jsonify({'error': 'URL boş olamaz.'}), 400

    try:
        # Generate generic temp path
        import uuid
        temp_id = str(uuid.uuid4())
        ydl_opts = {
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': os.path.join(app.config['UPLOAD_FOLDER'], f'{temp_id}_%(title)s.%(ext)s'),
            'noplaylist': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filepath = ydl.prepare_filename(info)
            title = info.get('title', 'video')
            ext = info.get('ext', 'mp4')
            
            # Use safe filename for headers but do NOT modify the filepath
            safe_title = secure_filename(f"{title}.{ext}")

        @stream_with_context
        def send_and_delete():
            with open(filepath, 'rb') as f:
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    yield chunk
            # clean up after streaming
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except:
                    pass

        headers = {
            'Content-Disposition': f'attachment; filename="{safe_title}"'
        }
        
        return Response(send_and_delete(), headers=headers, mimetype='video/mp4')

    except Exception as e:
        print(f"❌ YouTube indirme hatası: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 3000))
    print(f"\n🚀 Sunucu anında başlatıldı: http://localhost:{port}")
    print(f"Not: Arka planda devasa 'large-v3' modeli yükleniyor. Yaklaşık 4-5 dakika sürebilir.\n")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
