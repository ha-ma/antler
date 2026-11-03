"""生成した pydantic モデルの共通の基底クラス（手書き）。

JSON Schema から作るモデルは `scripts/generate_models.py` が `--base-class` でこれを指す。
Zod・jsonschema と判定を揃えるため、NaN と Infinity を数として受け付けない
（JSON にも書けない値。Python の標準の `json.dumps` は書けてしまう）。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
