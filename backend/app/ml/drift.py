import numpy as np
import pandas as pd
from scipy.stats import ks_2samp

PSI_DRIFT_THRESHOLD = 0.2
KS_PVALUE_THRESHOLD = 0.05


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
        if pd.api.types.is_numeric_dtype(reference_df[col]):
            ref_vals = reference_df[col].dropna().to_numpy()
            new_vals = incoming_df[col].dropna().to_numpy()
            if len(ref_vals) < 2 or len(new_vals) < 2:
                continue
            psi = _population_stability_index(ref_vals, new_vals)
            ks_stat, p_value = ks_2samp(ref_vals, new_vals)
            is_drifted = bool(psi > PSI_DRIFT_THRESHOLD or p_value < KS_PVALUE_THRESHOLD)
            feature_drift[col] = {
                "psi": psi,
                "ks_statistic": float(ks_stat),
                "p_value": float(p_value),
                "is_drifted": is_drifted,
            }
            drift_scores.append(psi)
        else:
            ref_dist = reference_df[col].value_counts(normalize=True)
            new_dist = incoming_df[col].value_counts(normalize=True)
            categories = set(ref_dist.index) | set(new_dist.index)
            expected_pct = np.array([ref_dist.get(c, 1e-4) for c in categories])
            actual_pct = np.array([new_dist.get(c, 1e-4) for c in categories])
            psi = float(np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct)))
            is_drifted = bool(abs(psi) > PSI_DRIFT_THRESHOLD)
            feature_drift[col] = {"psi": psi, "is_drifted": is_drifted}
            drift_scores.append(abs(psi))

    overall_drift_score = float(np.mean(drift_scores)) if drift_scores else 0.0
    is_drifted = overall_drift_score > PSI_DRIFT_THRESHOLD

    return {
        "overall_drift_score": overall_drift_score,
        "is_drifted": is_drifted,
        "feature_drift": feature_drift,
    }
