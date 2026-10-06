"""
A static file server for working on the game.

It is `python3 -m http.server` with one difference: every answer tells the
browser not to keep a copy. The game is made of many small module files, and
a browser that keeps yesterday's copy of one next to today's copy of another
ends up with a page that does not start.

    python3 scripts/serve.py [port] [directory]
"""

import functools
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(Handler, directory=directory)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Warung Pak Erlangga: http://localhost:{port}")
        server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
