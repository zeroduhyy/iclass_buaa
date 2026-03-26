import type { Got } from 'got';
import { ICLASS_URLS } from '../config/constants'
import logger from '../utils/logger';

export interface CourseItem {
    name: string;
    id: string;
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

const normalizeDateDisplay = (raw: string): string => {
    const value = String(raw ?? '').trim();
    if (!value) {
        return '';
    }

    // Accept both YYYYMMDD and YYYY-MM-DD / YYYY-M-D by extracting digits.
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8) {
        const y = digits.slice(0, 4);
        const m = digits.slice(4, 6);
        const d = digits.slice(6, 8);
        return `${y}-${m}-${d}`;
    }

    // Unknown format: return as-is to avoid fabricating dates.
    return value;
};

const normalizeTimeDisplay = (raw: string): string => {
    const value = String(raw ?? '').trim();
    if (!value) {
        return '';
    }

    // Common iClass format: YYYY-MM-DD HH:mm:ss
    const spaceIdx = value.indexOf(' ');
    const timePart = spaceIdx >= 0 ? value.slice(spaceIdx + 1) : value;

    const match = timePart.match(/^(\d{1,2}):(\d{2})/);
    if (!match) {
        return timePart;
    }

    const hh = match[1].padStart(2, '0');
    const mm = match[2];
    return `${hh}:${mm}`;
};

const isValidDateStr = (dateStr: string): boolean => {
    if (!/^\d{8}$/.test(dateStr)) {
        return false;
    }

    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(4, 6));
    const day = Number(dateStr.slice(6, 8));
    const date = new Date(year, month - 1, day);

    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
};

export const getCurrentSemester = async (
    client: Got,
    useVpn: boolean,
    userId: string,
    sessionId: string
): Promise<string | null> => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    const params = {
        userId,
        type: '2'
    };
    const headers = { sessionId };

    const res = await client.get(ICLASS_URLS[network].SEMESTER_LIST, {
        searchParams: params,
        headers
    });

    if (res.statusCode !== 200) {
        return null;
    }

    let data: any;
    try {
        data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    } catch {
        return null;
    }

    if (data?.STATUS !== '0') {
        return null;
    }

    const semesters = Array.isArray(data?.result) ? data.result : [];
    let currentSemester: string | null = null;

    for (const semester of semesters) {
        if (semester?.yearStatus === '1') {
            currentSemester = semester?.code ?? null;
            break;
        }
    }

    if (!currentSemester && semesters.length > 0) {
        currentSemester = semesters[0]?.code ?? null;
    }

    return currentSemester;
};

export const getCourses = async (
    client: Got,
    useVpn: boolean,
    userId: string,
    sessionId: string,
    semesterCode: string
): Promise<CourseItem[]> => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    const params = {
        user_type: '1',
        id: userId,
        xq_code: semesterCode
    };
    const headers = { sessionId };

    const res = await client.get(
        ICLASS_URLS[network].COURSE_LIST,
        {
            searchParams: params,
            headers
        }
    );

    if (res.statusCode !== 200) {
        return [];
    }

    let data: any;
    try {
        data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    } catch {
        return [];
    }

    if (data?.STATUS !== '0') {
        return [];
    }

    const courseData = Array.isArray(data?.result) ? data.result : [];

    const courses: CourseItem[] = [];
    for (const course of courseData) {
        const name = course?.course_name ? course.course_name : '未知课程';
        const id = course?.course_id ? String(course.course_id) : '';
        if (id) {
            courses.push({ name, id });
        }
    }

    return courses;
};

export const getCoursesDetail = async (
    client: Got,
    useVpn: boolean,
    userId: string,
    sessionId: string,
    courses: CourseItem[]
): Promise<CourseDetailItem[]> => {
    const network = useVpn ? 'VPN' : 'DIRECT';
    const courseInfoUrl = `${ICLASS_URLS[network].COURSE_SIGN_DETAIL}?id=${userId}&courseId=`;
    const availableCourses: CourseDetailItem[] = [];

    for (const course of courses) {
        const courseName = course.name;
        const courseId = course.id;

        const courseUrl = `${courseInfoUrl}${courseId}&sessionId=${sessionId}`;
        const courseRes = await client.get(courseUrl);

        let courseData: any;
        try {
            courseData = typeof courseRes.body === 'string' ? JSON.parse(courseRes.body) : courseRes.body;
        } catch {
            continue;
        }

        logger.info(`[getCoursesDetail] ${courseName}:${courseId}`);

        if (!('result' in courseData) || !courseData.result) {
            continue;
        }

        const records = Array.isArray(courseData.result) ? courseData.result : [];
        if (records.length === 0) {
            continue;
        }

        records.sort((a: any, b: any) => String(b?.teachTime ?? '').localeCompare(String(a?.teachTime ?? '')));

        for (const record of records) {
            const teachDate = String(record?.teachTime ?? '');
            const formattedDate = normalizeDateDisplay(teachDate);

            availableCourses.push({
                name: courseName,
                id: courseId,
                courseSchedId: String(record?.courseSchedId ?? ''),
                date: formattedDate,
                startTime: normalizeTimeDisplay(String(record?.classBeginTime ?? '')),
                endTime: normalizeTimeDisplay(String(record?.classEndTime ?? '')),
                signStatus: String(record?.signStatus ?? '')
            });
        }
    }

    return availableCourses;
};



export const getCourseByDate = async (
    client: Got,
    useVpn: boolean,
    userId: string,
    sessionId: string,
    dateStr: string
): Promise<CourseDetailItem[]> => {
    if (!isValidDateStr(dateStr)) {
        throw new Error(`dateStr 格式错误，应为 YYYYMMDD，当前值: ${dateStr}`);
    }

    const network = useVpn ? 'VPN' : 'DIRECT';

    const params = {
        id: userId,
        dateStr
    };
    const headers = { sessionId };
    const res = await client.get(ICLASS_URLS[network].COURSE_SCHEDULE_BY_DATE, {
        searchParams: params,
        headers
    });

    if (res.statusCode !== 200) {
        return [];
    }

    let data: any;
    try {
        data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    } catch {
        return [];
    }

    // iClass STATUS=2 表示当天无数据，按空数组处理。
    if (data?.STATUS === '2') {
        return [];
    }
    if (data?.STATUS !== '0') {
        return [];
    }

    const records = Array.isArray(data?.result) ? data.result : [];
    const details: CourseDetailItem[] = [];

    for (const record of records) {
        const teachDate = String(record?.teachTime ?? dateStr ?? '');
        const formattedDate = normalizeDateDisplay(teachDate);

        details.push({
            name: String(record?.courseName ?? '未知课程'),
            id: String(record?.courseId ?? ''),
            courseSchedId: String(record?.id ?? ''),
            date: formattedDate,
            startTime: normalizeTimeDisplay(String(record?.classBeginTime ?? '')),
            endTime: normalizeTimeDisplay(String(record?.classEndTime ?? '')),
            signStatus: String(record?.signStatus ?? '')
        });
    }

    return details;
};