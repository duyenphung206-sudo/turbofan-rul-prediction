# Data

## Source

**Turbofan Engine Degradation Simulation Data Set (C-MAPSS)**, NASA Ames Prognostics Center of Excellence.

- Official repository: <https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/pcoe/pcoe-data-set-repository/> (data set no. 6)
- Official download: <https://phm-datasets.s3.amazonaws.com/NASA/6.+Turbofan+Engine+Degradation+Simulation+Data+Set.zip>

To fetch the files from NASA and verify them against the copies in this folder:

```bash
python scripts/download_data.py
```

## Citation

> A. Saxena and K. Goebel (2008). "Turbofan Engine Degradation Simulation Data Set", NASA Prognostics Data Repository, NASA Ames Research Center, Moffett Field, CA.

> A. Saxena, K. Goebel, D. Simon, and N. Eklund, "Damage propagation modeling for aircraft engine run-to-failure simulation," in *Proc. Int. Conf. Prognostics and Health Management (PHM)*, Denver, CO, USA, Oct. 2008, pp. 1-9, doi: 10.1109/PHM.2008.4711414.

## Files

| Folder | File | Content |
|---|---|---|
| `raw/` | `train_FD001.txt` | 100 engines run to failure (20,631 rows) |
| `raw/` | `test_FD001.txt` | 100 engines stopped before failure (13,096 rows) |
| `raw/` | `RUL_FD001.txt` | True RUL at the last recorded cycle of each test engine |
| `raw/` | `test_FD002.txt`, `RUL_FD002.txt` | Six operating conditions; used only for the robustness test |
| `processed/` | `train_fd001.csv.gz`, `val_fd001.csv.gz`, `test_fd001.csv.gz` | Output of `notebooks/02_data_preparation.ipynb` |
| `sample/` | `sample_fd001_3_engines.txt` | Valid upload example for the dashboard |
| `sample/` | `sample_fd002_drift_3_engines.txt` | Out-of-distribution upload example (triggers the drift warning) |

## Format

Space-separated text, 26 columns, no header: `unit`, `cycle`, `setting_1..3`, `s_1..s_21`.
One row is a snapshot of one engine after one operating cycle.
FD001 has one operating condition (sea level) and one fault mode (HPC degradation).
