#!/usr/bin/env python3
"""Dev server for what-the-ph.

Static files, never cached — this is a source tree, and a cached ES module graph
means edits silently do nothing.

Binds loopback and the Tailscale address only. Not 0.0.0.0, which would also put
the site on the LAN and on every docker bridge.

    python3 serve.py            # localhost + tailnet, port 8562
    python3 serve.py 9000       # a different port
    python3 serve.py 8562 local # loopback only
"""

import http.server
import socket
import socketserver
import subprocess
import sys
import threading


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, *args):
        pass


def tailscale_address():
    """This machine's IPv4 address on the tailnet, or None if it has none."""
    try:
        out = subprocess.run(['tailscale', 'ip', '-4'],
                             capture_output=True, text=True, timeout=3)
        lines = out.stdout.strip().splitlines()
        if lines:
            return lines[0].strip()
    except (OSError, subprocess.SubprocessError):
        pass
    # Fall back to reading the interface directly
    try:
        out = subprocess.run(['ip', '-4', '-o', 'addr', 'show', 'tailscale0'],
                             capture_output=True, text=True, timeout=3)
        for field in out.stdout.split():
            if field.count('.') == 3 and '/' in field:
                return field.split('/')[0]
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def serve_on(host, port):
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer((host, port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8562
    local_only = len(sys.argv) > 2 and sys.argv[2] == 'local'

    hosts = ['127.0.0.1']
    if not local_only:
        ts = tailscale_address()
        if ts:
            hosts.append(ts)
        else:
            print('no tailscale address found — serving on loopback only')

    bound = []
    for host in hosts:
        try:
            serve_on(host, port)
            bound.append(host)
            print(f'what-the-ph -> http://{host}:{port}/')
        except OSError as e:
            print(f'could not bind {host}:{port} — {e}')

    if len(bound) > 1:
        print(f'\nany device on the tailnet: http://{socket.gethostname()}:{port}/')

    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print('\nstopped')
