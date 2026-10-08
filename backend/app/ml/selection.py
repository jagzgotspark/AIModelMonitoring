SELECTION_METRICS = {
    "classification": ("f1", True),
    "regression": ("rmse", False),
}


def select_best_model_version(model_versions, task_type: str | None):
    """Return the model version with the best selection metric, or None if none can be ranked."""
    if task_type not in SELECTION_METRICS:
        return None
    metric, higher_is_better = SELECTION_METRICS[task_type]

    scored = [
        mv for mv in model_versions
        if isinstance((mv.metrics or {}).get(metric), (int, float))
    ]
    if not scored:
        return None
    sign = 1 if higher_is_better else -1
    return max(scored, key=lambda mv: sign * mv.metrics[metric])
