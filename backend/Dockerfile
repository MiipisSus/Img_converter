FROM python:3.11-slim

# 系統依賴：ffmpeg, gifsicle, 圖形庫
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        gifsicle \
        libsm6 \
        libxext6 \
        libcairo2-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先複製 requirements 以利用 Docker 快取
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製後端程式碼
COPY backend/ ./backend/

EXPOSE 8080

CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8080"]
