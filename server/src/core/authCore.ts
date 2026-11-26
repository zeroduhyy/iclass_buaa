import type { Got, OptionsInit } from 'got';
import * as cheerio from 'cheerio';
import { ICLASS_URLS, SSO_URLS } from '../config/constants';
import logger from '../utils/logger';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const MAX_FOLLOW_HOPS = 15;
const VPN_GATEWAY_HOST = 'd.buaa.edu.cn';
const VPN_GATEWAY_HOME = 'https://d.buaa.edu.cn/';
/** uc.buaa.edu.cn as WebVPN encodes it in proxied paths. */
const VPN_UC_CODE = '77726476706e69737468656265737421e5f40f9e3231691e7b0c9ce29b5b';
const CAPTCHA_PATTERN = /config\.captcha\s*=\s*\{\s*type:\s*['"]([^'"]+)['"]\s*,\s*id:\s*['"]([^'"]+)['"]/;

/** Login page state kept while the user types the captcha. */
export interface PendingCaptcha {
    entryUrl: string;
    execution: string;
}

/** The SSO page asks for an image captcha; the caller shows [image] to the user. */
export class CaptchaRequiredError extends Error {
    constructor(
        message: string,
        public readonly image: Buffer,
        public readonly pending: PendingCaptcha
    ) {
        super(message);
    }
}

export interface SsoLoginOptions {
    /** Answer to the captcha of [pending]. */
    captcha?: string;
    pending?: PendingCaptcha | null;
}

export const ssoLogin = async (
    client: Got,
    username: string,
    password: string,
    useVpn: boolean,
    options: SsoLoginOptions = {}
): Promise<void> => {
    if (!username || !password) {
        throw new Error('Username or password not provided');
    }

    // WebVPN: iClass behind WebVPN signs in on the proxied SSO page (its own session, always
    // a captcha). The gateway itself must first sign in on the official SSO page: a ticket
    // requested through the proxied SSO is rewritten to a proxied copy of the gateway.
    const entryLoginUrl = useVpn ? SSO_URLS.VPN_LOGIN : SSO_URLS.LOGIN;
    const entryParams = useVpn ? {} : { service: ICLASS_URLS.DIRECT.LOGIN_HOME };
    const captcha = String(options.captcha ?? '').trim();

    let execution: string;
    if (captcha && options.pending) {
        execution = options.pending.execution;
    } else {
        if (useVpn) {
            await activateVpnGateway(client, username, password);
        }
        logger.info('Fetching SSO login page...');
        const page = await fetchLoginPage(client, entryLoginUrl, entryParams);
        execution = page.execution;
        await requireCaptchaIfAsked(client, page.body, entryLoginUrl, execution, '请输入验证码');
    }

    const loginData: Record<string, string> = {
        username,
        password,
        submit: '登录',
        type: 'username_password',
        execution,
        _eventId: 'submit'
    };
    if (captcha) {
        loginData.captcha = captcha;
        loginData.captchaResponse = captcha;
    }

    logger.info(`Got execution parameter:${execution.slice(0, 20)}...`);
    let res = await submitLogin(client, entryLoginUrl, loginData);
    if (res.statusCode === 401) {
        throw new Error('登录失败：账号或密码错误，或密码过弱需先修改后再登录');
    }
    if (!isRedirect(res.statusCode)) {
        const body = String(res.body ?? '');
        const next = parseExecution(body);
        if (next && CAPTCHA_PATTERN.test(body)) {
            // Back on the login page with a new captcha: wrong answer, or one is now required.
            await requireCaptchaIfAsked(
                client, body, entryLoginUrl, next,
                captcha ? '验证码不正确，请重新输入' : '请输入验证码'
            );
        }
        if (/continueForm/i.test(body) && next) {
            // Account risk notice: continue as the browser's "ignore" button does.
            res = await submitLogin(client, entryLoginUrl, { execution: next, _eventId: 'ignoreAndContinue' });
        }
    }

    if (useVpn) {
        await finishVpnSsoLogin(client, res);
        return;
    }
    await handleLoginResponse(client, res);
};

const fetchLoginPage = async (
    client: Got,
    entryLoginUrl: string,
    entryParams: OptionsInit['searchParams']
): Promise<{ execution: string; body: string }> => {
    const response = await client.get(entryLoginUrl, {
        searchParams: entryParams,
        headers: { 'User-Agent': DESKTOP_UA }
    });
    if (response.statusCode >= 500) {
        throw new Error(`Server error: ${response.statusCode}`);
    }

    const body = String(response.body ?? '');
    const execution = parseExecution(body);
    if (!execution) {
        logger.error('无法从 SSO 登录页面解析必要参数（execution）');
        throw new Error('Could not find execution parameter');
    }
    return { execution, body };
};

/** If the SSO page carries an image captcha, fetches the image and asks the user for it. */
const requireCaptchaIfAsked = async (
    client: Got,
    body: string,
    entryUrl: string,
    execution: string,
    message: string
): Promise<void> => {
    const match = CAPTCHA_PATTERN.exec(body);
    if (!match) {
        return;
    }
    const [, type, id] = match;
    if (type.toLowerCase() !== 'image') {
        throw new Error('统一认证要求其他方式的验证，暂不支持，请稍后再试');
    }
    // The image lives next to the login page (".../login" -> ".../captcha"), also behind WebVPN.
    const imageUrl = new URL('captcha', entryUrl);
    imageUrl.search = '';
    imageUrl.searchParams.set('captchaId', id);
    const res = await client.get(imageUrl.toString(), {
        responseType: 'buffer',
        followRedirect: false,
        throwHttpErrors: false,
        headers: { 'User-Agent': DESKTOP_UA, Referer: entryUrl }
    });
    const image = res.body as unknown as Buffer;
    if (res.statusCode !== 200 || !image || image.length === 0) {
        throw new Error('统一认证要求验证码，但验证码图片获取失败，请重试');
    }
    logger.info('SSO asks for a captcha');
    throw new CaptchaRequiredError(message, image, { entryUrl, execution });
};

const submitLogin = async (
    client: Got,
    entryLoginUrl: string,
    loginData: Record<string, string>
): Promise<any> => {
    logger.info('Submitting login form...');
    try {
        const loginRes = await client.post(entryLoginUrl, {
            form: loginData,
            headers: { 'User-Agent': DESKTOP_UA, Referer: entryLoginUrl },
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

/**
 * WebVPN: the proxied SSO login only signs in to SSO. Follow it until it would reach the
 * user center; iClass behind WebVPN then reuses this SSO session.
 */
const finishVpnSsoLogin = async (client: Got, res: any): Promise<void> => {
    if (isRedirect(res.statusCode)) {
        const location = String(res.headers.location ?? '');
        if (!location) {
            throw new Error('登录跳转缺少重定向地址');
        }
        const next = new URL(location, res.url || SSO_URLS.VPN_LOGIN).toString();
        const after = await follow(client, next, '统一认证跳转', { stopBefore: isUserCenter });
        if (after.statusCode === 200 && parseExecution(after.body)) {
            throw new Error('登录失败：账号或密码错误');
        }
        return;
    }
    if (parseExecution(String(res.body ?? ''))) {
        throw new Error('登录失败：账号或密码错误');
    }
};

/**
 * Signs in to the WebVPN gateway on the official SSO page. The token-login step sets the
 * gateway cookie; its own redirect goes to a remembered page (none here), so stop there
 * as UBAA does, then check the gateway home page.
 */
const activateVpnGateway = async (client: Got, username: string, password: string): Promise<void> => {
    const entry = SSO_URLS.VPN_GATEWAY_SSO;
    const page = await follow(client, entry, '登录 WebVPN', { stopAtTokenLogin: true });
    let execution = parseExecution(page.body);
    let body = page.body;
    let eventId = 'submit';
    for (let i = 0; i < 2 && execution; i += 1) {
        if (eventId === 'submit' && CAPTCHA_PATTERN.test(body)) {
            throw new Error('登录 WebVPN 时学校要求验证码，请稍后再试，或在校园网下用直连');
        }
        const form: Record<string, string> = eventId === 'submit'
            ? { username, password, submit: '登录', type: 'username_password', execution, _eventId: 'submit' }
            : { execution, _eventId: 'ignoreAndContinue' };
        const res: any = await client.post(entry, {
            form,
            headers: { 'User-Agent': DESKTOP_UA, Referer: entry },
            followRedirect: false,
            throwHttpErrors: false
        });
        if (res.statusCode === 401) {
            throw new Error('登录失败：账号或密码错误，或密码过弱需先修改后再登录');
        }
        if (isRedirect(res.statusCode)) {
            const location = String(res.headers.location ?? '');
            await follow(client, new URL(location, entry).toString(), '登录 WebVPN', { stopAtTokenLogin: true });
            execution = null;
        } else {
            body = String(res.body ?? '');
            if (!/continueForm/i.test(body)) {
                throw new Error(`登录 WebVPN 失败（HTTP ${res.statusCode}）`);
            }
            execution = parseExecution(body);
            if (!execution) {
                throw new Error('统一认证要求确认账号风险，但无法继续');
            }
            eventId = 'ignoreAndContinue';
        }
    }

    let home: FollowResult | null = null;
    try {
        home = await follow(client, VPN_GATEWAY_HOME, '检查 WebVPN');
    } catch {
        home = null;
    }
    if (!home || parseExecution(home.body)) {
        throw new Error('WebVPN 登录未完成，请稍后再试');
    }
    logger.info('WebVPN gateway signed in');
};

const handleLoginResponse = async (client: Got, res: any): Promise<void> => {
    if (isRedirect(res.statusCode)) {
        const redirectUrl = res.headers.location;
        if (!redirectUrl) {
            logger.error('Missing redirect location after login');
            throw new Error('登录跳转缺少重定向地址');
        }
        logger.info('Following SSO redirect...');
        const followRes = await follow(client, new URL(redirectUrl, SSO_URLS.LOGIN).toString(), '统一认证跳转');
        finalizeLogin(followRes.loginName ? 'loginName' : followRes.url);
        return;
    }

    finalizeLogin(res.url || `status ${res.statusCode}`);
};

const looksLikeIclassUrl = (url: string): boolean => {
    return url === 'loginName' || url.includes('iclass.buaa.edu.cn') || url.includes('d.buaa.edu.cn/https-834');
};

const finalizeLogin = (finalUrl: string): void => {
    logger.info(`Final URL after redirects: ${hostAndPath(finalUrl)}`);
    if (looksLikeIclassUrl(finalUrl)) {
        return;
    }
    logger.error(`Login failed. Final URL: ${hostAndPath(finalUrl)}`);
    throw new Error(`登录失败，最终停在 ${hostAndPath(finalUrl)}`);
};

export interface FollowResult {
    statusCode: number;
    url: string;
    body: string;
    loginName: string | null;
}

interface FollowOptions {
    stopAtTokenLogin?: boolean;
    stopBefore?: (url: URL) => boolean;
}

/**
 * Follows redirects one hop at a time. Stops as soon as a loginName appears (it is
 * one-time, so the page carrying it is not requested, as in UBAA), detects loops, and
 * reports the hops (host and path only, no tickets) when something goes wrong.
 */
export const follow = async (
    client: Got,
    start: string,
    step: string,
    options: FollowOptions = {}
): Promise<FollowResult> => {
    let url = new URL(start);
    const hops: string[] = [];
    const seen = new Map<string, number>();
    for (let i = 0; i < MAX_FOLLOW_HOPS; i += 1) {
        const inUrl = extractLoginName(url.toString());
        if (inUrl) {
            return { statusCode: 0, url: url.toString(), body: '', loginName: inUrl };
        }
        if (options.stopBefore?.(url)) {
            return { statusCode: 0, url: url.toString(), body: '', loginName: null };
        }
        const params = [...new Set(url.searchParams.keys())];
        hops.push(`${url.host}${url.pathname}${params.length ? `?${params.join(',')}` : ''}`);
        // The exact same address a third time means a loop (a normal login passes the
        // iClass entry page twice; loops with fresh tickets hit MAX_FOLLOW_HOPS).
        const key = url.toString();
        const visits = (seen.get(key) ?? 0) + 1;
        seen.set(key, visits);
        if (visits > 2) {
            throw new Error(`${step}时跳转出现循环：${hopsText(hops)}`);
        }

        const res: any = await client.get(url.toString(), {
            followRedirect: false,
            throwHttpErrors: false,
            headers: { 'User-Agent': DESKTOP_UA, Accept: 'text/html,application/xhtml+xml' }
        });
        if (!isRedirect(res.statusCode)) {
            const body = String(res.body ?? '');
            return { statusCode: res.statusCode, url: url.toString(), body, loginName: extractLoginName(body) };
        }
        const location = String(res.headers.location ?? '');
        if (!location) {
            return { statusCode: res.statusCode, url: url.toString(), body: '', loginName: null };
        }
        const inLocation = extractLoginName(location);
        if (inLocation) {
            return { statusCode: res.statusCode, url: url.toString(), body: '', loginName: inLocation };
        }
        if (options.stopAtTokenLogin && url.host === VPN_GATEWAY_HOST && url.pathname.includes('token-login')) {
            return { statusCode: res.statusCode, url: url.toString(), body: '', loginName: null };
        }
        url = new URL(location, url);
    }
    throw new Error(`${step}时跳转次数过多：${hopsText(hops)}`);
};

/** Last hops, shortened for display: WebVPN's long host codes are cut to a short tag. */
const hopsText = (hops: string[]): string =>
    hops.slice(-10)
        .map((hop) => hop.replace(/\/77726476706e69737468656265737421([0-9a-f]{6})[0-9a-f]*/g, '/~$1'))
        .join(' → ');

const hostAndPath = (value: string): string => {
    try {
        const parsed = new URL(value);
        return `${parsed.host}${parsed.pathname}`;
    } catch {
        return value;
    }
};

/** uc.buaa.edu.cn, directly or behind WebVPN: the SSO's default landing page. */
const isUserCenter = (url: URL): boolean =>
    url.host === 'uc.buaa.edu.cn' || url.pathname.includes(VPN_UC_CODE);

const isRedirect = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

const parseExecution = (body: string): string | null => {
    const $ = cheerio.load(body);
    const execution = $('input[name="execution"]').attr('value');
    return execution && execution.trim() ? execution : null;
};

/** Decodes loginName without treating literal plus signs as spaces. */
export const extractLoginName = (value: string): string | null => {
    const match = /[?&#]loginname=([^&#"'<>\s]+)/i.exec(value);
    if (!match?.[1]) {
        return null;
    }
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
};
