FROM python:3.10-bookworm

# Install system dependencies including those needed to build 'av' from source
RUN apt-get update && apt-get install -y \
    ffmpeg \
    build-essential \
    pkg-config \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libswscale-dev \
    libswresample-dev \
    libavfilter-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip, setuptools, and wheel to ensure smooth wheel building
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose the Railway dynamic port
EXPOSE $PORT

# Start application
CMD gunicorn app:app -b 0.0.0.0:$PORT --timeout 600 --workers 1
