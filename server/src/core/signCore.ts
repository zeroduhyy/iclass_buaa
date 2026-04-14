import type { Got } from 'got';
import { ICLASS_URLS } from '../config/constants';

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

export const buildScanSignUrl = (
    useVpn: boolean
): string => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    return ICLASS_URLS[network].SCAN_SIGN;
};

export const signNow = async (
    client: Got,
    useVpn: boolean,
    userId: string,
    sessionId: string,
    courseSchedId: string,
    timestamp: number
): Promise<any> => {
    const signUrl = buildScanSignUrl(useVpn);

    const baseParams = {
        id: userId,
        courseSchedId,
        timestamp: String(timestamp)
    };

    const commonHeaders = {
        sessionId,
        Accept: 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; M2012K11AC Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 wxwork/4.1.30 MicroMessenger/7.0.1 Language/zh'
    };

    const res = await client.post(signUrl, {
        searchParams: baseParams,
        headers: commonHeaders,
        followRedirect: false,
        throwHttpErrors: false
    });

    const parsedResult = parseJsonSafe(res.body);
    if (parsedResult !== null) {
        return parsedResult;
    }

    return {
        STATUS: '1',
        ERRMSG: '签到接口返回非 JSON',
        statusCode: res.statusCode,
        location: res.headers.location ?? null,
        raw: String(res.body).slice(0, 200)
    };
};
