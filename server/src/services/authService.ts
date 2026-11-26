import { randomUUID } from 'crypto';
import got from 'got';
import { SSO_URLS } from '../config/constants';
import { CaptchaRequiredError, PendingCaptcha } from '../core/authCore';
import { IClassClient } from '../core/IClassClient';
import logger from '../utils/logger';

/** How to reach iClass: auto tries the direct route first and falls back to WebVPN. */
export type NetworkMode = 'auto' | 'direct' | 'vpn';

export interface LoginInput {
    studentId: string;
    password: string;
    networkMode: NetworkMode;
    /** Captcha answer and the attempt it belongs to, when the previous call asked for one. */
    captcha?: string;
    attemptId?: string;
}

export interface LoginContext {
    client: IClassClient;
    studentId: string;
    userId: string;
    userName: string;
    sessionId: string;
    useVpn: boolean;
}

export interface ServiceResult<T> {
    ok: boolean;
    code: string;
    message: string;
    data: T | null;
}

/** Login stopped at a captcha; show [imageDataUrl] and send the answer with [attemptId]. */
export class CaptchaChallenge extends Error {
    constructor(
        message: string,
        public readonly attemptId: string,
        public readonly imageDataUrl: string
    ) {
        super(message);
    }
}

interface PendingLogin {
    client: IClassClient;
    studentId: string;
    captcha: PendingCaptcha;
    createdAt: number;
}

const PENDING_TTL_MS = 5 * 60 * 1000;
const pendingLogins = new Map<string, PendingLogin>();

const buildLoginContext = (client: IClassClient, studentId: string): LoginContext => {
    const userId = String(client.userInfo?.id ?? '');
    const userName = String(client.userInfo?.realName ?? client.userInfo?.name ?? studentId);
    const sessionId = String(client.sessionId ?? '');

    if (!userId || !sessionId) {
        throw new Error('登录成功但用户信息不完整，请重试');
    }

    return {
        client,
        studentId,
        userId,
        userName,
        sessionId,
        useVpn: client.useVpn
    };
};

/** Whether iClass answers on the direct route; any HTTP response counts. */
const isDirectReachable = async (): Promise<boolean> => {
    try {
        await got.get(SSO_URLS.DIRECT_PROBE, {
            timeout: { request: 3000 },
            followRedirect: false,
            throwHttpErrors: false,
            retry: { limit: 0 }
        });
        return true;
    } catch {
        return false;
    }
};

const NETWORK_ERROR_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'
]);

const isNetworkError = (error: unknown): boolean => {
    const err = error as { code?: string; name?: string } | null;
    return Boolean(err && (NETWORK_ERROR_CODES.has(String(err.code)) || err.name === 'TimeoutError'));
};

const imageDataUrl = (image: Buffer): string => {
    const mime = image[0] === 0x89 && image[1] === 0x50 ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${image.toString('base64')}`;
};

export const loginAndBuildContext = async (input: LoginInput): Promise<LoginContext> => {
    if (!input.password) {
        throw new Error('请输入统一认证密码');
    }

    const now = Date.now();
    for (const [id, item] of pendingLogins) {
        if (now - item.createdAt > PENDING_TTL_MS) {
            pendingLogins.delete(id);
        }
    }

    const captcha = String(input.captcha ?? '').trim();
    let pending: PendingLogin | undefined;
    if (input.attemptId) {
        pending = pendingLogins.get(input.attemptId);
        pendingLogins.delete(input.attemptId);
        if (pending && pending.studentId !== input.studentId) {
            pending = undefined;
        }
    }
    if (captcha && !pending) {
        throw new Error('验证码已过期，请重新登录');
    }

    const attempt = async (useVpn: boolean, client: IClassClient): Promise<IClassClient> => {
        try {
            await client.login({
                studentId: input.studentId,
                password: input.password,
                captcha: pending ? captcha : undefined,
                pending: pending?.captcha
            });
            return client;
        } catch (error) {
            if (error instanceof CaptchaRequiredError) {
                const attemptId = randomUUID();
                pendingLogins.set(attemptId, {
                    client,
                    studentId: input.studentId,
                    captcha: error.pending,
                    createdAt: Date.now()
                });
                throw new CaptchaChallenge(error.message, attemptId, imageDataUrl(error.image));
            }
            throw error;
        }
    };

    if (pending) {
        return buildLoginContext(await attempt(pending.client.useVpn, pending.client), input.studentId);
    }

    let useVpn = input.networkMode === 'vpn';
    if (input.networkMode === 'auto') {
        useVpn = !(await isDirectReachable());
        logger.info(`[login] 自动选择网络：${useVpn ? 'WebVPN' : '直连'}`);
    }
    try {
        return buildLoginContext(await attempt(useVpn, new IClassClient(useVpn)), input.studentId);
    } catch (error) {
        // Automatic mode: if the direct route fails at the network level, use WebVPN.
        if (input.networkMode === 'auto' && !useVpn && isNetworkError(error)) {
            logger.info('[login] 直连网络出错，改走 WebVPN');
            return buildLoginContext(await attempt(true, new IClassClient(true)), input.studentId);
        }
        throw error;
    }
};
