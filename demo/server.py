#!/usr/bin/env python3
"""Отдаёт прототип «Отклик» на 0.0.0.0:8000 для живого превью.

Отличия от `python3 -m http.server`:
- Cache-Control: no-store — превью всегда показывает свежую сборку,
  а не закешированный app.js после правок;
- явные MIME для js/css/svg/webmanifest (у SimpleHTTP старые таблицы);
- правильный Host из-за прокси и корректный лог запросов;
- HEAD и диапазоны (Range) — чтобы браузер не спотыкался на аудио/видео;
- один и тот же ответ для `/` и `/index.html`.

Запуск:  python3 demo/server.py  [порт]
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

EXTRA_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
}


class Handler(SimpleHTTPRequestHandler):
    server_version = "OtklikPreview/1.0"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # превью открывается в iframe с другого origin — не мешаем
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(Handler, directory=ROOT)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)
    httpd.daemon_threads = True
    print(f"Отклик: http://0.0.0.0:{port}  (root: {ROOT})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
