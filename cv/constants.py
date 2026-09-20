"""Loads config/constants.yaml, the source of truth also read by
server/constants.js, so posture tuning lives in one place for both languages.
"""

from pathlib import Path

import yaml

_PATH = Path(__file__).resolve().parent.parent / "config" / "constants.yaml"
_constants = yaml.safe_load(_PATH.read_text())

CONF_THRESHOLD = _constants["posture"]["confThreshold"]
SMOOTHING_ALPHA = _constants["posture"]["smoothingAlpha"]
FORWARD_HEAD_THRESHOLD = _constants["posture"]["forwardHeadThreshold"]
