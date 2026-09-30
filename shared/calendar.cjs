// Reports use the calendar date supplied by the bank, independent of the
// device/server timezone. An offset-qualified timestamp still represents an
// instant for chronological ordering; it does not change its statement date.
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function parseTimestamp(value) {
    if (typeof value !== 'string') return null;
    const match = TIMESTAMP.exec(value);
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
    const year = Number(yearText);
    const month = Number(monthText) - 1;
    const day = Number(dayText);
    if (year < 1000 || month < 0 || month > 11 || day < 1 || day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) return null;
    const hour = Number(hourText || 0);
    const minute = Number(minuteText || 0);
    const second = Number(secondText || 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
    if (offset && offset !== 'Z') {
        const offsetHour = Number(offset.slice(1, 3));
        const offsetMinute = Number(offset.slice(4, 6));
        if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
    }
    return { year, month, day, hour, minute, second };
}

function validMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1000;
}

function calendarDate(value) {
    const parts = parseTimestamp(value);
    return parts ? String(value).slice(0, 10) : null;
}

function addCalendarDays(value, days) {
    const parts = parseTimestamp(value);
    if (!parts || !Number.isInteger(days)) throw new Error('Invalid calendar date or day offset');
    const date = new Date(Date.UTC(parts.year, parts.month, parts.day + days));
    return date.toISOString().slice(0, 10);
}

module.exports = { parseTimestamp, validMonth, calendarDate, addCalendarDays };
