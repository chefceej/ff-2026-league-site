"""Put src/ on the import path so the pure modules import without the package
layout ceremony; fetch_data.py itself is never imported (it needs espn_api)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))
