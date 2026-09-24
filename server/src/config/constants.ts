export const SSO_URLS = {
    LOGIN: "https://sso.buaa.edu.cn/login",
    VPN_LOGIN: "https://d.buaa.edu.cn/https/77726476706e69737468656265737421e3e44ed225256951300d8db9d6562d/login?service=https%3A%2F%2Fd.buaa.edu.cn%2Flogin%3Fcas_login%3Dtrue"
};

const WEBVPN_HOST = "https://d.buaa.edu.cn";
/** WebVPN 网关的加密主机名。它与**端口无关**，iclass 的 8346/8347/8081 共用同一串。 */
const WEBVPN_TOKEN = "77726476706e69737468656265737421f9f44d9d342326526b0988e29d51367ba018";

/** 8347：iClass 主站（登录、课程列表、课表、签到明细） */
const VPN_BASE = `${WEBVPN_HOST}/https-8347/${WEBVPN_TOKEN}`;
const DIRECT_BASE = "https://iclass.buaa.edu.cn:8347";

/**
 * 8081：签到专用服务（stu_scan_sign.action / common/get_timestamp.action）。
 *
 * 注意 WebVPN 前缀里的 scheme 必须与真实端口一致：8081 是 **http**，所以是 `http-8081`。
 * 写成 `https-8081` 会被网关直接拒掉（302 -> /wengine-vpn/failed）。
 * 这一点是 2026-09-22 实测确认的，别再改回去。
 */
const VPN_BASE_8081 = `${WEBVPN_HOST}/http-8081/${WEBVPN_TOKEN}`;
const DIRECT_BASE_8081 = "http://iclass.buaa.edu.cn:8081";

export const ICLASS_URLS = {
    VPN: {
        SERVICE_HOME: VPN_BASE,
        MY_CENTER: `${WEBVPN_HOST}/https-8346/${WEBVPN_TOKEN}/?type=jumpMyCenter`,
        USER_LOGIN: `${VPN_BASE}/app/user/login.action`,
        COURSE_LIST: `${VPN_BASE}/app/choosecourse/get_myall_course.action`,
        SEMESTER_LIST: `${VPN_BASE}/app/course/get_base_school_year.action`,
        COURSE_SIGN_DETAIL: `${VPN_BASE}/app/my/get_my_course_sign_detail.action`,
        COURSE_SCHEDULE_BY_DATE: `${VPN_BASE}/app/course/get_stu_course_sched.action`,
        /**
         * 签到用的**服务端时间戳**。iClass 的签到接口只认它自己下发的时间戳，
         * 客户端用 Date.now() 造的值会被判 ERRCODE 100 参数错误。
         */
        SIGN_TIMESTAMP: `${VPN_BASE_8081}/app/common/get_timestamp.action`,
        /** 兜底：万一 8081 的网关路由不可用，试一下 8347 主站同路径 */
        SIGN_TIMESTAMP_FALLBACK: `${VPN_BASE}/app/common/get_timestamp.action`,
        SCAN_SIGN: `${VPN_BASE_8081}/app/course/stu_scan_sign.action`
    },
    DIRECT: {
        SERVICE_HOME: DIRECT_BASE,
        MY_CENTER: "https://iclass.buaa.edu.cn:8346/?type=jumpMyCenter",
        USER_LOGIN: `${DIRECT_BASE}/app/user/login.action`,
        COURSE_LIST: `${DIRECT_BASE}/app/choosecourse/get_myall_course.action`,
        SEMESTER_LIST: `${DIRECT_BASE}/app/course/get_base_school_year.action`,
        COURSE_SIGN_DETAIL: `${DIRECT_BASE}/app/my/get_my_course_sign_detail.action`,
        COURSE_SCHEDULE_BY_DATE: `${DIRECT_BASE}/app/course/get_stu_course_sched.action`,
        SIGN_TIMESTAMP: `${DIRECT_BASE_8081}/app/common/get_timestamp.action`,
        SIGN_TIMESTAMP_FALLBACK: `${DIRECT_BASE}/app/common/get_timestamp.action`,
        SCAN_SIGN: `${DIRECT_BASE_8081}/app/course/stu_scan_sign.action`
    }
} as const;

// Apply a conservative negative correction for VPN time sync to avoid future timestamps.
export const VPN_OFFSET_CORRECTION_MS = -1000;
