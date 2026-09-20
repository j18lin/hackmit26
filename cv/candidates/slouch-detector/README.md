# Slouch Detector

A real-time posture monitoring application that uses MediaPipe Pose detection to identify slouching behavior and provide visual alerts.

![Python Version](https://img.shields.io/badge/python-3.9%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Overview

This application monitors user posture in real-time by analyzing body landmarks captured through a webcam. When slouching is detected, the system displays a prominent visual alert to encourage posture correction.

## Features

- Real-time pose detection using MediaPipe Pose
- Automatic calibration based on initial sitting position
- Visual alert system for slouch detection
- Color-coded status indicators (green for good posture, red for slouching)
- Session slouch counter
- Adjustable sensitivity parameters
- Live recalibration capability
- Real-time debug information display

## How It Works

The detector uses MediaPipe's Pose detection API to track key body landmarks, specifically the nose and shoulder positions. The detection process follows three stages:

1. **Calibration**: Measures head-to-shoulder distance during the first 15 frames (approximately 0.5 seconds) to establish a baseline for normal sitting position
2. **Monitoring**: Continuously compares current measurements against the established baseline
3. **Alerting**: Displays a visual alert when the head position drops below the threshold, indicating slouching

This landmark-based approach provides more robust detection than simple eye tracking by accounting for overall upper body posture.

## Installation

### Prerequisites

- Python 3.9 or higher
- Webcam
- macOS, Windows, or Linux

### Setup

Clone the repository:

```bash
git clone https://github.com/aaronhubhachen/slouch-detector.git
cd slouch-detector
```

Install dependencies:

```bash
pip install -r requirements.txt
```

On macOS, grant camera permissions:
- Navigate to System Settings → Privacy & Security → Camera
- Enable camera access for Terminal or your terminal application

## Usage

Run the application:

```bash
python slouch_detector.py
```

### Controls

- **Calibration Phase**: Sit in your normal position for approximately 1 second while the system calibrates
- **Monitoring Phase**: Continue working while the system monitors your posture
- **Keyboard Commands**:
  - `q`: Quit application
  - `r`: Recalibrate baseline

### Interface Elements

- **Status Banner**: Displays calibration status or current posture state
- **Debug Information**: Shows real-time slouch measurement versus threshold
- **Alert Display**: Red popup indicating slouch detection
- **Session Information**: Slouch counter and available keyboard shortcuts

## Configuration

Sensitivity parameters can be adjusted in `slouch_detector.py`:

```python
detector = SlouchDetector(
    slouch_threshold=0.08,    # Detection sensitivity
    calibration_frames=15,     # Calibration duration
    alert_cooldown=1.5         # Alert interval in seconds
)
```

### Threshold Settings

- `slouch_threshold=0.05`: High sensitivity (strict monitoring)
- `slouch_threshold=0.08`: Moderate sensitivity (default)
- `slouch_threshold=0.12`: Low sensitivity (significant slouching only)

## Troubleshooting

### Camera Access Issues

**macOS**: System Settings → Privacy & Security → Camera → Enable Terminal

**Windows**: Settings → Privacy → Camera → Allow apps to access camera

**Linux**: Typically no additional permissions required

### Common Problems

**Camera not opening**
- Verify no other application is using the camera
- Check camera permissions for your terminal application

**Pose not detected**
- Ensure adequate lighting
- Position yourself fully within camera frame
- Maintain appropriate distance from camera

**False positives**
- Increase `slouch_threshold` value (0.10-0.12)
- Recalibrate using `r` key

**False negatives**
- Decrease `slouch_threshold` value (0.05-0.06)
- Recalibrate while maintaining good posture

## Technical Details

### Dependencies

- **mediapipe** (0.10.14): Pose detection and landmark tracking
- **opencv-python** (4.10.0.84): Video capture and display
- **numpy** (1.26.4): Numerical computations

### Detection Algorithm

The posture detection algorithm operates by:

1. Tracking the vertical position of the nose landmark
2. Calculating the midpoint between left and right shoulder landmarks
3. Measuring the vertical distance from nose to shoulder line (neck distance)
4. Comparing the current neck distance against calibrated baseline
5. Triggering alerts when distance exceeds the defined threshold

The calibration process uses the median of collected frames to minimize the impact of outliers and transient movements.

## Contributing

Contributions are welcome. Please feel free to:

- Report bugs via GitHub issues
- Suggest features through pull requests
- Submit code improvements

## License

This project is licensed under the MIT License. See LICENSE file for details.

## Acknowledgments

- [MediaPipe](https://google.github.io/mediapipe/) by Google
- [OpenCV](https://opencv.org/)

---

**Disclaimer**: This tool is designed as a posture awareness aid and is not a medical device. Users with chronic posture-related issues should consult appropriate healthcare professionals.
