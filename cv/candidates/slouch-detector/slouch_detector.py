"""
Slouch Detector using MediaPipe Pose
Detects slouching by monitoring head and shoulder positions

Author: aaronhubhachen
Version: 1.0.0
"""

import cv2
import mediapipe as mp
import numpy as np
from typing import Optional, Tuple
import time


class SlouchDetector:
    def __init__(
        self,
        slouch_threshold: float = 0.08,
        calibration_frames: int = 15,
        alert_cooldown: float = 1.5
    ):
        """
        Initialize the slouch detector.
        
        Args:
            slouch_threshold: Distance threshold for slouching detection (normalized)
            calibration_frames: Number of frames to use for calibration
            alert_cooldown: Seconds between slouch alerts
        """
        self.mp_pose = mp.solutions.pose
        self.mp_drawing = mp.solutions.drawing_utils
        self.pose = self.mp_pose.Pose(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        self.slouch_threshold = slouch_threshold
        self.calibration_frames = calibration_frames
        self.alert_cooldown = alert_cooldown
        
        # Calibration
        self.is_calibrated = False
        self.calibration_data = []
        self.baseline_neck_to_shoulder_distance = None
        
        # State
        self.last_alert_time = 0
        self.slouch_count = 0
        self.current_neck_distance = None
        
    def calculate_distance(self, point1, point2) -> float:
        """Calculate Euclidean distance between two points."""
        return np.sqrt((point1.x - point2.x)**2 + (point1.y - point2.y)**2)
    
    def get_posture_metrics(self, landmarks) -> Optional[Tuple[float, float]]:
        """
        Extract posture metrics from pose landmarks.
        
        Returns:
            Tuple of (neck_height, shoulder_alignment) or None if landmarks unavailable
        """
        try:
            # Get key landmarks
            nose = landmarks[self.mp_pose.PoseLandmark.NOSE.value]
            left_shoulder = landmarks[self.mp_pose.PoseLandmark.LEFT_SHOULDER.value]
            right_shoulder = landmarks[self.mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
            
            # Calculate shoulder midpoint
            shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2
            
            # Calculate vertical distance from nose to shoulder line (neck length proxy)
            neck_to_shoulder_distance = nose.y - shoulder_mid_y
            
            # Calculate shoulder alignment (for detecting forward lean)
            shoulder_alignment = abs(left_shoulder.z - right_shoulder.z)
            
            return neck_to_shoulder_distance, shoulder_alignment
            
        except Exception as e:
            print(f"Error calculating posture metrics: {e}")
            return None
    
    def calibrate(self, landmarks) -> bool:
        """
        Calibrate the detector with the user's good posture.
        
        Returns:
            True if calibration is complete
        """
        metrics = self.get_posture_metrics(landmarks)
        if metrics is None:
            return False
        
        neck_distance, _ = metrics
        self.calibration_data.append(neck_distance)
        
        if len(self.calibration_data) >= self.calibration_frames:
            # Use median to avoid outliers
            self.baseline_neck_to_shoulder_distance = np.median(self.calibration_data)
            self.is_calibrated = True
            print(f"Calibration complete! Baseline: {self.baseline_neck_to_shoulder_distance:.4f}")
            return True
        
        return False
    
    def detect_slouch(self, landmarks) -> bool:
        """
        Detect if the user is slouching.
        
        Returns:
            True if slouching is detected
        """
        if not self.is_calibrated:
            return False
        
        metrics = self.get_posture_metrics(landmarks)
        if metrics is None:
            return False
        
        neck_distance, _ = metrics
        self.current_neck_distance = neck_distance
        
        # Slouching occurs when head drops (neck distance becomes more positive/larger)
        # because y increases downward in the coordinate system
        slouch_amount = neck_distance - self.baseline_neck_to_shoulder_distance
        
        is_slouching = slouch_amount > self.slouch_threshold
        
        if is_slouching:
            current_time = time.time()
            if current_time - self.last_alert_time > self.alert_cooldown:
                self.slouch_count += 1
                self.last_alert_time = current_time
        
        return is_slouching
    
    def draw_status(self, frame, landmarks, is_slouching: bool) -> np.ndarray:
        """
        Draw posture status on the frame.
        
        Args:
            frame: Video frame
            landmarks: Pose landmarks
            is_slouching: Whether slouching is detected
            
        Returns:
            Annotated frame
        """
        # Draw pose landmarks
        self.mp_drawing.draw_landmarks(
            frame,
            landmarks,
            self.mp_pose.POSE_CONNECTIONS,
            self.mp_drawing.DrawingSpec(color=(0, 255, 0), thickness=2, circle_radius=2),
            self.mp_drawing.DrawingSpec(color=(0, 255, 255), thickness=2, circle_radius=2)
        )
        
        # Status text
        height, width = frame.shape[:2]
        
        # BIG POPUP ALERT FOR SLOUCHING
        if is_slouching and self.is_calibrated:
            # Create semi-transparent red overlay
            overlay = frame.copy()
            
            # Calculate popup dimensions (centered, large box)
            popup_width = int(width * 0.8)
            popup_height = int(height * 0.4)
            popup_x = (width - popup_width) // 2
            popup_y = (height - popup_height) // 2
            
            # Draw red background with border
            cv2.rectangle(overlay, 
                         (popup_x, popup_y), 
                         (popup_x + popup_width, popup_y + popup_height), 
                         (0, 0, 200), -1)  # Filled red rectangle
            cv2.rectangle(frame, 
                         (popup_x, popup_y), 
                         (popup_x + popup_width, popup_y + popup_height), 
                         (0, 0, 255), 8)  # Red border
            
            # Blend overlay with original frame for transparency effect
            alpha = 0.85
            frame = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)
            
            # Draw big warning text
            warning_text = "STOP SLOUCHING!"
            font_scale = 3.0
            thickness = 10
            
            # Get text size to center it
            (text_width, text_height), baseline = cv2.getTextSize(warning_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
            text_x = (width - text_width) // 2
            text_y = (height + text_height) // 2 - 20
            
            # Draw text with shadow for better visibility
            cv2.putText(frame, warning_text, (text_x + 5, text_y + 5), cv2.FONT_HERSHEY_SIMPLEX, 
                       font_scale, (0, 0, 0), thickness, cv2.LINE_AA)  # Shadow
            cv2.putText(frame, warning_text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, 
                       font_scale, (255, 255, 255), thickness, cv2.LINE_AA)  # White text
            
            # Add smaller instruction text
            instruction_text = "SIT UP STRAIGHT!"
            font_scale_small = 1.5
            thickness_small = 5
            (inst_width, inst_height), _ = cv2.getTextSize(instruction_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale_small, thickness_small)
            inst_x = (width - inst_width) // 2
            inst_y = text_y + 80
            
            cv2.putText(frame, instruction_text, (inst_x + 3, inst_y + 3), cv2.FONT_HERSHEY_SIMPLEX, 
                       font_scale_small, (0, 0, 0), thickness_small, cv2.LINE_AA)  # Shadow
            cv2.putText(frame, instruction_text, (inst_x, inst_y), cv2.FONT_HERSHEY_SIMPLEX, 
                       font_scale_small, (255, 255, 0), thickness_small, cv2.LINE_AA)  # Yellow text
        
        if not self.is_calibrated:
            progress = len(self.calibration_data)
            text = f"CALIBRATING: {progress}/{self.calibration_frames} - HOLD YOUR NORMAL POSITION!"
            color = (0, 255, 255)  # Yellow
        elif is_slouching:
            text = "SLOUCHING DETECTED! SIT UP STRAIGHT"
            color = (0, 0, 255)  # Red
        else:
            text = "GOOD POSTURE"
            color = (0, 255, 0)  # Green
        
        # Draw status banner
        cv2.rectangle(frame, (0, 0), (width, 80), (0, 0, 0), -1)
        cv2.putText(frame, text, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 
                   0.9, color, 2, cv2.LINE_AA)
        
        # Draw debug info
        if self.is_calibrated and self.current_neck_distance is not None:
            slouch_amount = self.current_neck_distance - self.baseline_neck_to_shoulder_distance
            debug_text = f"Slouch: {slouch_amount:.3f} | Threshold: {self.slouch_threshold:.3f}"
            cv2.putText(frame, debug_text, (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 
                       0.6, (255, 255, 255), 1, cv2.LINE_AA)
        
        # Draw slouch counter and instructions
        counter_text = f"Slouch Count: {self.slouch_count}"
        cv2.putText(frame, counter_text, (10, height - 50), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        
        instructions = "Press 'r' to recalibrate | 'q' to quit"
        cv2.putText(frame, instructions, (10, height - 20), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1, cv2.LINE_AA)
        
        return frame
    
    def process_frame(self, frame: np.ndarray) -> Tuple[np.ndarray, bool]:
        """
        Process a single frame.
        
        Args:
            frame: Input video frame
            
        Returns:
            Tuple of (annotated_frame, is_slouching)
        """
        # Convert to RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Process with MediaPipe
        results = self.pose.process(rgb_frame)
        
        is_slouching = False
        
        if results.pose_landmarks:
            landmarks = results.pose_landmarks.landmark
            
            # Calibrate or detect slouch
            if not self.is_calibrated:
                self.calibrate(landmarks)
            else:
                is_slouching = self.detect_slouch(landmarks)
            
            # Draw annotations
            frame = self.draw_status(frame, results.pose_landmarks, is_slouching)
        else:
            # No pose detected
            cv2.putText(frame, "NO POSE DETECTED", (10, 40), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2, cv2.LINE_AA)
        
        return frame, is_slouching
    
    def release(self):
        """Release resources."""
        self.pose.close()


def main():
    """Main function to run the slouch detector."""
    print("Starting Slouch Detector...")
    print("Instructions:")
    print("1. Sit in your NORMAL position when the app starts (first ~1 second)")
    print("2. This position will be your baseline - any slouching below this will be detected")
    print("3. Press 'q' to quit, 'r' to recalibrate at any time")
    print("4. Watch the debug info to see your slouch amount vs threshold")
    print()
    
    # Initialize camera
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Error: Could not open camera")
        return
    
    # Set camera resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    
    detector = SlouchDetector(
        slouch_threshold=0.08,  # More sensitive - adjust if needed
        calibration_frames=15,  # Faster calibration
        alert_cooldown=1.5
    )
    
    try:
        while cap.isOpened():
            success, frame = cap.read()
            if not success:
                print("Failed to read frame from camera")
                break
            
            # Flip frame horizontally for mirror view
            frame = cv2.flip(frame, 1)
            
            # Process frame
            annotated_frame, is_slouching = detector.process_frame(frame)
            
            # Display
            cv2.imshow('Slouch Detector', annotated_frame)
            
            # Handle keyboard input
            key = cv2.waitKey(5) & 0xFF
            if key == ord('q'):
                break
            elif key == ord('r'):
                print("Recalibrating... Hold your normal (non-slouching) position!")
                detector.is_calibrated = False
                detector.calibration_data = []
                detector.slouch_count = 0
    
    finally:
        cap.release()
        cv2.destroyAllWindows()
        detector.release()
        print(f"\nSession complete. Total slouches detected: {detector.slouch_count}")


if __name__ == "__main__":
    main()

