"""Loopback-only HTTP server for the job positioning review workbench."""

from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from jobagent.review import ReviewStore, ReviewValidationError


UI_DIR = Path(__file__).resolve().parent.parent / "review_ui"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}


class ReviewHttpServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, handler, db_path: Path, ui_dir: Path):
        super().__init__(address, handler)
        self.db_path = db_path
        self.ui_dir = ui_dir


class ReviewRequestHandler(BaseHTTPRequestHandler):
    server: ReviewHttpServer

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if path == "/api/jobs":
            self._list_jobs()
            return
        if path.startswith("/api/jobs/"):
            self._get_job(unquote(path.removeprefix("/api/jobs/")))
            return
        if path in STATIC_FILES:
            self._send_static(path)
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "页面不存在"})

    def do_PUT(self) -> None:
        path = urlsplit(self.path).path
        if not path.startswith("/api/jobs/"):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"})
            return
        job_id = unquote(path.removeprefix("/api/jobs/"))
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
            if not isinstance(payload, dict):
                raise ReviewValidationError("提交内容格式不正确")
        except (ValueError, json.JSONDecodeError):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "提交内容不是有效 JSON"})
            return

        store = ReviewStore(self.server.db_path)
        try:
            review = store.save_review(job_id, payload)
            self._send_json(HTTPStatus.OK, {"review": review})
        except ReviewValidationError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        finally:
            store.close()

    def _list_jobs(self) -> None:
        store = ReviewStore(self.server.db_path)
        try:
            jobs = store.ensure_sample()
            self._send_json(
                HTTPStatus.OK,
                {"jobs": jobs, "stats": store.stats()},
            )
        except ReviewValidationError as exc:
            self._send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        finally:
            store.close()

    def _get_job(self, job_id: str) -> None:
        store = ReviewStore(self.server.db_path)
        try:
            job = store.get_job(job_id)
            if job is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "岗位不在当前样本中"})
                return
            self._send_json(HTTPStatus.OK, {"job": job})
        finally:
            store.close()

    def _send_static(self, path: str) -> None:
        filename, content_type = STATIC_FILES[path]
        file_path = self.server.ui_dir / filename
        if not file_path.is_file():
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "界面资源缺失"})
            return
        body = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        return


def create_server(
    db_path: str | Path,
    host: str = "127.0.0.1",
    port: int = 8765,
    ui_dir: str | Path = UI_DIR,
) -> ReviewHttpServer:
    return ReviewHttpServer(
        (host, port),
        ReviewRequestHandler,
        Path(db_path).resolve(),
        Path(ui_dir).resolve(),
    )


def run_review_server(db_path: str | Path, host: str = "127.0.0.1", port: int = 8765) -> None:
    server = create_server(db_path, host=host, port=port)
    print(f"岗位定位审阅台：http://{host}:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
