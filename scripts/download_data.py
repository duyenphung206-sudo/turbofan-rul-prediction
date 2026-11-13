"""
download_data.py - Tai bo du lieu C-MAPSS tu kho du lieu CHINH THUC cua NASA
va giai nen cac file can dung vao thu muc data/raw/.

Cach dung (dung tai thu muc goc cua project):
    python scripts/download_data.py                 # tu tai tu may chu NASA
    python scripts/download_data.py --zip duong_dan_file.zip   # dung file .zip da tai bang trinh duyet

Nguon: NASA Prognostics Center of Excellence Data Repository
https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/pcoe/pcoe-data-set-repository/
"""
import argparse
import io
import os
import urllib.request
import zipfile

NASA_URL = "https://phm-datasets.s3.amazonaws.com/NASA/6.+Turbofan+Engine+Degradation+Simulation+Data+Set.zip"
NEEDED = ["train_FD001.txt", "test_FD001.txt", "RUL_FD001.txt", "test_FD002.txt", "RUL_FD002.txt"]
OUT_DIR = os.path.join("data", "raw")


def extract_needed(zip_bytes, found):
    """Tim cac file can dung trong file zip (ke ca file zip long ben trong)."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for name in z.namelist():
            base = os.path.basename(name)
            if base in NEEDED:
                found[base] = z.read(name)
            elif name.lower().endswith(".zip"):
                extract_needed(z.read(name), found)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", help="Duong dan toi file .zip da tai san (neu khong tu tai duoc)")
    args = parser.parse_args()

    if args.zip:
        print("Doc file:", args.zip)
        with open(args.zip, "rb") as f:
            data = f.read()
    else:
        print("Dang tai tu NASA:", NASA_URL)
        data = urllib.request.urlopen(NASA_URL, timeout=120).read()
    print(f"Kich thuoc file zip: {len(data) / 1e6:.1f} MB")

    found = {}
    extract_needed(data, found)
    missing = [n for n in NEEDED if n not in found]
    if missing:
        raise SystemExit(f"Khong tim thay trong file zip: {missing}")

    os.makedirs(OUT_DIR, exist_ok=True)
    for name in NEEDED:
        path = os.path.join(OUT_DIR, name)
        new = found[name].replace(b"\r\n", b"\n")
        status = "moi"
        if os.path.exists(path):
            old = open(path, "rb").read().replace(b"\r\n", b"\n")
            status = "GIONG HET file dang co" if old == new else "KHAC file dang co -> da ghi de"
        with open(path, "wb") as f:
            f.write(new)
        print(f"  {name}: {len(new) / 1e6:.2f} MB ({status})")
    print("Xong. Du lieu nam trong", OUT_DIR)


if __name__ == "__main__":
    main()
