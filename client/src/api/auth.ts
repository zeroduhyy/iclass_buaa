import { http } from "./http";
import type { ApiResponse, LoginData, LoginRequest } from "../types/api";

export const login = async (payload: LoginRequest): Promise<ApiResponse<LoginData>> => {
    const res = await http.post<ApiResponse<LoginData>>("/api/login", payload);
    return res.data;
};

export const logout = async (): Promise<ApiResponse<null>> => {
    const res = await http.post<ApiResponse<null>>("/api/logout", {});
    return res.data;
};
