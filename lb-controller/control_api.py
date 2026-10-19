import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from runtime import BalancerRuntime

logger = logging.getLogger("lb-controller.api")


def create_control_server(port: int, runtime: BalancerRuntime) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/api/algorithms":
                self._send_json(200, runtime.get_configuration())
                return
            self._send_json(404, {"error": "not found"})

        def _read_json(self) -> dict:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 4096:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(content_length))
            if not isinstance(payload, dict):
                raise ValueError("request body must be an object")
            return payload

        def do_POST(self) -> None:
            if self.path not in ("/api/algorithm", "/api/learning"):
                self._send_json(404, {"error": "not found"})
                return
            try:
                payload = self._read_json()
                if self.path == "/api/learning":
                    enabled = payload.get("enabled")
                    if not isinstance(enabled, bool):
                        raise ValueError("enabled must be a boolean")
                    result = runtime.set_learning_enabled(enabled)
                else:
                    algorithm = payload.get("algorithm")
                    if not isinstance(algorithm, str):
                        raise ValueError("algorithm must be a string")
                    result = runtime.set_algorithm(algorithm)
            except (ValueError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            except Exception:
                logger.exception("Failed to handle %s", self.path)
                self._send_json(500, {"error": "request failed"})
                return

            self._send_json(200, result)

        def log_message(self, format_string: str, *args) -> None:
            logger.info("%s - %s", self.address_string(), format_string % args)

    return ThreadingHTTPServer(("0.0.0.0", port), Handler)