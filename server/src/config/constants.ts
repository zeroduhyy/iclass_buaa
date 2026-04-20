export const SSO_URLS = {
    LOGIN: "https://sso.buaa.edu.cn/login",
    VPN_LOGIN: "https://d.buaa.edu.cn/https/77726476706e69737468656265737421e3e44ed225256951300d8db9d6562d/login?service=https%3A%2F%2Fd.buaa.edu.cn%2Flogin%3Fcas_login%3Dtrue"
};

const VPN_BASE = "https://d.buaa.edu.cn/https-8347/77726476706e69737468656265737421f9f44d9d342326526b0988e29d51367ba018";
const DIRECT_BASE = "https://iclass.buaa.edu.cn:8347";

export const ICLASS_URLS = {
    VPN: {
        SERVICE_HOME: VPN_BASE,
        USER_LOGIN: `${VPN_BASE}/app/user/login.action`,
        COURSE_LIST: `${VPN_BASE}/app/choosecourse/get_myall_course.action`,
        SEMESTER_LIST: `${VPN_BASE}/app/course/get_base_school_year.action`,
        COURSE_SIGN_DETAIL: `${VPN_BASE}/app/my/get_my_course_sign_detail.action`,
        SCAN_SIGN: `${VPN_BASE}/app/course/stu_scan_sign.action`,
        COURSE_SCHEDULE_BY_DATE: `${VPN_BASE}/app/course/get_stu_course_sched.action`
    },
    DIRECT: {
        SERVICE_HOME: DIRECT_BASE,
        USER_LOGIN: `${DIRECT_BASE}/app/user/login.action`,
        COURSE_LIST: `${DIRECT_BASE}/app/choosecourse/get_myall_course.action`,
        SEMESTER_LIST: `${DIRECT_BASE}/app/course/get_base_school_year.action`,
        COURSE_SIGN_DETAIL: `${DIRECT_BASE}/app/my/get_my_course_sign_detail.action`,
        //SCAN_SIGN: `${DIRECT_BASE}/eschool/app/course/stu_scan_sign.action`,
        SCAN_SIGN: 'http://iclass.buaa.edu.cn:8081/app/course/stu_scan_sign.action',
        COURSE_SCHEDULE_BY_DATE: `${DIRECT_BASE}/app/course/get_stu_course_sched.action`
    }
} as const;

// Apply a conservative negative correction for VPN time sync to avoid future timestamps.
export const VPN_OFFSET_CORRECTION_MS = -1000;

