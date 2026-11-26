import axios from "axios";
import { http } from "./http";
import type { ApiResponse, AutoSignStatus, LoginData } from "../types/api";

const unwrap = <T>(error: unknown, fallback: string): ApiResponse<T> => {
    if (axios.isAxiosError<ApiResponse<T>>(error) && error.response?.data) {
        return error.response.data;
    }
    return {
        ok: false,
        code: "REQUEST_FAILED",
        message: error instanceof Error ? error.message : fallback,
        data: null
    };
};

/** Logs in with the login saved on this computer (if any). */
export const getSavedSession = async (): Promise<ApiResponse<LoginData | { studentId: string }>> => {
    try {
        const res = await http.get<ApiResponse<LoginData | { studentId: string }>>("/api/saved-session", { timeout: 60000 });
        return res.data;
    } catch (error) {
        return unwrap(error, "自动登录失败");
    }
};

export const getAutoSign = async (): Promise<ApiResponse<AutoSignStatus>> => {
    try {
        const res = await http.get<ApiResponse<AutoSignStatus>>("/api/auto-sign");
        return res.data;
    } catch (error) {
        return unwrap(error, "获取自动签到状态失败");
    }
};

export const updateAutoSign = async (
    changes: { enabled?: boolean; offsetMinutes?: number }
): Promise<ApiResponse<AutoSignStatus>> => {
    try {
        const res = await http.post<ApiResponse<AutoSignStatus>>("/api/auto-sign", changes);
        return res.data;
    } catch (error) {
        return unwrap(error, "设置自动签到失败");
    }
};
