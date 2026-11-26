import type { Got } from 'got';
import { ICLASS_URLS } from '../config/constants';
import logger from '../utils/logger';
import { follow } from './authCore';

export interface UserInfoResult {
    userInfo: any;
    sessionId: string | null;
}

/**
 * Follows the iClass MyCenter SSO redirect chain and extracts the one-time loginName.
 * Stops as soon as it appears, without requesting the page that carries it.
 */
export const resolveIclassLoginName = async (
    client: Got,
    useVpn: boolean
): Promise<string | null> => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    const result = await follow(client, ICLASS_URLS[network].MY_CENTER, '获取 iClass 登录名');
    return result.loginName;
};

export interface SignCredential {
    userId: string;
    sessionId: string;
}

/**
 * Gets the id + sessionId for signing, as the iClass app does: resolve a fresh one-time
 * loginName with the current login cookies, then exchange it at the app login endpoint.
 * The sign endpoint rejects the loginName that the query APIs accept as Sessionid.
 */
export const fetchSignCredential = async (
    client: Got,
    useVpn: boolean,
    fallbackLoginName: string | null
): Promise<SignCredential> => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    const loginName = (await resolveIclassLoginName(client, useVpn)) ?? fallbackLoginName;
    if (!loginName) {
        throw new Error('获取签到凭证失败：登录状态已失效，请重新登录');
    }
    const res: any = await client.get(ICLASS_URLS[network].APP_LOGIN, {
        searchParams: {
            password: '',
            phone: loginName,
            userLevel: '1',
            verificationType: '2',
            verificationUrl: ''
        },
        followRedirect: false,
        throwHttpErrors: false
    });
    let json: any = null;
    try {
        json = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    } catch {
        json = null;
    }
    const status = String(json?.STATUS ?? '').trim().toLowerCase();
    const userId = String(json?.result?.id ?? '');
    const sessionId = String(json?.result?.sessionId ?? '');
    if (res.statusCode !== 200 || !['0', '200', 'success'].includes(status) || !userId || !sessionId) {
        throw new Error(json?.ERRMSG || `获取签到凭证失败（HTTP ${res.statusCode}），请重新登录后再试`);
    }
    return { userId, sessionId };
};

export const fetchUserInfoFromApi = async (
    client: Got,
    useVpn: boolean,
    username: string
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

    if (res.statusCode !== 200) {
        logger.error(`Failed to get user info: ${res.statusCode}`);
        throw new Error(`请求 iClass API 失败，HTTP 状态: ${res.statusCode}`);
    }

    let userData: any;
    try {
        userData = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    } catch {
        logger.error(`iClass API returned non-JSON data: ${String(res.body).slice(0, 200)}`);
        throw new Error('iClass API 返回了无法解析的 JSON');
    }

    if (userData?.STATUS !== '0') {
        logger.error(`Failed to get user info: ${JSON.stringify(userData)}`);
        throw new Error(`iClass API 返回错误: ${userData?.ERRMSG || JSON.stringify(userData)}`);
    }

    const result = userData?.result;
    if (!result || typeof result !== 'object') {
        logger.error(`Unexpected user info result: ${JSON.stringify(userData)}`);
        throw new Error('iClass API 返回的用户信息格式异常');
    }

    const sessionId = result.sessionId ?? null;
    logger.info(`Got user info for: ${result.realName ?? 'unknown'}`);
    return {
        userInfo: result,
        sessionId
    };
};
