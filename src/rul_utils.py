"""
rul_utils.py - Cac ham dung chung cho toan bo do an (notebook + app).

Y tuong: moi buoc xu ly du lieu chi viet mot lan o day, de notebook huan luyen
va app trien khai xu ly du lieu giong nhau (tranh lech giua train va deploy).
"""
import json

import numpy as np
import pandas as pd

# Cau truc du lieu C-MAPSS (26 cot, khong co dong tieu de)
INDEX_COLS = ["unit", "cycle"]                        # so may, chu ky van hanh
SETTING_COLS = ["setting_1", "setting_2", "setting_3"]  # 3 thong so van hanh
SENSOR_COLS = [f"s_{i}" for i in range(1, 22)]        # 21 cam bien
ALL_COLS = INDEX_COLS + SETTING_COLS + SENSOR_COLS

# Ten va y nghia 21 cam bien (Bang 2 - Saxena et al., PHM 2008)
SENSOR_INFO = {
    "s_1": ("T2", "Nhiệt độ tại cửa vào quạt (fan inlet)", "°R"),
    "s_2": ("T24", "Nhiệt độ tại cửa ra LPC", "°R"),
    "s_3": ("T30", "Nhiệt độ tại cửa ra HPC", "°R"),
    "s_4": ("T50", "Nhiệt độ tại cửa ra LPT", "°R"),
    "s_5": ("P2", "Áp suất tại cửa vào quạt", "psia"),
    "s_6": ("P15", "Áp suất tổng trong ống bypass", "psia"),
    "s_7": ("P30", "Áp suất tổng tại cửa ra HPC", "psia"),
    "s_8": ("Nf", "Tốc độ quay vật lý của quạt", "rpm"),
    "s_9": ("Nc", "Tốc độ quay vật lý của lõi", "rpm"),
    "s_10": ("epr", "Tỉ số áp suất động cơ (P50/P2)", "--"),
    "s_11": ("Ps30", "Áp suất tĩnh tại cửa ra HPC", "psia"),
    "s_12": ("phi", "Tỉ số lưu lượng nhiên liệu / Ps30", "pps/psi"),
    "s_13": ("NRf", "Tốc độ quạt hiệu chỉnh", "rpm"),
    "s_14": ("NRc", "Tốc độ lõi hiệu chỉnh", "rpm"),
    "s_15": ("BPR", "Tỉ số bypass", "--"),
    "s_16": ("farB", "Tỉ lệ nhiên liệu / không khí buồng đốt", "--"),
    "s_17": ("htBleed", "Enthalpy khí trích (bleed)", "--"),
    "s_18": ("Nf_dmd", "Tốc độ quạt yêu cầu", "rpm"),
    "s_19": ("PCNfR_dmd", "Tốc độ quạt hiệu chỉnh yêu cầu", "rpm"),
    "s_20": ("W31", "Lưu lượng khí làm mát HPT", "lbm/s"),
    "s_21": ("W32", "Lưu lượng khí làm mát LPT", "lbm/s"),
}

# Cac hang so cua bai toan
RUL_CAP = 125        # gioi han tren cua nhan RUL (piecewise-linear, Heimes 2008)
ROLL_WINDOW = 30     # cua so truot (so chu ky) de lam min nhieu cam bien
SEQ_LEN = 30         # do dai chuoi dau vao cho LSTM
ALERT_CRITICAL = 30  # RUL <= 30 chu ky: nguy cap
ALERT_WARNING = 60   # RUL <= 60 chu ky: canh bao
RANDOM_STATE = 42


# Doc du lieu
def load_cmapss(path):
    """Doc 1 file train_FDxxx.txt / test_FDxxx.txt thanh DataFrame 26 cot."""
    df = pd.read_csv(path, sep=r"\s+", header=None, names=ALL_COLS)
    return df


def load_rul(path):
    """Doc file RUL_FDxxx.txt: moi dong la RUL that cua 1 dong co trong tap test."""
    rul = pd.read_csv(path, sep=r"\s+", header=None, names=["RUL"])
    rul["unit"] = np.arange(1, len(rul) + 1)
    return rul[["unit", "RUL"]]


# Tao nhan RUL
def add_train_rul(df, cap=RUL_CAP):
    """Tap train chay den khi hong -> RUL = chu ky cuoi - chu ky hien tai."""
    df = df.copy()
    max_cycle = df.groupby("unit")["cycle"].transform("max")
    df["RUL_raw"] = max_cycle - df["cycle"]
    df["RUL"] = df["RUL_raw"].clip(upper=cap)   # gioi han tren = cap
    return df


def add_test_rul(df, rul_end, cap=RUL_CAP):
    """Tap test dung truoc khi hong -> RUL = RUL cuoi (file RUL) + so chu ky con lai."""
    df = df.merge(rul_end.rename(columns={"RUL": "RUL_end"}), on="unit", how="left")
    max_cycle = df.groupby("unit")["cycle"].transform("max")
    df["RUL_raw"] = df["RUL_end"] + (max_cycle - df["cycle"])
    df["RUL"] = df["RUL_raw"].clip(upper=cap)
    return df.drop(columns="RUL_end")


# Chuan bi dac trung (dung chung cho train / test / app)
def prepare_features(df, sensors, scaler, window=ROLL_WINDOW):
    """
    Bien du lieu tho thanh bang dac trung cho mo hinh.

    Cac buoc (giong het notebook 02):
      1. Missing value : dien theo gia tri gan nhat truoc do cua cung dong co
                         (forward-fill), neu van thieu thi dien nguoc (back-fill).
      2. Scaling       : MinMaxScaler da fit tren tap train -> ve khoang [0, 1].
      3. Feature eng.  : trung binh truot (mean) va do lech chuan truot (std)
                         theo tung dong co, cua so `window` chu ky.

    Tra ve DataFrame gom: unit, cycle, cac cot dac trung (va RUL neu co).
    """
    df = df.sort_values(INDEX_COLS).reset_index(drop=True)
    out = df[INDEX_COLS].copy()

    # 1. Missing value: chi dung thong tin qua khu cua chinh dong co do
    x = df.groupby("unit")[sensors].ffill()
    x = x.fillna(df.groupby("unit")[sensors].bfill())

    # 2. Scaling
    x = pd.DataFrame(scaler.transform(x), columns=sensors, index=df.index)
    out[sensors] = x

    # 3. Feature engineering: rolling mean / rolling std theo tung dong co
    grouped = x.groupby(df["unit"])
    roll_mean = grouped.rolling(window, min_periods=1).mean().reset_index(level=0, drop=True)
    roll_std = grouped.rolling(window, min_periods=2).std().reset_index(level=0, drop=True)
    out[[f"{s}_mean" for s in sensors]] = roll_mean[sensors].values
    out[[f"{s}_std" for s in sensors]] = roll_std[sensors].fillna(0).values

    for col in ["RUL", "RUL_raw"]:
        if col in df.columns:
            out[col] = df[col].values
    return out


def feature_names(sensors):
    """Danh sach ten cot dac trung dua vao mo hinh (theo dung thu tu)."""
    return sensors + [f"{s}_mean" for s in sensors] + [f"{s}_std" for s in sensors]


def make_sequences(df, sensors, seq_len=SEQ_LEN, last_only=False):
    """
    Cat du lieu thanh cac chuoi dai `seq_len` chu ky cho LSTM.
    X: (so mau, seq_len, so cam bien)   y: RUL tai chu ky cuoi cua moi chuoi.
    last_only=True: chi lay chuoi cuoi cung cua moi dong co (dung khi test).
    """
    X, y, units = [], [], []
    for unit, g in df.groupby("unit"):
        values = g[sensors].values
        target = g["RUL"].values if "RUL" in g.columns else np.zeros(len(g))
        if len(g) < seq_len:      # dong co chua du du lieu -> bo qua
            continue
        starts = [len(g) - seq_len] if last_only else range(len(g) - seq_len + 1)
        for i in starts:
            X.append(values[i:i + seq_len])
            y.append(target[i + seq_len - 1])
            units.append(unit)
    return np.array(X, dtype="float32"), np.array(y, dtype="float32"), np.array(units)


# Chi so danh gia
def nasa_score(y_true, y_pred):
    """
    Ham diem cua cuoc thi PHM08 (Saxena et al., 2008). Cang nho cang tot.
    Du doan muon (d > 0, tuc bao con nhieu hon thuc te) bi phat nang hon du doan som,
    vi bao muon co the dan toi hong may truoc khi kip bao tri.
    """
    d = np.asarray(y_pred) - np.asarray(y_true)
    score = np.where(d < 0, np.exp(-d / 13) - 1, np.exp(d / 10) - 1)
    return float(score.sum())


def regression_metrics(y_true, y_pred):
    """MAE, RMSE, R2 va NASA score."""
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    err = y_pred - y_true
    ss_res = float((err ** 2).sum())
    ss_tot = float(((y_true - y_true.mean()) ** 2).sum())
    return {
        "MAE": float(np.abs(err).mean()),
        "RMSE": float(np.sqrt((err ** 2).mean())),
        "R2": 1 - ss_res / ss_tot,
        "NASA_score": nasa_score(y_true, y_pred),
    }


# Ho tro ra quyet dinh (Decision Support)
def health_status(rul, critical=ALERT_CRITICAL, warning=ALERT_WARNING):
    """Doi RUL du doan thanh trang thai suc khoe."""
    if pd.isna(rul):
        return "NO_DATA"
    if rul <= critical:
        return "CRITICAL"
    if rul <= warning:
        return "WARNING"
    return "HEALTHY"


RECOMMENDED_ACTION = {
    "CRITICAL": "Lên lịch bảo trì ngay trong đợt dừng máy gần nhất; không giao thêm nhiệm vụ dài.",
    "WARNING": "Đưa vào kế hoạch bảo trì sắp tới; đặt trước phụ tùng và nhân lực; tăng tần suất theo dõi.",
    "HEALTHY": "Tiếp tục vận hành bình thường; theo dõi định kỳ.",
    "NO_DATA": "Chưa đủ 30 chu kỳ dữ liệu để dự đoán; tiếp tục thu thập dữ liệu.",
}


# Doc / ghi cau hinh
def save_json(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# Du doan RUL cho moi chu ky cua moi dong co (dung trong danh gia + app)
def predict_tabular(model, feat_df, features, cap=RUL_CAP):
    """Linear Regression / Random Forest: moi dong (chu ky) la 1 mau."""
    pred = model.predict(feat_df[features])
    return pd.Series(np.clip(pred, 0, cap), index=feat_df.index)


def predict_lstm(model, feat_df, sensors, seq_len=SEQ_LEN, cap=RUL_CAP):
    """
    LSTM: moi du doan can `seq_len` chu ky gan nhat.
    Cac chu ky dau (chua du `seq_len` chu ky lich su) tra ve NaN.
    """
    pred = pd.Series(np.nan, index=feat_df.index)
    X, idx = [], []
    for _, g in feat_df.groupby("unit"):
        values = g[sensors].values
        for i in range(seq_len - 1, len(g)):
            X.append(values[i - seq_len + 1:i + 1])
            idx.append(g.index[i])
    if X:
        y = model.predict(np.array(X, dtype="float32"), batch_size=512, verbose=0).ravel()
        pred.loc[idx] = np.clip(y, 0, cap)
    return pred


# Bieu do: dung chung mot bo mau cho toan bo do an
MODEL_COLORS = {
    "Baseline (mean)": "#8a8a85",
    "Linear Regression": "#2a78d6",
    "Random Forest": "#eb6834",
    "LSTM": "#1baf7a",
}
STATUS_COLORS = {"HEALTHY": "#0ca30c", "WARNING": "#fab219", "CRITICAL": "#d03b3b"}
INK = "#1f2a37"      # mau chu / duong chinh
MUTED = "#6b7280"    # mau phu
BLUE = "#2a78d6"


def set_plot_style():
    """Thiet lap giao dien matplotlib gon, de doc, dung cho moi notebook."""
    import matplotlib.pyplot as plt
    plt.rcParams.update({
        "figure.dpi": 110, "savefig.dpi": 200, "savefig.bbox": "tight",
        "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "bold",
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.edgecolor": "#c9ced6", "axes.labelcolor": INK, "text.color": INK,
        "xtick.color": MUTED, "ytick.color": MUTED,
        "axes.grid": True, "grid.color": "#e8ebef", "grid.linewidth": 0.8,
        "legend.frameon": False, "lines.linewidth": 2,
    })


def add_panel_labels(fig, axes, labels, gap=0.012):
    """Ghi chu thich phu (a), (b), ... ngay duoi tung o hinh, thay cho tieu de trong hinh."""
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    inv = fig.transFigure.inverted()
    for ax, label in zip(axes, labels):
        box = ax.get_tightbbox(renderer).transformed(inv)
        pos = ax.get_position()
        fig.text((pos.x0 + pos.x1) / 2, box.y0 - gap, label, ha="center", va="top", fontsize=10.5, color=INK)


def save_fig(fig, name, folder="reports/figures"):
    """Luu hinh vao reports/figures de chen vao bao cao."""
    import os
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    fig.savefig(path)
    print("Da luu hinh:", path)
