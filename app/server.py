"""
server.py - May chu cua app Engine Health (Buoc 7 Deployment + Buoc 8 Monitoring).

Luong xu ly:  Data (cam bien)  ->  AI (du doan RUL)  ->  Decision (canh bao + khuyen nghi)
Chay (tai thu muc goc project):   python app/server.py     -> tu mo trinh duyet o http://127.0.0.1:8000

May chu chi lam 3 viec: doc du lieu + du doan RUL bang mo hinh, tinh do lech cam bien,
luu quyet dinh cua ky su. Moi chu hien thi tren man hinh nam trong app/static/app.js.
"""
import io
import sys
import threading
import webbrowser
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from src.rul_utils import (  # noqa: E402
    ALL_COLS, INDEX_COLS, SENSOR_INFO, SEQ_LEN, add_test_rul, health_status, load_cmapss, load_json, load_rul,
    predict_lstm, predict_tabular, prepare_features,
)

STATIC = ROOT / "app" / "static"
FEEDBACK_FILE = ROOT / "app" / "feedback_log.csv"
FEEDBACK_COLS = ["thoi_gian", "dong_co", "chu_ky", "rul_du_doan", "trang_thai", "quyet_dinh", "nguoi_xac_nhan", "ghi_chu"]
DECISIONS = ["Đồng ý khuyến nghị", "Hoãn", "Bác bỏ khuyến nghị"]
LOCK = threading.Lock()
UPLOAD_LIMIT_MB = 20
OUT_OF_RANGE_LIMIT = 0.05      # qua 5% so do nam ngoai vung da huan luyen -> khong tra ket qua
SAMPLES = {"fd001": "sample_fd001_3_engines.txt", "fd002": "sample_fd002_drift_3_engines.txt"}


# Nap mo hinh va du lieu (chay mot lan khi khoi dong)
CONFIG = load_json(ROOT / "models" / "feature_config.json")
METRICS = load_json(ROOT / "reports" / "metrics.json")
SCALER = joblib.load(ROOT / "models" / "scaler.joblib")
SENSORS = CONFIG["sensors"]
try:
    from tensorflow import keras
    MODEL_NAME, MODEL = "LSTM", keras.models.load_model(ROOT / "models" / "lstm.keras")
except Exception:  # may chua cai TensorFlow -> dung mo hinh du phong
    MODEL_NAME, MODEL = "Random Forest", joblib.load(ROOT / "models" / "random_forest.joblib")


def score(raw):
    """Data -> AI: chuan bi dac trung va du doan RUL cho moi chu ky."""
    feat = prepare_features(raw, SENSORS, SCALER)
    if MODEL_NAME == "LSTM":
        feat["pred"] = predict_lstm(MODEL, feat, SENSORS)
    else:
        feat["pred"] = predict_tabular(MODEL, feat, CONFIG["features"])
    return feat


# Doi dong co dang van hanh = 100 dong co tap test FD001 (mo phong du lieu tu nha may)
RAW = add_test_rul(load_cmapss(ROOT / "data" / "raw" / "test_FD001.txt"), load_rul(ROOT / "data" / "raw" / "RUL_FD001.txt"))
FLEET = score(RAW)
HEALTHY_MEAN = pd.Series(CONFIG["healthy_mean"])
HEALTHY_STD = pd.Series(CONFIG["healthy_std"])
# Do lech cua tung cam bien so voi trang thai khoe, tinh theo so lan do lech chuan
for s in SENSORS:
    FLEET[f"{s}_z"] = (FLEET[f"{s}_mean"] - HEALTHY_MEAN[s]) / HEALTHY_STD[s]
TRAIN_MIN = pd.Series(CONFIG["train_raw_min"])
TRAIN_MAX = pd.Series(CONFIG["train_raw_max"])
LAST_BATCH = {}                # ket qua kiem tra lo du lieu moi gan nhat, trang Mo hinh dung de giam sat
# Sai so dien hinh theo giai doan cua mo hinh dang chay (LSTM hoac Random Forest du phong)
STAGE_KEYS = {"CRITICAL": "RUL 0-30 (nguy cap)", "WARNING": "RUL 31-60 (canh bao)", "HEALTHY": "RUL 61-125 (khoe)"}
TYPICAL_ERROR = {k: round(METRICS["mae_by_health_stage_test"][MODEL_NAME][v], 1) for k, v in STAGE_KEYS.items()}
SENSOR_META = {s: {"code": SENSOR_INFO[s][0], "name": SENSOR_INFO[s][1], "unit": SENSOR_INFO[s][2]} for s in SENSORS}


# Nhat ky quyet dinh cua ky su
def read_decisions():
    if not FEEDBACK_FILE.exists():
        return pd.DataFrame(columns=FEEDBACK_COLS)
    return pd.read_csv(FEEDBACK_FILE).fillna("")


class DecisionIn(BaseModel):
    unit: int
    decision: str
    engineer: str
    reason: str = ""
    critical: int = 30
    warning: int = 60


# API
app = FastAPI(title="Engine Health")


def nums(series, digits=1):
    """Chuyen cot so thanh list; NaN -> None (JSON khong co NaN)."""
    return [None if pd.isna(v) else round(float(v), digits) for v in series]


@app.get("/api/fleet")
def api_fleet():
    """Trang thai hien tai cua 100 dong co = du doan tai chu ky cuoi cung da ghi nhan."""
    last = FLEET.groupby("unit").tail(1).sort_values("pred")
    log = read_decisions().sort_values("thoi_gian").groupby("dong_co").tail(1).set_index("dong_co")["quyet_dinh"].to_dict()
    rows = []
    for r in last.itertuples():
        z = pd.Series({s: getattr(r, f"{s}_z") for s in SENSORS})
        top = z.abs().idxmax()
        rows.append({
            "unit": int(r.unit), "cycle": int(r.cycle), "rul": round(float(r.pred), 1),
            "sensor": SENSOR_META[top]["code"], "sensor_name": SENSOR_META[top]["name"], "z": round(float(z[top]), 1),
            "decision": log.get(int(r.unit), ""),
        })
    return {"model": MODEL_NAME, "rows": rows, "typical_error": TYPICAL_ERROR}


@app.get("/api/engine/{unit}")
def api_engine(unit: int):
    """Lich su RUL du doan + do lech cam bien theo tung chu ky cua mot dong co."""
    eng = FLEET[(FLEET["unit"] == unit) & FLEET["pred"].notna()].sort_values("cycle")
    if eng.empty:
        raise HTTPException(404, "Không có động cơ này trong đội máy.")
    log = read_decisions()
    log = log[log["dong_co"] == unit].sort_values("thoi_gian", ascending=False)
    return {
        "unit": unit, "model": MODEL_NAME, "typical_error": TYPICAL_ERROR,
        "cycles": eng["cycle"].astype(int).tolist(),
        "rul": nums(eng["pred"]), "rul_true": nums(eng["RUL"]),
        "sensors": SENSOR_META,
        "z": {s: nums(eng[f"{s}_z"], 2) for s in SENSORS},
        "mean": {s: nums(eng[f"{s}_mean"], 3) for s in SENSORS},
        "history": log.to_dict("records"),
    }


@app.post("/api/decision")
def api_decision(body: DecisionIn):
    """Luu quyet dinh cua ky su (human-in-the-loop). Quyet dinh ap dung cho chu ky cuoi cung."""
    if body.decision not in DECISIONS:
        raise HTTPException(400, "Chọn một quyết định hợp lệ.")
    if not body.engineer.strip():
        raise HTTPException(400, "Nhập tên người xác nhận trước khi lưu.")
    if body.decision == "Bác bỏ khuyến nghị" and not body.reason.strip():
        raise HTTPException(400, "Nhập lý do khi bác bỏ khuyến nghị.")
    eng = FLEET[(FLEET["unit"] == body.unit)].sort_values("cycle")
    if eng.empty:
        raise HTTPException(404, "Không có động cơ này trong đội máy.")
    now = eng.iloc[-1]
    row = pd.DataFrame([{
        "thoi_gian": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "dong_co": body.unit, "chu_ky": int(now["cycle"]),
        "rul_du_doan": round(float(now["pred"]), 1), "trang_thai": health_status(now["pred"], body.critical, body.warning),
        "quyet_dinh": body.decision, "nguoi_xac_nhan": body.engineer.strip(), "ghi_chu": body.reason.strip(),
    }])
    with LOCK:
        row.to_csv(FEEDBACK_FILE, mode="a", header=not FEEDBACK_FILE.exists(), index=False)
    return {"ok": True}


def out_of_range(raw):
    """Ti le so do nam ngoai khoang [min, max] cua tap train, chung va theo tung cam bien."""
    x = raw[SENSORS]
    mask = (x < TRAIN_MIN[SENSORS]) | (x > TRAIN_MAX[SENSORS])
    valid = x.notna()
    per = (mask & valid).sum() / valid.sum().clip(lower=1)
    total = float((mask & valid).values.sum() / max(int(valid.values.sum()), 1))
    return total, per


def drift_rows(per):
    return sorted(({"sensor": SENSOR_META[s]["code"], "name": SENSOR_META[s]["name"], "share": round(float(per[s]), 4)} for s in SENSORS),
                  key=lambda r: -r["share"])


def last_rows(feat):
    """RUL du doan va cam bien lech nhieu nhat tai chu ky cuoi cua moi dong co."""
    rows = []
    for unit, g in feat.groupby("unit"):
        r = g.iloc[-1]
        z = pd.Series({s: (r[f"{s}_mean"] - HEALTHY_MEAN[s]) / HEALTHY_STD[s] for s in SENSORS})
        top = z.abs().idxmax()
        rows.append({
            "unit": int(unit), "cycle": int(r["cycle"]), "rul": None if pd.isna(r["pred"]) else round(float(r["pred"]), 1),
            "sensor": SENSOR_META[top]["code"], "sensor_name": SENSOR_META[top]["name"], "z": round(float(z[top]), 1),
        })
    return sorted(rows, key=lambda r: (r["rul"] is None, r["rul"] or 0))


def read_table(content):
    """Doc file .txt (cach nhau boi khoang trang) hoac .csv: 26 cot so, co the co dong tieu de."""
    text = content.decode("utf-8-sig", errors="replace").strip()
    if not text:
        raise HTTPException(400, "File không có dữ liệu. Chọn file có ít nhất một dòng số đo.")
    first = text.splitlines()[0]
    sep = "," if "," in first else (";" if ";" in first else r"\s+")
    try:
        df = pd.read_csv(io.StringIO(text), sep=sep, header=None, engine="python")
    except Exception:
        raise HTTPException(400, "Không đọc được file. Cần file .txt hoặc .csv, mỗi dòng 26 giá trị số.")
    if df.shape[1] != len(ALL_COLS):
        raise HTTPException(400, f"File có {df.shape[1]} cột, cần đúng 26 cột: số động cơ, chu kỳ, 3 thông số vận hành, 21 cảm biến.")
    if pd.to_numeric(df.iloc[0], errors="coerce").isna().all():
        df = df.iloc[1:]                       # bo dong tieu de
    df.columns = ALL_COLS
    df = df.apply(pd.to_numeric, errors="coerce")
    if df[INDEX_COLS].isna().any().any():
        raise HTTPException(400, "Cột số động cơ hoặc chu kỳ có ô trống hay không phải số. Kiểm tra hai cột đầu của file.")
    if df.empty:
        raise HTTPException(400, "File không có dữ liệu. Chọn file có ít nhất một dòng số đo.")
    df[INDEX_COLS] = df[INDEX_COLS].astype(int)
    return df.sort_values(INDEX_COLS).reset_index(drop=True)


def analyze(raw, name):
    """Kiem tra chat luong lo du lieu moi, roi du doan RUL neu du lieu nam trong vung da huan luyen."""
    n_units, n_rows = int(raw["unit"].nunique()), len(raw)
    missing = float(raw[SENSORS].isna().values.mean())
    gaps = int(raw.groupby("unit")["cycle"].apply(lambda c: (c.diff().dropna() != 1).sum()).sum())
    lengths = raw.groupby("unit")["cycle"].size()
    short = sorted(int(u) for u in lengths[lengths < SEQ_LEN].index)
    share, per = out_of_range(raw)
    blocked = share > OUT_OF_RANGE_LIMIT
    checks = [
        {"key": "format", "status": "ok", "value": f"{n_rows} dòng, {n_units} động cơ"},
        {"key": "missing", "status": "ok" if missing == 0 else "warn", "value": round(missing, 4)},
        {"key": "gaps", "status": "ok" if gaps == 0 else "warn", "value": gaps},
        {"key": "length", "status": "ok" if not short else "warn", "value": short},
        {"key": "range", "status": "fail" if blocked else "ok", "value": round(share, 4)},
    ]
    rows = [] if blocked else last_rows(score(raw))
    LAST_BATCH.clear()
    LAST_BATCH.update({"file": name, "time": datetime.now().strftime("%Y-%m-%d %H:%M"), "share": share, "per": per, "blocked": blocked})
    return {"file": name, "n_units": n_units, "n_rows": n_rows, "checks": checks, "blocked": blocked,
            "limit": OUT_OF_RANGE_LIMIT, "drift": drift_rows(per)[:6], "rows": rows, "model": MODEL_NAME, "typical_error": TYPICAL_ERROR}


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    """Data: nhan file cam bien moi, kiem tra roi du doan."""
    content = await file.read()
    if len(content) > UPLOAD_LIMIT_MB * 1024 * 1024:
        raise HTTPException(400, f"File lớn hơn {UPLOAD_LIMIT_MB} MB. Tách file theo nhóm động cơ rồi tải lên từng phần.")
    return analyze(read_table(content), file.filename or "du_lieu_moi.txt")


@app.post("/api/sample/{key}")
def api_sample(key: str):
    """Hai file mau: 3 dong co FD001 (cung dieu kien) va 3 dong co FD002 (dieu kien van hanh khac)."""
    if key not in SAMPLES:
        raise HTTPException(404, "Không có file mẫu này.")
    path = ROOT / "data" / "sample" / SAMPLES[key]
    return analyze(read_table(path.read_bytes()), SAMPLES[key])


@app.get("/api/model")
def api_model():
    """Monitoring: 4 quy tac giam sat tinh tren du lieu hien tai, va ket qua nghiem thu tu Notebook 04."""
    last = FLEET.groupby("unit").tail(1)
    err = last["pred"] - last["RUL"]
    rmse, mae = float(np.sqrt((err ** 2).mean())), float(err.abs().mean())
    actual, alert = last["RUL"] <= 30, last["pred"] <= 30
    recall = float((actual & alert).sum() / max(int(actual.sum()), 1))
    log = read_decisions()
    n_dec = len(log)
    reject = float((log["quyet_dinh"] == "Bác bỏ khuyến nghị").mean()) if n_dec else 0.0
    fleet_share, fleet_per = out_of_range(RAW)
    if LAST_BATCH:
        src, share, per = {"kind": "upload", "file": LAST_BATCH["file"], "time": LAST_BATCH["time"]}, LAST_BATCH["share"], LAST_BATCH["per"]
    else:
        src, share, per = {"kind": "fleet"}, fleet_share, fleet_per
    rules = [
        {"key": "drift", "value": round(share, 4), "limit": OUT_OF_RANGE_LIMIT, "status": "fail" if share > OUT_OF_RANGE_LIMIT else "ok", "source": src},
        {"key": "rmse", "value": round(rmse, 2), "mae": round(mae, 2), "limit": 20, "status": "fail" if rmse > 20 else "ok", "n": int(len(last))},
        {"key": "recall", "value": round(recall, 3), "limit": 0.8, "status": "fail" if recall < 0.8 else "ok", "n": int(actual.sum())},
        {"key": "reject", "value": round(reject, 3), "limit": 0.3, "n": n_dec,
         "status": "na" if n_dec < 5 else ("fail" if reject > 0.3 else "ok")},
    ]
    m = METRICS
    names = list(m["model_level_test"].keys())
    compare = [{
        "model": k, **{x: round(m["model_level_test"][k][x], 3) for x in ["MAE", "RMSE", "R2", "NASA_score"]},
        "recall": m["system_alert_test"].get(k, {}).get("Recall"), "false_alarm": m["system_alert_test"].get(k, {}).get("False_alarm_rate"),
        "latency_ms": m["system_cost"].get(k, {}).get("latency_ms"),
    } for k in names]
    return {
        "model": MODEL_NAME, "final_model": m["final_model"], "rules": rules, "drift": drift_rows(per),
        "decisions": log.sort_values("thoi_gian", ascending=False).head(50).to_dict("records"),
        "acceptance": m["acceptance"], "compare": compare,
        "policy": m["maintenance_policy_simulation"], "assumptions": m["policy_assumptions"],
        "robustness": m["robustness_rmse"], "out_of_range_share": m["out_of_range_share"],
        "typical_error": TYPICAL_ERROR, "stage_mae": m["mae_by_health_stage_test"],
    }



# Giao dien (file tinh), dat sau API de /api khong bi che
@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/", StaticFiles(directory=STATIC), name="static")

if __name__ == "__main__":
    threading.Timer(1.5, lambda: webbrowser.open("http://127.0.0.1:8000")).start()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
