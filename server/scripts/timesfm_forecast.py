#!/usr/bin/env python3
"""Run a single TimesFM 2.5 forecast from JSON supplied on stdin.

This stays deliberately small: the Node API owns authentication and data access,
while this process only receives an already-aggregated daily series.
"""

import json
import sys


def fail(code, message):
    print(json.dumps({"ok": False, "code": code, "message": message}))
    sys.exit(1)


def main():
    try:
        request = json.load(sys.stdin)
        values = request["values"]
        horizon = int(request.get("horizon", 30))
        if not isinstance(values, list) or len(values) < 14:
            fail("INSUFFICIENT_HISTORY", "At least 14 daily observations are required.")
        if horizon < 1 or horizon > 90:
            fail("INVALID_HORIZON", "Forecast horizon must be between 1 and 90 days.")

        import numpy as np
        import torch
        import timesfm

        torch.set_float32_matmul_precision("high")
        model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
            "google/timesfm-2.5-200m-pytorch"
        )
        model.compile(timesfm.ForecastConfig(
            max_context=min(len(values), 1024),
            max_horizon=horizon,
            normalize_inputs=True,
            use_continuous_quantile_head=True,
            force_flip_invariance=True,
            infer_is_positive=True,
            fix_quantile_crossing=True,
        ))
        point, quantiles = model.forecast(
            horizon=horizon,
            inputs=[np.asarray(values, dtype=np.float32)],
        )

        point_values = np.maximum(np.asarray(point[0], dtype=float), 0)
        quantile_values = np.asarray(quantiles[0], dtype=float)
        # The API exposes multiple quantile levels. Calculating the 10th/90th
        # percentile from the returned levels remains compatible with releases
        # that include a mean value alongside the quantile columns.
        lower = np.maximum(np.percentile(quantile_values, 10, axis=1), 0)
        upper = np.maximum(np.percentile(quantile_values, 90, axis=1), lower)
        print(json.dumps({
            "ok": True,
            "forecast": [round(float(value), 2) for value in point_values],
            "lower": [round(float(value), 2) for value in lower],
            "upper": [round(float(value), 2) for value in upper],
            "model": "TimesFM 2.5 (200M)",
        }))
    except ImportError:
        fail("TIMESFM_NOT_INSTALLED", "TimesFM is not installed for the configured Python runtime.")
    except Exception as error:
        fail("TIMESFM_FAILED", str(error)[:300])


if __name__ == "__main__":
    main()
