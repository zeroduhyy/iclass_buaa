import { IClassClient } from '../core/IClassClient';

export interface LoginInput {
    studentId: string;
    useVpn: boolean;
    vpnUsername?: string;
    vpnPassword?: string;
}

export interface LoginContext {
    client: IClassClient;
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

export const loginAndBuildContext = async (input: LoginInput): Promise<LoginContext> => {
    const client = new IClassClient(input.useVpn);

    await client.login({
        studentId: input.studentId,
        vpnUsername: input.vpnUsername,
        vpnPassword: input.vpnPassword
    });

    const userId = String(client.userInfo?.id ?? '');
    const userName = String(client.userInfo?.realName ?? client.userInfo?.name ?? input.studentId);
    const sessionId = String(client.sessionId ?? '');

    if (!userId || !sessionId) {
        throw new Error('登录成功但用户信息不完整，请重试');
    }

    return {
        client,
        userId,
        userName,
        sessionId,
        useVpn: input.useVpn
    };
};
