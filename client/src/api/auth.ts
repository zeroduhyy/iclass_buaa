import axios from "axios";
import { http } from "./http";
import type { ApiResponse, CaptchaData, LoginData, LoginRequest } from "../types/api";

export const login = async (payload: LoginRequest): Promise<ApiResponse<LoginData | CaptchaData>> => {
    try {
        // Logging in through WebVPN takes several round trips.
        const res = await http.post<ApiResponse<LoginData | CaptchaData>>("/api/login", payload, { timeout: 60000 });
        return res.data;
    } catch (error) {
        if (axios.isAxiosError<ApiResponse<LoginData | CaptchaData>>(error) && error.response?.data) {
            return error.response.data;
        }

        return {
            ok: false,
            code: "REQUEST_FAILED",
            message: error instanceof Error ? error.message : "登录请求失败",
            data: null
        };
    }
};

export const logout = async (): Promise<ApiResponse<null>> => {
    const res = await http.post<ApiResponse<null>>("/api/logout", {});
    return res.data;
};
