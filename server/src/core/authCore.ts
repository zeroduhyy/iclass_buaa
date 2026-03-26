import type { Got, OptionsInit } from 'got';
import * as cheerio from 'cheerio';
import { ICLASS_URLS, SSO_URLS } from '../config/constants';
import logger from '../utils/logger';

export const vpnLogin = async (
    client: Got,
    username: string,
    password: string
): Promise<void> => {
    if (!username || !password) {
        throw new Error('Username or password not provided');
    }

    const entryLoginUrl = SSO_URLS.VPN_LOGIN;
    const entryParams = {};

    logger.info('Fetching SSO login page...');
    const execution = await fetchExecution(client, entryLoginUrl, entryParams);

    const loginData = {
        username,
        password,
        submit: '登录',
        type: 'username_password',
        execution,
        _eventId: 'submit'
    };
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: entryLoginUrl
    };

    logger.info(`Got execution parameter:${execution.slice(0, 20)}...`);
    const res = await submitLogin(client, entryLoginUrl, loginData, headers);
    await handleLoginResponse(client, res);
};


const fetchExecution = async (
    client: Got,
    entryLoginUrl: string,
    entryParams: OptionsInit['searchParams']
): Promise<string> => {
    const response = await client.get(entryLoginUrl, { searchParams: entryParams });
    if (response.statusCode >= 500) {
        throw new Error(`Server error: ${response.statusCode}`);
    }

    const $ = cheerio.load(response.body);
    const execution = $('input[name="execution"]').attr('value');

    if (!execution) {
        logger.error('无法从 SSO 登录页面解析必要参数（execution）');
        throw new Error('Could not find execution parameter');
    }

    return execution;
};

const submitLogin = async (
    client: Got,
    entryLoginUrl: string,
    loginData: Record<string, string>,
    headers: Record<string, string>
): Promise<any> => {
    logger.info('Submitting login form...');
    try {
        const loginRes = await client.post(entryLoginUrl, {
            form: loginData,
            headers,
            followRedirect: false,
            throwHttpErrors: false
        });

        logger.info(`Login response status:${loginRes.statusCode}`);
        return loginRes;
    } catch (error: any) {
        logger.error(`Login request failed: ${error?.message || error}`);
        throw error;
    }
};

const handleLoginResponse = async (client: Got, res: any): Promise<void> => {
    if (res.statusCode === 401) {
        logger.error('Got 401 Unauthorized - Treat as login failure by policy');
        throw new Error('登录失败：账号或密码错误，或密码过弱需先修改后再登录');
    }

    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const redirectUrl = res.headers.location;
        if (!redirectUrl) {
            logger.error('Missing redirect location after login');
            throw new Error('登录跳转缺少重定向地址');
        }
        logger.info(`Redirecting to: ${redirectUrl}`);
        const followRes = await client.get(redirectUrl);
        await finalizeLogin(client, followRes);
        return;
    }

    await finalizeLogin(client, res);
};

const looksLikeIclassUrl = (url: string): boolean => {
    return url.includes('iclass.buaa.edu.cn') || url.includes('d.buaa.edu.cn/https-834');
};

const looksLikeVpnPortalHome = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'd.buaa.edu.cn' && !parsed.pathname.includes('/login');
    } catch {
        return false;
    }
};

const enterIclassService = async (client: Got): Promise<void> => {
    const probeUrl = `${ICLASS_URLS.VPN.SERVICE_HOME.replace(/\/$/, '')}/`;

    const probeRes = await client.get(probeUrl, {
        followRedirect: true,
        throwHttpErrors: false
    });
    const probeFinalUrl = probeRes.url || `status ${probeRes.statusCode}`;
    logger.info(`Service probe final URL: ${probeFinalUrl}`);

    if (!looksLikeIclassUrl(probeFinalUrl)) {
        throw new Error(`VPN 登录后进入 iClass 失败，最终 URL: ${probeFinalUrl}`);
    }
};

const finalizeLogin = async (client: Got, response: any): Promise<void> => {
    const finalUrl = response.url || `status ${response.statusCode}`;
    logger.info(`Final URL after redirects: ${finalUrl}`);

    if (looksLikeIclassUrl(finalUrl)) {
        return;
    }

    if (looksLikeVpnPortalHome(finalUrl)) {
        await enterIclassService(client);
        return;
    }

    logger.error(`Login failed. Final URL: ${finalUrl}`);
    throw new Error(`登录失败，最终 URL: ${finalUrl}`);
};


