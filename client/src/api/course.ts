import axios from "axios";
import { http } from "./http";
import type {
    ApiResponse,
    CourseDetailData,
    SignQrData,
    SignQrRequest,
    SignRequest
} from "../types/api";

const fromAxiosError = <T>(error: unknown, fallbackMessage: string): ApiResponse<T> => {
    if (axios.isAxiosError<ApiResponse<T>>(error) && error.response?.data) {
        return error.response.data;
    }

    return {
        ok: false,
        code: "REQUEST_FAILED",
        message: error instanceof Error ? error.message : fallbackMessage,
        data: null
    };
};

export const fetchCourseDetails = async (): Promise<ApiResponse<CourseDetailData>> => {
    const res = await http.get<ApiResponse<CourseDetailData>>("/api/course-details");
    return res.data;
};

export const signNow = async (payload: SignRequest): Promise<ApiResponse<unknown>> => {
    try {
        const res = await http.post<ApiResponse<unknown>>("/api/sign", payload);
        return res.data;
    } catch (error) {
        return fromAxiosError<unknown>(error, "签到请求失败");
    }
};

export const generateSignQr = async (payload: SignQrRequest): Promise<ApiResponse<SignQrData>> => {
    try {
        const res = await http.post<ApiResponse<SignQrData>>("/api/sign-qr", payload);
        return res.data;
    } catch (error) {
        return fromAxiosError<SignQrData>(error, "二维码请求失败");
    }
};
