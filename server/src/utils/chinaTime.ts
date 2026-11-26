/**
 * Class times are Beijing time (UTC+8, no daylight saving). The computer running this app
 * may be set to another time zone (e.g. Tokyo), so all schedule math goes through here.
 */
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Beijing calendar date `offsetDays` from today, as YYYY-MM-DD. */
export const chinaDate = (offsetDays = 0, nowMs: number = Date.now()): string => {
    const shifted = new Date(nowMs + CHINA_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};

/** Epoch ms of a Beijing wall-clock time (date YYYY-MM-DD, time HH:mm). */
export const chinaTimeToMs = (date: string, time: string): number | null => {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date).trim());
    const t = /^(\d{1,2}):(\d{2})/.exec(String(time).trim());
    if (!d || !t) {
        return null;
    }
    const ms = Date.parse(`${d[1]}-${d[2]}-${d[3]}T${pad(Number(t[1]))}:${t[2]}:00+08:00`);
    return Number.isNaN(ms) ? null : ms;
};

/** Formats epoch ms as Beijing "MM-DD HH:mm". */
export const formatChinaTime = (ms: number): string => {
    const shifted = new Date(ms + CHINA_OFFSET_MS);
    return `${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
};
