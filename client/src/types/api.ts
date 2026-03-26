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
    courseSchedId: string;
    timestamp?: number;
}

export interface SignQrRequest {
    courseSchedId: string;
    timestamp?: number;
}

export interface SignQrData {
    qrUrl: string;
    courseSchedId: string;
    timestamp: number;
}
