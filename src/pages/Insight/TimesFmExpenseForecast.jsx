import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrainCircuit, CalendarDays, RefreshCw, TrendingUp } from "lucide-react";
import { getExpenseForecastAPI } from "../../services/apiService";

const money = (value) => `$${Number(value || 0).toLocaleString("en-CA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
})}`;

const labelFor = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
});

const accuracyLabel = (accuracy) => {
    if (!accuracy) return null;
    if (accuracy.status === "measured") {
        return accuracy.wape === null
            ? `${accuracy.evaluatedDays}-day accuracy measured`
            : `WAPE ${accuracy.wape}%`;
    }
    return `Measuring ${accuracy.evaluatedDays}/${accuracy.minimumEvaluatedDays} days`;
};

const TimesFmExpenseForecast = () => {
    const [forecast, setForecast] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const loadForecast = useCallback(async () => {
        setLoading(true);
        setError(null);
        const result = await getExpenseForecastAPI();
        if (result?.days) setForecast(result);
        else setError(result?.error || "Unable to load the forecast.");
        setLoading(false);
    }, []);

    useEffect(() => { loadForecast(); }, [loadForecast]);

    const chartDays = useMemo(() => {
        if (!forecast?.days) return [];
        return forecast.days.filter((_, index) => index % 3 === 0 || index === forecast.days.length - 1);
    }, [forecast]);
    const maxAmount = useMemo(() => Math.max(...chartDays.map((day) => day.upper || day.amount), 1), [chartDays]);
    const confidenceLevel = forecast?.confidenceLevel || 80;

    return (
        <section className="TimesFmForecast" aria-label="TimesFM expense forecast" aria-live="polite">
            <header className="TimesFmForecast_Header">
                <div>
                    <span className="TimesFmForecast_Eyebrow"><BrainCircuit aria-hidden="true" /> Forecasting</span>
                    <h2>Predicted spending</h2>
                </div>
                <button type="button" onClick={loadForecast} disabled={loading} aria-label="Refresh TimesFM forecast">
                    <RefreshCw className={loading ? "is-spinning" : ""} aria-hidden="true" />
                </button>
            </header>

            {loading && (
                <div className="TimesFmForecast_Loading">
                    <RefreshCw className="is-spinning" aria-hidden="true" />
                    <span>Preparing forecast…</span>
                </div>
            )}

            {!loading && error && (
                <div className="TimesFmForecast_Empty">
                    <strong>Forecast unavailable</strong>
                    <span>{error}</span>
                </div>
            )}

            {!loading && forecast && (
                <>
                    <div className="TimesFmForecast_Summary">
                        <div>
                            <span>Next {forecast.horizonDays} days</span>
                            <strong>{money(forecast.expectedTotal)}</strong>
                        </div>
                        <div>
                            <span>Likely total range ({confidenceLevel}%)</span>
                            <strong>{money(forecast.lowerTotal)}–{money(forecast.upperTotal)}</strong>
                        </div>
                    </div>

                    <div className="TimesFmForecast_Legend" aria-label="Forecast chart legend">
                        <span><i className="TimesFmForecast_LegendExpected" aria-hidden="true" /> Expected daily spending</span>
                        <span><i className="TimesFmForecast_LegendRange" aria-hidden="true" /> {confidenceLevel}% likely daily range</span>
                    </div>

                    <div className="TimesFmForecast_Chart" role="img" aria-label={`Predicted expenses from ${labelFor(forecast.forecastStart)} to ${labelFor(forecast.forecastEnd)}`}>
                        {chartDays.map((day, index) => {
                            const height = Math.max((day.amount / maxAmount) * 64, 3);
                            const bandHeight = Math.max(((day.upper - day.lower) / maxAmount) * 64, 3);
                            return (
                                <div className="TimesFmForecast_Column" key={day.date} title={`${labelFor(day.date)}: ${money(day.amount)} (range ${money(day.lower)}–${money(day.upper)})`}>
                                    <div className="TimesFmForecast_BarArea">
                                        <span className="TimesFmForecast_Range" style={{ height: `${bandHeight}px`, bottom: `${Math.max((day.lower / maxAmount) * 64, 0)}px` }} />
                                        <span className="TimesFmForecast_Bar" style={{ height: `${height}px` }} />
                                    </div>
                                    {(index === 0 || index === chartDays.length - 1 || index === Math.floor(chartDays.length / 2)) && <small>{labelFor(day.date)}</small>}
                                </div>
                            );
                        })}
                    </div>

                    <p className="TimesFmForecast_Explanation">
                        The range shows where spending is likely to land, not a budget limit. A wider range means recent spending has been less consistent.
                    </p>

                    <footer>
                        <span><CalendarDays aria-hidden="true" /> {forecast.historyDays} days of history</span>
                        {accuracyLabel(forecast.accuracy) && <span>{accuracyLabel(forecast.accuracy)}</span>}
                        <span><TrendingUp aria-hidden="true" /> {forecast.model}</span>
                    </footer>
                </>
            )}
        </section>
    );
};

export default TimesFmExpenseForecast;
