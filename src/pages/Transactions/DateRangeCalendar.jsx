import React, { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseTransactionCalendarDate } from "../../utils/transactionDate";

const valueOf = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const validCalendarDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseTransactionCalendarDate(value);
  return !Number.isNaN(date.getTime()) && valueOf(date) === value;
};

export default function DateRangeCalendar({ start, end, onChange, onComplete, invalid, errorId }) {
  const initial = validCalendarDate(start) ? parseTransactionCalendarDate(start) : new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [endpoint, setEndpoint] = useState(start && !end ? "end" : "start");
  const [mode, setMode] = useState("range");
  const calendarRef = useRef(null);
  const today = valueOf(new Date());
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const select = value => {
    if (mode === "day") {
      onChange(value, value);
      onComplete?.();
      return;
    }
    if (endpoint === "start") {
      onChange(value, end && value > end ? "" : end);
      setEndpoint("end");
    } else {
      if (validCalendarDate(start) && value < start) onChange(value, start);
      else onChange(validCalendarDate(start) ? start : value, value);
      setEndpoint("start");
      onComplete?.();
    }
  };
  const moveFocus = (event, day) => {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = new Date(month.getFullYear(), month.getMonth(), day + offsets[event.key]);
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    }
    requestAnimationFrame(() => calendarRef.current?.querySelector(`[data-date="${valueOf(next)}"]`)?.focus());
  };
  return (
    <div className="date-range-calendar">
      <div className="date-range-mode" role="group" aria-label="Date selection mode">
        <button type="button" aria-pressed={mode === "day"} onClick={() => setMode("day")}>Single day</button>
        <button type="button" aria-pressed={mode === "range"} onClick={() => { setMode("range"); setEndpoint("start"); }}>Date range</button>
      </div>
      <div className={`transaction-search-dates ${mode === "day" ? "single-day" : ""}`}>
        {(mode === "day" ? [{ key: "start", label: "Date", value: start }] : [{ key: "start", label: "From", value: start }, { key: "end", label: "To", value: end }]).map(item => (
          <label key={item.key} className={endpoint === item.key ? "is-active" : ""}>
            <span className="transaction-search-label">{item.label}</span>
            <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" aria-label={item.label}
              value={item.value} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
              onFocus={() => setEndpoint(item.key)}
              onChange={event => {
                const value = event.target.value;
                onChange(mode === "day" || item.key === "start" ? value : start, mode === "day" || item.key === "end" ? value : end);
                if (validCalendarDate(value)) {
                  const date = parseTransactionCalendarDate(value);
                  setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                }
              }} />
          </label>
        ))}
      </div>
      <div className="date-range-calendar-nav">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} aria-hidden="true" /></button>
        <span aria-live="polite">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      <p className="date-range-calendar-hint" role="status">{mode === "day" ? "Select a day" : endpoint === "start" ? "Select a start date" : "Select an end date"}</p>
      <div className="date-range-calendar-grid" ref={calendarRef} role="group" aria-label="Choose date range">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`weekday-${index}`} className="date-range-weekday" aria-hidden="true">{day}</span>)}
        {Array.from({ length: month.getDay() }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
        {Array.from({ length: count }, (_, index) => {
          const day = index + 1;
          const date = new Date(month.getFullYear(), month.getMonth(), day);
          const value = valueOf(date);
          const selected = value === start || (mode === "range" && value === end);
          return <button key={value} type="button" data-date={value}
            className={`${selected ? "is-selected" : ""} ${mode === "range" && start && end && value > start && value < end ? "in-range" : ""}`}
            aria-label={date.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}
            aria-pressed={selected} aria-current={value === today ? "date" : undefined}
            onClick={() => select(value)} onKeyDown={event => moveFocus(event, day)}>{day}</button>;
        })}
      </div>
    </div>
  );
}
