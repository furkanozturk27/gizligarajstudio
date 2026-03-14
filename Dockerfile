FROM python:3.10

# Install only the runtime dependency 'ffmpeg'
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set up work directory
WORKDIR /app

# Copy requirements and upgrade pip so it can find modern linux wheels for 'av'
COPY requirements.txt .
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose the Railway dynamic port
EXPOSE $PORT

# Start application
CMD gunicorn app:app -b 0.0.0.0:$PORT --timeout 600 --workers 1
