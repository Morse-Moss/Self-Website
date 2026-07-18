FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models

WORKDIR /app

COPY deploy/embedding/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY scripts/local-embedding-server.py ./local-embedding-server.py
RUN useradd --system --uid 1001 --create-home embed \
    && mkdir -p /models \
    && chown -R embed:embed /app /models

USER embed
ENV MORSE_EMBEDDING_HOST=0.0.0.0 \
    MORSE_EMBEDDING_PORT=18091 \
    MORSE_EMBEDDING_DEVICE=cpu

EXPOSE 18091
CMD ["python", "local-embedding-server.py"]
