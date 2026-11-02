"""Exercise the production Nginx configuration with a local fixture upstream.

Requires nginx, openssl and Python 3. No application services or data are used.
Run: python3 srcs/angular/tests/nginx-rate-limit.test.py
"""

import concurrent.futures
import http.client
import http.server
import json
import pathlib
import re
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"path": self.path}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class RateLimitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="nginx-rate-limit-")
        cls.addClassCleanup(cls.tmp.cleanup)
        root = pathlib.Path(cls.tmp.name)
        cls.backend = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        cls.addClassCleanup(cls.backend.server_close)
        threading.Thread(target=cls.backend.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.backend.shutdown)
        cls.port = free_port()
        redirect_port = free_port()
        cert, key = root / "cert.pem", root / "key.pem"
        subprocess.run([
            "openssl", "req", "-x509", "-nodes", "-newkey", "rsa:2048",
            "-keyout", str(key), "-out", str(cert), "-days", "1",
            "-subj", "/CN=localhost",
        ], check=True, capture_output=True)
        config = (pathlib.Path(__file__).resolve().parents[1] / "conf/nginx.conf").read_text()
        # Change only fixture plumbing; production locations, maps and limits
        # are exercised verbatim, including shared zones across two workers.
        config = re.sub(r"^user .*?;", "", config, flags=re.M)
        config = config.replace("worker_processes auto;", "worker_processes 2;")
        config = config.replace("/run/nginx.pid", str(root / "nginx.pid"))
        config = config.replace("/etc/nginx/ssl/inception.crt", str(cert))
        config = config.replace("/etc/nginx/ssl/inception.key", str(key))
        config = config.replace("/var/log/nginx/access.log", str(root / "access.log"))
        config = config.replace("/var/log/nginx/error.log", str(root / "error.log"))
        config = config.replace("listen 443 ssl;", f"listen 127.0.0.1:{cls.port} ssl;")
        config = config.replace("listen 80;", f"listen 127.0.0.1:{redirect_port};")
        config = config.replace("${APPPORT}", str(cls.port))
        config = config.replace("http://nestjs:3000", f"http://127.0.0.1:{cls.backend.server_port}")
        config = config.replace("http://grafana:3000", f"http://127.0.0.1:{cls.backend.server_port}")
        cls.config = root / "nginx.conf"
        cls.config.write_text(config)
        subprocess.run(["nginx", "-t", "-c", str(cls.config)], check=True)
        cls.nginx = subprocess.Popen(["nginx", "-c", str(cls.config), "-g", "daemon off;"])
        def stop():
            cls.nginx.terminate()
            cls.nginx.wait(timeout=10)
        cls.addClassCleanup(stop)
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=0.1):
                    return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError("Nginx did not start")

    def call(self, path, ip, headers=None):
        conn = http.client.HTTPSConnection(
            "127.0.0.1", self.port, timeout=5,
            context=ssl._create_unverified_context(), source_address=(ip, 0),
        )
        try:
            conn.request("GET", path, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), json.loads(response.read())
        finally:
            conn.close()

    def test_auth_budget_is_shared_across_endpoints_and_cannot_be_spoofed(self):
        paths = ["login", "register", "2fa/verify", "verify-email", "resend-verification",
                 "oauth/google", "oauth/github/callback", "oauth/google/link", "oauth/exchange"]
        results = [self.call(f"/api/v1/auth/{paths[i % len(paths)]}", "127.0.0.2") for i in range(12)]
        self.assertEqual([result[0] for result in results[:11]], [200] * 11)
        self.assertEqual(results[11][0], 429)
        for path in ["/api/v1/auth/login?attempt=new", "/api//v1/auth/LOGIN/", "/api/v1/auth/%6cogin"]:
            status, headers, body = self.call(path, "127.0.0.2", {"X-Forwarded-For": "198.51.100.9", "X-Real-IP": "198.51.100.10"})
            self.assertEqual(status, 429)
            self.assertEqual(headers["Retry-After"], "6")
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertEqual(body["code"], "TOO_MANY_REQUESTS")
        self.assertEqual(self.call("/api/v1/auth/login", "127.0.0.3")[0], 200)
        self.assertEqual(self.call("/api/v1/health", "127.0.0.2")[0], 200)
        self.assertEqual(self.call("/api/v1/auth/refresh", "127.0.0.2")[0], 200)

    def test_general_api_budget_and_forwarding(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(lambda _: self.call("/api/v1/users/search?q=alice", "127.0.0.4"), range(100)))
        self.assertIn(200, [result[0] for result in results])
        self.assertIn(429, [result[0] for result in results])
        for status, _, body in results:
            self.assertIn(status, [200, 429])
            if status == 200:
                self.assertEqual(body["path"], "/v1/users/search?q=alice")
        self.assertEqual(self.call("/api/v1/health", "127.0.0.5")[0], 200)

    def test_auth_budget_recovers_after_retry_after(self):
        results = [self.call("/api/v1/auth/login", "127.0.0.6")[0] for _ in range(12)]
        self.assertEqual(results[-1], 429)
        time.sleep(6.1)
        self.assertEqual(self.call("/api/v1/auth/login", "127.0.0.6")[0], 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
