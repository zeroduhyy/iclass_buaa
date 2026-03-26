const TOKEN_KEY = "iclass_token";
const USER_ID_KEY = "iclass_user_id";
const USER_NAME_KEY = "iclass_user_name";
const USE_VPN_KEY = "iclass_use_vpn";

export const getToken = (): string => localStorage.getItem(TOKEN_KEY) ?? "";

export const setSession = (token: string, userId: string, userName: string, useVpn: boolean): void => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_ID_KEY, userId);
    localStorage.setItem(USER_NAME_KEY, userName);
    localStorage.setItem(USE_VPN_KEY, useVpn ? "1" : "0");
};

export const clearSession = (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(USER_NAME_KEY);
    localStorage.removeItem(USE_VPN_KEY);
};

export const getUserDisplay = (): { userId: string; userName: string } => ({
    userId: localStorage.getItem(USER_ID_KEY) ?? "",
    userName: localStorage.getItem(USER_NAME_KEY) ?? ""
});

export const getUseVpnMode = (): boolean => localStorage.getItem(USE_VPN_KEY) === "1";
