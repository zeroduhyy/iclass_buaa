export interface ApiResponse<T> {
    ok: boolean;
    code: string;
    message: string;
    data: T | null;
}

export type NetworkMode = "auto" | "direct" | "vpn";

export interface LoginRequest {
    studentId: string;
    password: string;
    networkMode: NetworkMode;
    /** Captcha answer, with the attempt it belongs to. */
    captcha?: string;
    attemptId?: string;
    /** Save the login on this computer for auto-login and background auto-sign. */
    remember?: boolean;
}

export interface LoginData {
    token: string;
    userId: string;
    userName: string;
    /** The route actually used (automatic mode picks one). */
    useVpn: boolean;
}

/** Sent with code CAPTCHA_REQUIRED. */
export interface CaptchaData {
    attemptId: string;
    captchaImage: string;
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
    courseSchedId: string;
}

export interface SignQrRequest {
    courseSchedId: string;
}

export interface SignQrData {
    qrUrl: string;
    courseSchedId: string;
    timestamp: number;
}

export interface AutoSignStatus {
    enabled: boolean;
    offsetMinutes: number;
    offsetChoices: number[];
    hasSavedLogin: boolean;
    persistent: boolean;
    studentId: string;
    nextTriggerAt: number | null;
    nextTriggerText: string;
    nextCourseName: string;
    lastRunAt: number | null;
    lastMessage: string;
    needsCaptcha: boolean;
    recent: string[];
}
