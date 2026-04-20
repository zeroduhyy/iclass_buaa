import type { Got } from 'got';
import { ICLASS_URLS, VPN_OFFSET_CORRECTION_MS } from '../config/constants';
import logger from '../utils/logger';

export interface UserInfoResult {
    userInfo: any;
    sessionId: string | null;
    serverTimeOffset: number; // 服务器偏移量（毫秒）
}

export const fetchUserInfoFromApi = async (
    client: Got,
    useVpn: boolean,
    username: string,

): Promise<UserInfoResult> => {
    logger.info('Fetching user info from iClass API...');
    const network = useVpn ? 'VPN' : 'DIRECT';
    const loginApi = ICLASS_URLS[network].USER_LOGIN;

    const params = {
        phone: username,
        password: '',
        verificationType: '2',
        verificationUrl: '',
        userLevel: '1'
    };

    let res: any;
    try {
        res = await client.get(loginApi, { searchParams: params });
    } catch (err: any) {
        logger.error(`Error requesting iClass API: ${err?.message || err}`);
        throw new Error(`请求 iClass API 失败: ${err?.message || err}`);
    }

    let serverTimeOffset = 0;
    const serverDateHeader = res.headers.date; // Got 自动处理为小写 key
    if (serverDateHeader) {
        const serverMs = new Date(serverDateHeader).getTime();
        const localMs = Date.now(); // 拿到响应时的本地时间

        if (Number.isFinite(serverMs)) {
            // 偏移量 = 服务器时间 - 本地时间
            const rawServerTimeOffset = serverMs - localMs;
            serverTimeOffset = useVpn
                ? rawServerTimeOffset + VPN_OFFSET_CORRECTION_MS
                : rawServerTimeOffset;
            logger.info(
                useVpn
                    ? `Time sync: raw server offset=${rawServerTimeOffset}ms, vpn correction=${VPN_OFFSET_CORRECTION_MS}ms, applied offset=${serverTimeOffset}ms`
                    : `Time sync: Server offset is ${serverTimeOffset}ms`
            );
        } else {
            logger.warn(`Time sync skipped: invalid Date header ${serverDateHeader}`);
        }
    } else {
        logger.warn(`Time sync skipped: missing Date header, fallback offset=${serverTimeOffset}ms`);
    }

    if (res.statusCode !== 200) {
        logger.error(`Failed to get user info: ${res.statusCode}`);
        throw new Error(`请求 iClass API 失败，HTTP 状态: ${res.statusCode}`);
    }

    let userData: any;
    try {
        userData = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    } catch {
        logger.error(`iClass API 返回非 JSON 数据: ${String(res.body).slice(0, 200)}`);
        throw new Error('iClass API 返回了无法解析的 JSON');
    }

    if (userData?.STATUS !== '0') {
        logger.error(`Failed to get user info: ${JSON.stringify(userData)}`);
        throw new Error(`iClass API 返回错误: ${JSON.stringify(userData)}`);
    }

    const result = userData?.result;
    if (!result || typeof result !== 'object') {
        logger.error(`Unexpected user info result: ${JSON.stringify(userData)}`);
        throw new Error(`iClass API 返回的用户信息格式异常: ${JSON.stringify(userData)}`);
    }

    const sessionId = result.sessionId ?? null;
    logger.info(`Got user info for: ${result.realName ?? 'unknown'}`);
    return {
        userInfo: result,
        sessionId,
        serverTimeOffset
    };
};
