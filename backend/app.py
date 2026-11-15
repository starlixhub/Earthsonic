"""
backend/app.py
EARTHSONIC Flask Application Entry Point.
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"
"""

import os
import sys
import socket
from flask import Flask, jsonify, request, send_from_directory

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.config import Config  # noqa: E402
from backend.routes.datasets import datasets_bp  # noqa: E402
from backend.routes.sonification import sonification_bp  # noqa: E402
from backend.routes.comparison import comparison_bp  # noqa: E402
from backend.routes.layers import layers_bp  # noqa: E402


def is_production():
    """Detect whether app is running in production, including Railway deployment."""
    return bool(
        os.environ.get("DEPLOY_ENV", "").lower() == "production"
        or os.environ.get("RAILWAY_ENVIRONMENT_NAME")
        or os.environ.get("RAILWAY_ENVIRONMENT")
        or os.environ.get("RAILWAY_PUBLIC_DOMAIN")
        or os.environ.get("PUBLIC_URL")
    )


def get_primary_lan_ip():
    """
    Discover primary LAN IP address using UDP connect trick to 8.8.8.8:80.
    Queries the OS routing table without transmitting data across the internet.
    Returns None on failure or if offline.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and ip != "0.0.0.0":
            return ip
    except Exception:
        pass
    return None


def create_app(config_class=Config):
    """Flask application factory."""
    app = Flask(
        __name__,
        static_folder=os.path.join(PROJECT_ROOT, "frontend"),
        static_url_path=""
    )
    app.config.from_object(config_class)

    # Ensure audio cache directory exists
    os.makedirs(app.config["AUDIO_CACHE_DIR"], exist_ok=True)

    # Register API Blueprints
    app.register_blueprint(datasets_bp)
    app.register_blueprint(sonification_bp)
    app.register_blueprint(comparison_bp)
    app.register_blueprint(layers_bp)

    # Enable CORS headers for all responses
    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
        return response

    # Global Error Handlers
    @app.errorhandler(404)
    def not_found(error):
        return jsonify({
            "error": "Not Found",
            "message": "The requested resource was not found on this server.",
            "status_code": 404
        }), 404

    @app.errorhandler(500)
    def internal_error(error):
        return jsonify({
            "error": "Internal Server Error",
            "message": "An unexpected error occurred processing your request.",
            "status_code": 500
        }), 500

    @app.route("/api/vr-launch-info", methods=["GET"])
    def vr_launch_info():
        """
        Return the mobile VR launch URL.
        When running in production or on Railway (or when PUBLIC_URL is configured),
        returns the public HTTPS URL so mobile QR scanning connects immediately.
        When DEPLOY_ENV is unset or development, uses host machine's primary LAN IP.
        """
        public_domain = (
            os.environ.get("PUBLIC_URL")
            or os.environ.get("RAILWAY_PUBLIC_DOMAIN")
            or os.environ.get("RAILWAY_STATIC_URL")
        )
        if public_domain:
            domain = public_domain.strip().rstrip("/")
            if not domain.startswith("http://") and not domain.startswith("https://"):
                domain = f"https://{domain}"
            return jsonify({"vr_url": f"{domain}/?vr=1"}), 200

        if is_production():
            public_host = request.headers.get("X-Forwarded-Host") or request.host
            if public_host and not any(h in public_host for h in ("localhost", "127.0.0.1", "0.0.0.0")):
                proto = request.headers.get("X-Forwarded-Proto") or ("https" if request.is_secure else "https")
                return jsonify({"vr_url": f"{proto}://{public_host}/?vr=1"}), 200
            return jsonify({"vr_url": "https://earthsonic.up.railway.app/?vr=1"}), 200

        lan_ip = get_primary_lan_ip()
        host_header = request.host or ""
        if ":" in host_header:
            req_host, _, req_port = host_header.partition(":")
        else:
            req_host = host_header
            req_port = request.environ.get("SERVER_PORT") or os.environ.get("PORT", "5000")

        if not lan_ip:
            if req_host and req_host not in ("0.0.0.0", ""):
                lan_ip = req_host
            else:
                lan_ip = "127.0.0.1"

        port = req_port if req_port else os.environ.get("PORT", "5000")
        vr_url = f"http://{lan_ip}:{port}/?vr=1"
        return jsonify({"vr_url": vr_url}), 200

    @app.route("/api")
    def api_index():
        return jsonify({
            "application": "EARTHSONIC API",
            "version": "1.0.0",
            "description": "NASA Space Apps Challenge 2026 - Authentic Earth Science Observation & Sonification Engine",
            "endpoints": [
                "/api/health",
                "/api/datasets",
                "/api/datasets/<dataset_id>",
                "/api/timeseries/<dataset_id>",
                "/api/timeseries/harmonized",
                "/api/timeseries/zonal",
                "/api/sonify/<dataset_id>",
                "/api/sonify/orchestra",
                "/api/sonify/differential",
                "/api/comparison",
                "/api/sonification/explanations",
                "/api/vr-launch-info"
            ],
            "layer_endpoints": [
                "/api/layers",
                "/api/layers/<layer_id>",
                "/api/layers/<layer_id>/sonify"
            ]
        }), 200

    @app.route("/")
    def index():
        frontend_index = os.path.join(PROJECT_ROOT, "frontend", "index.html")
        if os.path.exists(frontend_index):
            return send_from_directory(os.path.join(PROJECT_ROOT, "frontend"), "index.html")
        return jsonify({
            "application": "EARTHSONIC",
            "status": "online",
            "api_docs": "/api",
            "health": "/api/health"
        }), 200

    @app.route("/landing/")
    @app.route("/landing/<path:filename>")
    def landing(filename="index.html"):
        landing_dir = os.path.join(PROJECT_ROOT, "landing")
        if not filename or filename.endswith("/"):
            filename = "index.html"
        return send_from_directory(landing_dir, filename)

    @app.route("/frontend/<path:filename>")
    def frontend_static_assets(filename):
        return send_from_directory(os.path.join(PROJECT_ROOT, "frontend"), filename)

    # ------------------------------------------------------------------------
    # DEV-ONLY visual-verification capture sink (opt-in via env var). Never
    # active in normal operation. Accepts a base64 image upload so an agent
    # can persist a WebGL frame for inspection without filesystem access in
    # the browser context.
    if os.environ.get("EARTHSONIC_DEV_CAPTURE") == "1":
        import base64 as _b64

        @app.route("/api/dev/visual-capture", methods=["POST"])
        def dev_visual_capture():
            try:
                payload = request.get_json(force=True, silent=True) or {}
                name = str(payload.get("name", "capture"))[:64]
                data_url = str(payload.get("data_url", ""))
                if "," in data_url:
                    data_url = data_url.split(",", 1)[1]
                raw = _b64.b64decode(data_url)
                if not raw or len(raw) > 10 * 1024 * 1024:
                    return jsonify({"ok": False, "error": "bad payload"}), 400
                capture_dir = os.path.join(PROJECT_ROOT, ".dev_visual_captures")
                os.makedirs(capture_dir, exist_ok=True)
                # strip any extension tricks out of the name
                safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_")
                out_path = os.path.join(capture_dir, safe + ".png")
                with open(out_path, "wb") as f:
                    f.write(raw)
                return jsonify({"ok": True, "path": out_path}), 200
            except Exception as exc:  # noqa: BLE001
                return jsonify({"ok": False, "error": str(exc)}), 500

    return app


# Default application instance
app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
