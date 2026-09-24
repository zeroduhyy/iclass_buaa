import type { Got } from 'got';
import { ICLASS_URLS } from '../config/constants';
import logger from '../utils/logger';

const parseJsonSafe = (body: unknown): any | null => {
    if (body && typeof body === 'object') {
        return body;
    }
    if (typeof body !== 'string') {
        return null;
    }
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
};

/** 时间戳来源：qr = 老师二维码自带；server = iClass 下发；local = 本机时钟兜底 */
export type SignTimestampSource = 'qr' | 'server' | 'local';

export interface SignTimestampResult {
    timestamp: number;
    source: SignTimestampSource;
    /** 成功取到时间戳的地址（source === 'server' 时有值） */
    url: string | null;
    /** 所有候选地址都失败时的原因汇总 */
    error?: string;
    /** 本机（已按 serverTimeOffset 校正）此刻的时间 */
    localNow: number;
    /** timestamp - localNow，毫秒 */
    skewMs: number | null;
}

export interface SignRequestResult {
    /** iClass 返回的 JSON（非 JSON 时给一个带 STATUS='1' 的兜底对象） */
    response: any;
    /** 最终实际提交的时间戳（毫秒） */
    timestamp: number;
    timestampSource: SignTimestampSource;
    timestampUrl: string | null;
    timestampError?: string;
    timestampSkewMs: number | null;
    /** 实际提交到 query string 的参数 */
    query: Record<string, string>;
    /** 实际提交到表单体的参数 */
    form: Record<string, string>;
    signUrl: string;
    /** 一共试了几次（二维码时间戳 + 服务端时间戳时最多 2 次） */
    attempts: number;
}

export const buildScanSignUrl = (useVpn: boolean): string =>
    ICLASS_URLS[useVpn ? 'VPN' : 'DIRECT'].SCAN_SIGN;

export const buildSignTimestampUrls = (useVpn: boolean): string[] => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    return [ICLASS_URLS[network].SIGN_TIMESTAMP, ICLASS_URLS[network].SIGN_TIMESTAMP_FALLBACK];
};

/**
 * iClass 的签到时间戳是**毫秒**。接口若某天改成秒，这里统一归一到毫秒 ——
 * 传秒会得到 ERRCODE 101（二维码已失效），所以必须归一。
 */
const normalizeTimestampUnit = (value: number): number => {
    if (value > 0 && value < 1e12) {
        logger.warn(`[sign] 时间戳 ${value} 看起来是秒级，按毫秒换算`);
        return value * 1000;
    }
    return value;
};

const extractTimestamp = (body: unknown): number | null => {
    const parsed = parseJsonSafe(body);
    const candidates = [parsed?.timestamp, parsed?.result?.timestamp, parsed?.data?.timestamp];
    for (const candidate of candidates) {
        const num = Number(candidate);
        if (Number.isFinite(num) && num > 0) {
            return normalizeTimestampUnit(num);
        }
    }

    // 极端兜底：body 不是 JSON 时用正则抓一个 10 位以上的数字
    const match = String(body ?? '').match(/"timestamp"\s*:\s*"?(\d{9,})"?/);
    return match ? normalizeTimestampUnit(Number(match[1])) : null;
};

const pickIgnoreCase = (
    params: Record<string, string> | undefined,
    name: string
): string | undefined => {
    if (!params) {
        return undefined;
    }
    const key = Object.keys(params).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? params[key] : undefined;
};

/**
 * 取 iClass 下发的签到时间戳。
 *
 * 这是整个签到的关键：stu_scan_sign 只接受**服务端自己刚下发**的毫秒时间戳，
 * 客户端用 Date.now()（哪怕按 Date 头校正过）造出来的值一律被拒为 ERRCODE 100 参数错误。
 * 取不到就退回本机时钟，并把 source 标成 'local'、error 带上原因，绝不假装成功。
 */
export const fetchSignTimestamp = async (
    client: Got,
    useVpn: boolean,
    sessionId: string,
    localOffsetMs: number = 0
): Promise<SignTimestampResult> => {
    const localNow = Date.now() + localOffsetMs;
    const urls = buildSignTimestampUrls(useVpn);
    const errors: string[] = [];

    for (const url of urls) {
        try {
            const res = await client.get(url, {
                headers: { sessionId, Accept: 'application/json' },
                throwHttpErrors: false,
                followRedirect: false,
                timeout: { request: 10000 }
            });

            const timestamp = extractTimestamp(res.body);
            if (res.statusCode === 200 && timestamp !== null) {
                logger.info(
                    `[sign] 服务端时间戳 ${timestamp} 取自 ${url}（本机校正时钟 ${localNow}，差 ${timestamp - localNow}ms）`
                );
                return { timestamp, source: 'server', url, localNow, skewMs: timestamp - localNow };
            }

            errors.push(
                `${url} http=${res.statusCode} body=${String(res.body).replace(/\s+/g, ' ').slice(0, 120)}`
            );
        } catch (error) {
            errors.push(`${url} 异常=${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const reason = errors.join(' | ') || '未获取到服务端时间戳';
    logger.warn(`[sign] 取服务端时间戳失败，退回本机时钟 ${localNow}：${reason}`);
    return { timestamp: localNow, source: 'local', url: null, error: reason, localNow, skewMs: 0 };
};

/** 二维码里的时间戳与服务端时间戳相差多久之内还值得一试 */
const QR_TIMESTAMP_FRESH_WINDOW_MS = 90_000;

/**
 * 发起扫码签到请求。
 *
 * 请求形状（照抄 iClass 官方客户端 / Yiki21 的 TUI 实现，2026-09-22 实测有效）：
 *   - query string: courseSchedId + timestamp
 *   - 表单体:       id
 *
 * ── 为什么必须用服务端时间戳（2026-09-22 实测，别再改回去）──
 * 签到接口要求提交的毫秒时间戳**不能落在服务端的未来**，容差不到 100ms：
 *   对同一节课、同样的请求形状，只改时间戳做单变量对照 ——
 *     服务端下发（偏移 ≈ 0）   -> 被接受
 *     服务端 +0ms              -> 被接受
 *     服务端 +100ms 及以上      -> ERRCODE 100 参数错误!
 *     服务端 −60s（过去方向）   -> 仍不报 100
 * 而这台机器的系统时钟比 iClass 快约 1 秒（同一台机器当天早些时候是 4.7 秒，
 * NTP 会把它校正回来，所以偏差是**漂移**的），于是本机 Date.now() 恒定落在
 * 服务端的未来 —— 这才是每次签到都报 100 参数错误的真正原因，
 * 与"老师没开签到""参数名写错"都无关。
 *
 * 也正因为它只是"快一点"，上游那套用 Date 响应头算偏移的做法才会时灵时不灵：
 * 该响应头只有秒级精度，实测连续 6 次登录算出的偏移在 −1563ms ~ −755ms 之间跳，
 * 其中 3 次造出的时间戳落在服务端未来 -> 仍被拒。取服务端下发值则 100% 被接受。
 *
 * 结论：每次签到前必须先 GET common/get_timestamp.action 拿时间戳，取到就用。
 *
 * options.qrParams 用于「原样透传老师二维码里的参数」：其中的 id 会并进表单体，
 * courseSchedId 会覆盖默认值，**其余未知参数也一并透传**，以便哪天 iClass 新增
 * 参数我们也能跟上；但二维码里的 timestamp **不照抄**（多半已过期），
 * 只在它距服务端时间戳 90s 内时才作为首选候选试一次。
 *
 * 若结果被判 101（时间戳失效），会自动重新取一次服务端时间戳再试一次。
 */
export const signNow = async (
    client: Got,
    useVpn: boolean,
    userId: string,
    sessionId: string,
    courseSchedId: string,
    options: { qrParams?: Record<string, string>; localOffsetMs?: number } = {}
): Promise<SignRequestResult> => {
    const { qrParams, localOffsetMs = 0 } = options;
    const signUrl = buildScanSignUrl(useVpn);
    const localNow = Date.now() + localOffsetMs;

    const serverTs = await fetchSignTimestamp(client, useVpn, sessionId, localOffsetMs);

    // 候选时间戳：二维码自带的（且新鲜）优先 -> 服务端下发 -> 本机时钟兜底
    const qrTsRaw = pickIgnoreCase(qrParams, 'timestamp');
    const qrTs = qrTsRaw === undefined ? Number.NaN : normalizeTimestampUnit(Number(qrTsRaw));

    const candidates: Array<{ timestamp: number; source: SignTimestampSource; url: string | null }> = [];
    if (
        Number.isFinite(qrTs) &&
        qrTs > 0 &&
        Math.abs(qrTs - serverTs.timestamp) <= QR_TIMESTAMP_FRESH_WINDOW_MS
    ) {
        candidates.push({ timestamp: qrTs, source: 'qr', url: null });
    } else if (Number.isFinite(qrTs) && qrTs > 0) {
        logger.info(
            `[sign] 二维码时间戳 ${qrTs} 与服务端时间戳 ${serverTs.timestamp} 相差过大（>${QR_TIMESTAMP_FRESH_WINDOW_MS}ms），跳过`
        );
    }
    candidates.push({ timestamp: serverTs.timestamp, source: serverTs.source, url: serverTs.url });

    // 时间戳相同的候选去重，避免同一个请求打两遍
    const attempts = candidates.filter(
        (item, index) => candidates.findIndex((other) => other.timestamp === item.timestamp) === index
    );

    const commonHeaders = {
        sessionId,
        Accept: 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; M2012K11AC Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 wxwork/4.1.30 MicroMessenger/7.0.1 Language/zh'
    };

    let attemptCount = 0;

    /**
     * 提交一次。query 放 courseSchedId + timestamp，表单体放 id ——
     * 这是 iClass 官方客户端 / Yiki21 的 TUI 实现里验证过的形状。
     */
    const postOnce = async (
        timestamp: number,
        source: SignTimestampSource,
        url: string | null
    ): Promise<SignRequestResult> => {
        attemptCount += 1;

        const query: Record<string, string> = {
            courseSchedId,
            timestamp: String(timestamp)
        };
        const form: Record<string, string> = { id: userId };

        if (qrParams) {
            for (const [key, value] of Object.entries(qrParams)) {
                const lower = key.toLowerCase();
                if (lower === 'id') {
                    form[key] = value;
                    continue;
                }
                if (lower === 'timestamp') {
                    // 交给候选列表决定用哪个时间戳，不要照抄可能已过期的二维码值
                    query[key] = String(timestamp);
                    continue;
                }
                query[key] = value;
            }
        }

        const res = await client.post(signUrl, {
            searchParams: query,
            form,
            headers: commonHeaders,
            followRedirect: false,
            throwHttpErrors: false
        });

        const parsedResult = parseJsonSafe(res.body);
        const response = parsedResult !== null
            ? parsedResult
            : {
                STATUS: '1',
                ERRMSG: '签到接口返回非 JSON',
                statusCode: res.statusCode,
                location: res.headers.location ?? null,
                raw: String(res.body).slice(0, 200)
            };

        logger.info(
            `[sign] POST ${signUrl} query=${JSON.stringify(query)} form=${JSON.stringify(form)} ` +
            `时间戳来源=${source} http=${res.statusCode} -> ${String(res.body).replace(/\s+/g, ' ').slice(0, 160)}`
        );

        return {
            response,
            timestamp,
            timestampSource: source,
            timestampUrl: url,
            timestampError: serverTs.error,
            timestampSkewMs: Number.isFinite(timestamp) ? timestamp - localNow : null,
            query,
            form,
            signUrl,
            attempts: attemptCount
        };
    };

    let last: SignRequestResult | null = null;

    for (const attempt of attempts) {
        last = await postOnce(attempt.timestamp, attempt.source, attempt.url);
        // STATUS === '0' 说明请求被受理，不必再换时间戳重试
        if (String(last.response?.STATUS ?? '') === '0') {
            return last;
        }
    }

    /*
     * 所有候选都被拒，且确实是"时间戳失效"—— 说明 get_timestamp 可能命中了
     * 缓存/时钟漂移的节点，返回的时间戳本身就落在服务端的未来（容差不到 100ms）。
     * 重新取一次再试一次，而不是让用户白等一轮 15 秒的重试间隔。
     *
     * 注意 ERRCODE 101 被两种语义共用：时间戳失效（"二维码已失效！"）和
     * 不在上课时间（"当前时间不是上课时间！"）。后者重取时间戳没有意义，必须排除。
     */
    const errMsg = String(last?.response?.ERRMSG ?? '');
    const isTimestampStale =
        String(last?.response?.ERRCODE ?? '') === '101' &&
        /失效|二维码/.test(errMsg);

    if (isTimestampStale) {
        logger.warn(`[sign] 时间戳被判失效（101 "${errMsg}"），重新获取服务端时间戳后再试一次`);
        const fresh = await fetchSignTimestamp(client, useVpn, sessionId, localOffsetMs);
        if (fresh.source === 'server' && fresh.timestamp !== last?.timestamp) {
            return await postOnce(fresh.timestamp, 'server', fresh.url);
        }
    }

    // attempts 至少有一项，所以 last 一定非空
    return last as SignRequestResult;
};
