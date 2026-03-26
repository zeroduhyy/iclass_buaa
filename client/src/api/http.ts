import axios from "axios";
import { getToken } from "../utils/session";

// 在 Electron 生产环境中，没有 Vite proxy 代理，必须请求以启动的本地后端服务
const defaultBaseUrl = import.meta.env.PROD ? "http://127.0.0.1:3000" : "";

export const http = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || defaultBaseUrl,
    timeout: 15000
});

http.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
        config.headers = config.headers ?? {};
        config.headers["X-Session-Token"] = token;
    }
    return config;
});
