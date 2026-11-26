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

const buildHeaders = (sessionId: string) => ({
    Sessionid: sessionId,
    Accept: 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; M2012K11AC Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 wxwork/4.1.30 MicroMessenger/7.0.1 Language/zh'
});

/**
 * 二维码内容使用的扫码签到地址。二维码由 智慧北航 App 扫描，
 * 扫码方走的是直连网络，所以无论当前是否 VPN 登录都返回直连地址。
 */
export const buildScanSignUrl = (): string => ICLASS_URLS.DIRECT.SCAN_SIGN;

export const buildAutoSignUrl = (useVpn: boolean): string => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    return ICLASS_URLS[network].AUTO_SIGN;
};

export const buildTimestampUrl = (useVpn: boolean): string => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    return ICLASS_URLS[network].SIGN_TIMESTAMP;
};

export const getServerTimestamp = async (
    client: Got,
    useVpn: boolean,
    userId: string,
    sessionId: string
): Promise<number> => {
    const res = await client.post(buildTimestampUrl(useVpn), {
        searchParams: { id: userId },
        headers: buildHeaders(sessionId),
        followRedirect: false,
        throwHttpErrors: false
    });

    if (res.statusCode !== 200) {
        throw new Error(`获取签到时间失败，HTTP 状态: ${res.statusCode}`);
    }

    const result = parseJsonSafe(res.body);
    if (!result) {
        throw new Error('获取签到时间失败：接口返回了无法解析的数据');
    }
    if (result.STATUS !== '0') {
        throw new Error(`获取签到时间失败：${result.ERRMSG || JSON.stringify(result)}`);
    }

    const timestamp = Number(result.timestamp ?? result.result?.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        throw new Error('获取签到时间失败：接口未返回有效时间戳');
    }

    return timestamp;
};

const isStatusOk = (status: unknown): boolean => {
    const value = String(status ?? '').trim().toLowerCase();
    return value === '0' || value === '200' || value === 'success';
};

/** 签到提交 stu_auto_sign 使用的固定设备字段（与官方安卓客户端抓包一致）。 */
const AUTO_SIGN_DEVICE_FIELDS = {
    routerInfo: '02:00:00:00:00:00',
    longitude: '0',
    latitude: '0',
    machineInfo: 'Android'
} as const;

export const signNow = async (
    client: Got,
    useVpn: boolean,
    userId: string,
    sessionId: string,
    courseSchedId: string
): Promise<any> => {
    // 学校已停用直接调用 stu_scan_sign，改为 8181 的 stu_auto_sign：
    // POST 表单、无查询串、不需要时间戳，时间窗由服务器自行判断。
    const res = await client.post(buildAutoSignUrl(useVpn), {
        form: {
            id: userId,
            courseSchedId,
            ...AUTO_SIGN_DEVICE_FIELDS
        },
        headers: buildHeaders(sessionId),
        followRedirect: false,
        throwHttpErrors: false
    });

    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = String(res.headers.location ?? '');
        if (location.includes('/login')) {
            throw new Error('登录状态已失效，请重新登录');
        }
        if (location.includes('error.jsp')) {
            throw new Error('签到被服务器拒绝，请刷新后重试');
        }
    }
    if (res.statusCode !== 200) {
        throw new Error(`签到结果未知（HTTP ${res.statusCode}），请刷新课程确认是否已签到`);
    }

    const result = parseJsonSafe(res.body);
    if (!result) {
        throw new Error('签到结果未知：接口返回了无法解析的数据，请刷新课程确认是否已签到');
    }
    if (!isStatusOk(result.STATUS)) {
        throw new Error(`签到失败：${result.ERRMSG || JSON.stringify(result)}`);
    }
    if (String(result.result?.stuSignStatus ?? '') !== '1') {
        throw new Error(`签到失败：${result.ERRMSG || '服务器未确认签到成功'}`);
    }

    return result;
};
