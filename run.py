#!/usr/bin/env python3
"""
run.py
Production entry point for EARTHSONIC.
"""

import os
from backend.app import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Starting EARTHSONIC server at http://{host}:{port}")
    app.run(host=host, port=port, debug=False)
