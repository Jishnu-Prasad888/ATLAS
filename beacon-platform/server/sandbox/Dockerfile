FROM python:3.11-slim

# Install build deps for common data packages, then remove caches
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m sandboxuser

RUN pip install --no-cache-dir \
    pandas \
    numpy \
    scipy \
    scikit-learn \
    pyarrow \
    fastparquet \
    requests

WORKDIR /app
USER sandboxuser

CMD ["python", "main.py"]
