"""互換の入口。実体は detector.l0.inference（edge-l0 で L0 に移した）。既存の import を壊さない。"""

from detector.l0.inference import DeerDetector, Detection, Detector, ScriptedDetector

__all__ = ["DeerDetector", "Detection", "Detector", "ScriptedDetector"]
