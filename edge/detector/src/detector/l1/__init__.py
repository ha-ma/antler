"""L1: Mac mini 上の local-jev（jev 互換）に 4 問を聞く（edge-l1）。

校正後 0.9 以上のときだけ降格に使う。

赤は L0 が鳴らす。L1 が無い・止まっている・遅いときは L0 だけで動く。
"""

from detector.l1.runner import start_l1

__all__ = ["start_l1"]
