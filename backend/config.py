"""
backend/config.py
Configuration settings for EARTHSONIC backend server.
"""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
RAW_DATA_DIR = os.path.join(DATA_DIR, "raw")
PROCESSED_DATA_DIR = os.path.join(DATA_DIR, "processed")
AUDIO_CACHE_DIR = os.path.join(BASE_DIR, "backend", "cache", "audio")


class Config:
    DEBUG = False
    TESTING = False
    BASE_DIR = BASE_DIR
    DATA_DIR = DATA_DIR
    RAW_DATA_DIR = RAW_DATA_DIR
    PROCESSED_DATA_DIR = PROCESSED_DATA_DIR
    AUDIO_CACHE_DIR = AUDIO_CACHE_DIR

    # Processed JSON paths
    HARMONIZED_PATH = os.path.join(PROCESSED_DATA_DIR, "earthsonic_monthly_harmonized.json")
    ANNUAL_HARMONIZED_PATH = os.path.join(PROCESSED_DATA_DIR, "earthsonic_annual_harmonized.json")
    ZONAL_PATH = os.path.join(PROCESSED_DATA_DIR, "zonal_temperature_annual.json")
    METADATA_PATH = os.path.join(PROCESSED_DATA_DIR, "metadata.json")
    CHECKSUM_PATH = os.path.join(DATA_DIR, "checksums.sha256")


class TestingConfig(Config):
    TESTING = True
    DEBUG = True
