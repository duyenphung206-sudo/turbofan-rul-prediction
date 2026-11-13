"""Kiem thu nhanh cac ham cot loi. Chay:  python -m pytest -q"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.rul_utils import add_train_rul, health_status, make_sequences, nasa_score, regression_metrics


def _toy():
    """2 dong co gia lap: dong co 1 song 5 chu ky, dong co 2 song 3 chu ky."""
    return pd.DataFrame({"unit": [1] * 5 + [2] * 3, "cycle": [1, 2, 3, 4, 5, 1, 2, 3], "s_2": np.arange(8.0)})


def test_rul_label_counts_down_to_zero_and_is_capped():
    df = add_train_rul(_toy(), cap=3)
    assert df.loc[df["unit"] == 1, "RUL_raw"].tolist() == [4, 3, 2, 1, 0]
    assert df.loc[df["unit"] == 1, "RUL"].tolist() == [3, 3, 2, 1, 0]


def test_nasa_score_penalizes_late_prediction_more_than_early():
    late = nasa_score([50], [60])     # du doan muon 10 chu ky
    early = nasa_score([50], [40])    # du doan som 10 chu ky
    assert late > early > 0
    assert nasa_score([50], [50]) == 0


def test_regression_metrics_perfect_prediction():
    m = regression_metrics([10, 20, 30], [10, 20, 30])
    assert m["MAE"] == 0 and m["RMSE"] == 0 and m["R2"] == 1


def test_health_status_thresholds():
    assert [health_status(r) for r in [10, 30, 31, 60, 61]] == ["CRITICAL", "CRITICAL", "WARNING", "WARNING", "HEALTHY"]
    assert health_status(float("nan")) == "NO_DATA"


def test_sequences_never_mix_two_engines():
    df = add_train_rul(_toy())
    X, y, units = make_sequences(df, ["s_2"], seq_len=3)
    assert X.shape == (4, 3, 1)            # dong co 1: 3 chuoi, dong co 2: 1 chuoi
    assert units.tolist() == [1, 1, 1, 2]
    assert y.tolist() == [2, 1, 0, 0]      # RUL tai chu ky cuoi cua moi chuoi
