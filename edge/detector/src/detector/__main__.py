"""`python -m detector --config edge/detector/config.toml`（edge-run）。本体は detector.app。"""

from detector.app import main

if __name__ == "__main__":
    raise SystemExit(main())
