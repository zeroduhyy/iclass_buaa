export interface ApiResponse<T> {
    ok: boolean;
    code: string;
    message: string;
    data: T | null;
}

export interface LoginRequest {
    studentId: string;
    useVpn: boolean;
    vpnUsername?: string;
    vpnPassword?: string;
}

export interface LoginData {
    token: string;
    userId: string;
    userName: string;
    sessionId: string;
}

export interface CourseDetailItem {
    name: string;
    id: string;
    courseSchedId: string;
    date: string;
    startTime: string;
    endTime: string;
    signStatus: string;
}

export interface CourseDetailData {
    details: CourseDetailItem[];
}

export interface SignRequest {
    /** 走二维码链接签到时可省略（服务端会从 qrUrl 里解析） */
    courseSchedId?: string;
    /** 老师二维码的链接（或纯 query 串），其参数会被透传给 iClass */
    qrUrl?: string;
    // 注意：不要在这里传 timestamp —— 时间戳一律由服务端向 iClass 索取，
    // 客户端自造的值会落在 iClass 服务端的未来（容差不到 100ms）而被判参数错误
    //（详见 server/src/core/signCore.ts）。
}

export interface SignQrRequest {
    courseSchedId: string;
}

export interface SignVerifyResult {
    /** 是否成功发起了复检请求 */
    checked: boolean;
    /** 复检读到的 signStatus，null 表示没查到该节次 */
    signStatus: string | null;
    /** 复检判定：signStatus === '1' */
    signed: boolean;
    /** 复检异常信息 */
    error?: string;
}

/** 签到时间戳来源：server = iClass 下发（正常）；qr = 二维码自带；local = 本机时钟兜底（不可靠） */
export type SignTimestampSource = "server" | "qr" | "local";

export interface SignOutcomeData {
    courseSchedId: string;
    timestamp: number;
    /** 本次提交用的时间戳来源 */
    timestampSource: SignTimestampSource;
    /** 取到服务端时间戳的地址 */
    timestampUrl: string | null;
    /** 取服务端时间戳失败的原因 */
    timestampError?: string;
    /** 实际提交给 iClass 的完整参数集 */
    submittedParams: Record<string, string>;
    /** 提交时间戳与本机校正时钟的差值（毫秒） */
    timestampSkewMs: number | null;
    /** 实际请求的签到地址 */
    signUrl: string;
    /** 一共提交了几次 */
    attempts: number;
    iclassStatus: string;
    iclassErrCode: string;
    iclassErrMsg: string;
    iclassRaw: unknown;
    verify: SignVerifyResult;
}

export interface SignQrData {
    qrUrl: string;
    courseSchedId: string;
    timestamp: number;
}
