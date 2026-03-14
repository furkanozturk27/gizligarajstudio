FROM python:3.10-slim

# Install ffmpeg and development headers required by av
RUN apt-get update && apt-get install -y \
    ffmpeg \
    pkg-config \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libavfilter-dev \
    libswscale-dev \
    libswresample-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set up work directory
WORKDIR /app

# Install pip requirements first to cache them
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose the Railway dynamic port
EXPOSE $PORT

# Start application
CMD gunicorn app:app -b 0.0.0.0:$PORT --timeout 600 --workers 1
