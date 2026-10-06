import numpy as np
import pandas as pd
from scipy.stats import ks_2samp

PSI_DRIFT_THRESHOLD = 0.2
KS_PVALUE_THRESHOLD = 0.05
# With large samples the KS p-value is significant for negligible shifts, so also
# require a minimum effect size (the KS statistic) before flagging drift.
KS_STATISTIC_THRESHOLD = 0.1


def _population_stability_index(expected: np.ndarray, actual: np.ndarray, buckets: int = 10) -> float:
    breakpoints = np.quantile(expected, np.linspace(0, 1, buckets + 1))
    breakpoints[0] = -np.inf
    breakpoints[-1] = np.inf
    breakpoints = np.unique(breakpoints)
    if len(breakpoints) < 3:
        return 0.0

    expected_counts, _ = np.histogram(expected, bins=breakpoints)
    actual_counts, _ = np.histogram(actual, bins=breakpoints)

    expected_pct = expected_counts / max(len(expected), 1)
    actual_pct = actual_counts / max(len(actual), 1)

    expected_pct = np.where(expected_pct == 0, 1e-4, expected_pct)
    actual_pct = np.where(actual_pct == 0, 1e-4, actual_pct)

    psi = np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct))
    return float(psi)


def detect_drift(reference_df: pd.DataFrame, incoming_df: pd.DataFrame, feature_columns: list[str]) -> dict:
    feature_drift = {}
    drift_scores = []

    for col in feature_columns:
        if col not in incoming_df.columns:
            continue
        ref_col = reference_df[col]
        if pd.api.types.is_numeric_dtype(ref_col) and not pd.api.types.is_bool_dtype(ref_col):
            # Incoming JSON records can carry blanks or stray strings; coerce them to NaN.
            ref_vals = ref_col.dropna().to_numpy(dtype=float)
            new_vals = pd.to_numeric(incoming_df[col], errors="coerce").dropna().to_numpy(dtype=float)
            if len(ref_vals) < 2 or len(new_vals) < 2:
                continue
            psi = _population_stability_index(ref_vals, new_vals)
            ks_stat, p_value = ks_2samp(ref_vals, new_vals)
            ks_drifted = p_value < KS_PVALUE_THRESHOLD and ks_stat > KS_STATISTIC_THRESHOLD
            is_drifted = bool(psi > PSI_DRIFT_THRESHOLD or ks_drifted)
            feature_drift[col] = {
                "psi": psi,
                "ks_statistic": float(ks_stat),
                "p_value": float(p_value),
                "is_drifted": is_drifted,
            }
            drift_scores.append(psi)
        else:
            # Compare as strings so e.g. bool True in the reference matches "True" from a CSV upload.
            ref_dist = ref_col.dropna().astype(str).value_counts(normalize=True)
            new_dist = incoming_df[col].dropna().astype(str).value_counts(normalize=True)
            if ref_dist.empty or new_dist.empty:
                continue
            categories = set(ref_dist.index) | set(new_dist.index)
            expected_pct = np.array([ref_dist.get(c, 1e-4) for c in categories])
            actual_pct = np.array([new_dist.get(c, 1e-4) for c in categories])
            psi = float(np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct)))
            is_drifted = bool(abs(psi) > PSI_DRIFT_THRESHOLD)
            feature_drift[col] = {"psi": psi, "is_drifted": is_drifted}
            drift_scores.append(abs(psi))

    overall_drift_score = float(np.mean(drift_scores)) if drift_scores else 0.0
    # The mean PSI dilutes a single badly drifted feature when there are many features,
    # so the batch is also flagged when any individual feature has drifted.
    any_feature_drifted = any(f["is_drifted"] for f in feature_drift.values())
    is_drifted = bool(overall_drift_score > PSI_DRIFT_THRESHOLD or any_feature_drifted)

    return {
        "overall_drift_score": overall_drift_score,
        "is_drifted": is_drifted,
        "feature_drift": feature_drift,
    }
