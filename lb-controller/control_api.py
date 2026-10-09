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
            if self.path != "/api/algorithms":
                self._send_json(404, {"error": "not found"})
                return
            self._send_json(200, runtime.get_configuration())

        def do_POST(self) -> None:
            if self.path != "/api/algorithm":
                self._send_json(404, {"error": "not found"})
                return
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0 or content_length > 4096:
                    raise ValueError("invalid request size")
                payload = json.loads(self.rfile.read(content_length))
                algorithm = payload.get("algorithm")
                if not isinstance(algorithm, str):
                    raise ValueError("algorithm must be a string")
                configuration = runtime.set_algorithm(algorithm)
            except (ValueError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": str(error)})
                return
            except Exception:
                logger.exception("Failed to switch balancer algorithm")
                self._send_json(500, {"error": "failed to switch balancer"})
                return

            self._send_json(200, configuration)

        def log_message(self, format_string: str, *args) -> None:
            logger.info("%s - %s", self.address_string(), format_string % args)

    return ThreadingHTTPServer(("0.0.0.0", port), Handler)