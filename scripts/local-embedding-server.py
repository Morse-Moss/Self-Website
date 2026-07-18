import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
from sentence_transformers import SentenceTransformer


HOST = os.environ.get("MORSE_EMBEDDING_HOST", "127.0.0.1")
PORT = int(os.environ.get("MORSE_EMBEDDING_PORT", "18091"))
MODEL_ID = os.environ.get("MORSE_EMBEDDING_MODEL_PATH", "BAAI/bge-small-zh-v1.5")
SOURCE_DIMENSIONS = 512
TARGET_DIMENSIONS = 1536
MAX_REQUEST_BYTES = 1_000_000


def select_device():
    requested = os.environ.get("MORSE_EMBEDDING_DEVICE", "auto").strip().lower()
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("MORSE_EMBEDDING_DEVICE=cuda but CUDA PyTorch is unavailable.")
    if requested not in {"cpu", "cuda"}:
        raise ValueError("MORSE_EMBEDDING_DEVICE must be auto, cpu, or cuda.")
    return requested


DEVICE = select_device()
MODEL = SentenceTransformer(MODEL_ID, device=DEVICE)


def encode(inputs):
    vectors = MODEL.encode(
        inputs,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    vectors = np.asarray(vectors, dtype=np.float32)
    if vectors.ndim == 1:
        vectors = vectors.reshape(1, -1)
    if vectors.shape[1] != SOURCE_DIMENSIONS:
        raise ValueError(
            f"Model returned {vectors.shape[1]} dimensions; expected {SOURCE_DIMENSIONS}."
        )
    vectors = np.pad(
        vectors,
        ((0, 0), (0, TARGET_DIMENSIONS - SOURCE_DIMENSIONS)),
        mode="constant",
    )
    return vectors


class EmbeddingHandler(BaseHTTPRequestHandler):
    server_version = "MorseEmbedding/1.0"

    def log_message(self, format, *args):
        print(f"{self.client_address[0]} {format % args}")

    def write_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.write_json(
                HTTPStatus.OK,
                {"status": "ok", "model": MODEL_ID, "device": DEVICE},
            )
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"error": {"message": "Not found."}})

    def do_POST(self):
        if self.path != "/v1/embeddings":
            self.write_json(HTTPStatus.NOT_FOUND, {"error": {"message": "Not found."}})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("Request body size is invalid.")
            payload = json.loads(self.rfile.read(length))
            inputs = payload.get("input")
            if isinstance(inputs, str):
                inputs = [inputs]
            if not isinstance(inputs, list) or not inputs or not all(
                isinstance(item, str) and item.strip() for item in inputs
            ):
                raise ValueError("input must be a non-empty string or string array.")
            dimensions = payload.get("dimensions", TARGET_DIMENSIONS)
            if dimensions != TARGET_DIMENSIONS:
                raise ValueError(f"dimensions must be {TARGET_DIMENSIONS}.")

            vectors = encode(inputs)
            self.write_json(
                HTTPStatus.OK,
                {
                    "object": "list",
                    "model": MODEL_ID,
                    "data": [
                        {"object": "embedding", "index": index, "embedding": vector.tolist()}
                        for index, vector in enumerate(vectors)
                    ],
                    "usage": {"prompt_tokens": 0, "total_tokens": 0},
                },
            )
        except (ValueError, json.JSONDecodeError) as error:
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {"error": {"message": str(error), "type": "invalid_request_error"}},
            )
        except Exception as error:
            print(f"embedding error: {type(error).__name__}: {error}")
            self.write_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": {"message": "Embedding failed.", "type": "server_error"}},
            )


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), EmbeddingHandler)
    print(f"Morse embedding server listening on http://{HOST}:{PORT} ({DEVICE}, {MODEL_ID})")
    server.serve_forever()
