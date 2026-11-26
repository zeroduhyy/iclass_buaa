/**
 * Class times are Beijing time (UTC+8, no daylight saving). This computer may use another
 * time zone (e.g. Tokyo), so "today" and the current time come from here.
 */
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's Beijing date as a local Date at midnight, for calendar arithmetic. */
export const chinaToday = (): Date => {
    const shifted = new Date(Date.now() + CHINA_OFFSET_MS);
    return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
};

