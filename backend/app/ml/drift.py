import numpy as np
import pandas as pd
from scipy.stats import ks_2samp

PSI_DRIFT_THRESHOLD = 0.2
# Industry-standard PSI bands: < 0.1 no meaningful change, 0.1-0.2 moderate, > 0.2 significant.
PSI_MODERATE_THRESHOLD = 0.1
KS_PVALUE_THRESHOLD = 0.05
# With large samples the KS p-value is significant for negligible shifts, so also
# require a minimum effect size (the KS statistic) before flagging drift.
KS_STATISTIC_THRESHOLD = 0.1
# Cap on categories returned per feature so reports stay small for high-cardinality columns.
MAX_CATEGORIES = 10


def _psi(expected_pct: np.ndarray, actual_pct: np.ndarray) -> float:
    # Empty buckets/categories would make the log blow up, so give them a tiny share.
    expected_pct = np.where(expected_pct == 0, 1e-4, expected_pct)
    actual_pct = np.where(actual_pct == 0, 1e-4, actual_pct)
    return float(np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct)))


def _quantile_buckets(expected: np.ndarray, actual: np.ndarray, buckets: int = 10):
    """Bucket both samples on the reference deciles. Returns (edges, expected_pct, actual_pct) or None."""
    breakpoints = np.quantile(expected, np.linspace(0, 1, buckets + 1))
    breakpoints[0] = -np.inf
    breakpoints[-1] = np.inf
    breakpoints = np.unique(breakpoints)
    if len(breakpoints) < 3:
        return None

    expected_counts, _ = np.histogram(expected, bins=breakpoints)
    actual_counts, _ = np.histogram(actual, bins=breakpoints)
    expected_pct = expected_counts / max(len(expected), 1)
    actual_pct = actual_counts / max(len(actual), 1)
    return breakpoints, expected_pct, actual_pct


def _population_stability_index(expected: np.ndarray, actual: np.ndarray, buckets: int = 10) -> float:
    result = _quantile_buckets(expected, actual, buckets)
    if result is None:
        return 0.0
    _, expected_pct, actual_pct = result
    return _psi(expected_pct, actual_pct)


def _severity(psi: float, is_drifted: bool) -> str:
    if is_drifted:
        return "significant"
    if psi > PSI_MODERATE_THRESHOLD:
        return "moderate"
    return "none"


def _bucket_label(lower: float, upper: float) -> str:
    if np.isinf(lower):
        return f"< {upper:.4g}"
    if np.isinf(upper):
        return f"≥ {lower:.4g}"
    return f"{lower:.4g} – {upper:.4g}"


def _numeric_summary(values: np.ndarray) -> dict:
    return {
        "mean": float(np.mean(values)),
        "median": float(np.median(values)),
        "std": float(np.std(values)),
        "min": float(np.min(values)),
        "max": float(np.max(values)),
    }


def _numeric_feature_drift(ref_col: pd.Series, new_col: pd.Series) -> dict | None:
    ref_vals = ref_col.dropna().to_numpy(dtype=float)
    new_vals = new_col.dropna().to_numpy(dtype=float)
    if len(ref_vals) < 2 or len(new_vals) < 2:
        return None

    buckets = _quantile_buckets(ref_vals, new_vals)
    psi = 0.0 if buckets is None else _psi(buckets[1], buckets[2])
    ks_stat, p_value = ks_2samp(ref_vals, new_vals)
    ks_drifted = p_value < KS_PVALUE_THRESHOLD and ks_stat > KS_STATISTIC_THRESHOLD
    is_drifted = bool(psi > PSI_DRIFT_THRESHOLD or ks_drifted)

    distribution = []
    if buckets is not None:
        edges, expected_pct, actual_pct = buckets
        distribution = [
            {
                "label": _bucket_label(edges[i], edges[i + 1]),
                "reference_pct": float(expected_pct[i]),
                "current_pct": float(actual_pct[i]),
            }
            for i in range(len(expected_pct))
        ]

    return {
        "type": "numeric",
        "psi": psi,
        "ks_statistic": float(ks_stat),
        "p_value": float(p_value),
        "is_drifted": is_drifted,
        "severity": _severity(psi, is_drifted),
        "reference": _numeric_summary(ref_vals),
        "current": _numeric_summary(new_vals),
        "reference_missing_pct": float(ref_col.isna().mean()),
        "current_missing_pct": float(new_col.isna().mean()),
        "distribution": distribution,
    }


def _categorical_feature_drift(ref_col: pd.Series, new_col: pd.Series) -> dict | None:
    # Compare as strings so e.g. bool True in the reference matches "True" from a CSV upload.
    ref_dist = ref_col.dropna().astype(str).value_counts(normalize=True)
    new_dist = new_col.dropna().astype(str).value_counts(normalize=True)
    if ref_dist.empty or new_dist.empty:
        return None

    categories = sorted(set(ref_dist.index) | set(new_dist.index))
    expected_pct = np.array([ref_dist.get(c, 0.0) for c in categories])
    actual_pct = np.array([new_dist.get(c, 0.0) for c in categories])
    psi = _psi(expected_pct, actual_pct)
    is_drifted = bool(psi > PSI_DRIFT_THRESHOLD)

    rows = [
        {"label": c, "reference_pct": float(e), "current_pct": float(a)}
        for c, e, a in zip(categories, expected_pct, actual_pct)
    ]
    # Show the categories that matter most in either sample.
    rows.sort(key=lambda r: max(r["reference_pct"], r["current_pct"]), reverse=True)

    new_categories = [r for r in rows if r["reference_pct"] == 0][:MAX_CATEGORIES]
    missing_categories = [r for r in rows if r["current_pct"] == 0][:MAX_CATEGORIES]

    return {
        "type": "categorical",
        "psi": psi,
        "is_drifted": is_drifted,
        "severity": _severity(psi, is_drifted),
        "reference_missing_pct": float(ref_col.isna().mean()),
        "current_missing_pct": float(new_col.isna().mean()),
        "reference_top": ref_dist.index[0],
        "current_top": new_dist.index[0],
        "new_categories": [r["label"] for r in new_categories],
        "missing_categories": [r["label"] for r in missing_categories],
        "distribution": rows[:MAX_CATEGORIES],
    }


def detect_drift(reference_df: pd.DataFrame, incoming_df: pd.DataFrame, feature_columns: list[str]) -> dict:
    feature_drift = {}
    drift_scores = []

    for col in feature_columns:
        if col not in incoming_df.columns:
            continue
        ref_col = reference_df[col]
        if pd.api.types.is_numeric_dtype(ref_col) and not pd.api.types.is_bool_dtype(ref_col):
            # Incoming JSON records can carry blanks or stray strings; coerce them to NaN.
            result = _numeric_feature_drift(ref_col, pd.to_numeric(incoming_df[col], errors="coerce"))
        else:
            result = _categorical_feature_drift(ref_col, incoming_df[col])
        if result is None:
            continue
        feature_drift[col] = result
        drift_scores.append(abs(result["psi"]))

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
