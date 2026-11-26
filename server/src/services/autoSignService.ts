import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CourseDetailItem, CourseItem } from '../core/courseCore';
import { chinaTimeToMs, formatChinaTime } from '../utils/chinaTime';
import logger from '../utils/logger';
import { CaptchaChallenge, LoginContext, loginAndBuildContext, NetworkMode } from './authService';
import { getMergedCourseDetailsForFrontend, getSemesterCoursesForFrontend } from './courseService';

/** Sign-in time choices: minutes before class start (negative = after the start). */
export const SIGN_OFFSET_CHOICES = [10, 5, 3, 1, 0, -5];
const DEFAULT_OFFSET_MINUTES = 5;
const LOOKAHEAD_DAYS = 7;
const TICK_MS = 30 * 1000;
const RETRY_DELAY_MS = 3 * 60 * 1000;
/** Re-reads the timetable this often even with nothing due, to pick up changes. */
const RECHECK_MS = 30 * 60 * 1000;

export interface SavedLogin {
    studentId: string;
    password: string;
    networkMode: NetworkMode;
}

export interface AutoSignStatus {
    enabled: boolean;
    offsetMinutes: number;
    offsetChoices: number[];
    hasSavedLogin: boolean;
    /** False when the saved login cannot survive a restart (dev mode without Electron). */
    persistent: boolean;
    studentId: string;
    nextTriggerAt: number | null;
    nextTriggerText: string;
    nextCourseName: string;
    lastRunAt: number | null;
    lastMessage: string;
    needsCaptcha: boolean;
    recent: string[];
}

interface AutoSignConfig {
    enabled: boolean;
    offsetMinutes: number;
}

/** Messages to the Electron main process (only when started by it). */
type MainMessage =
    | { type: 'save-credentials'; studentId: string; password: string; networkMode: NetworkMode }
    | { type: 'forget-credentials' }
    | { type: 'notify'; title: string; body: string }
    | { type: 'status'; text: string };

const sendToMain = (message: MainMessage): void => {
    if (typeof process.send === 'function') {
        process.send(message);
    }
};

const configDir = process.env.AUTO_SIGN_DIR || path.join(os.homedir(), '.iclass-buaa-dev');
const configFile = path.join(configDir, 'auto-sign.json');

const loadConfig = (): AutoSignConfig => {
    try {
        const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        const offset = Number(raw?.offsetMinutes);
        return {
            enabled: raw?.enabled === true,
            offsetMinutes: SIGN_OFFSET_CHOICES.includes(offset) ? offset : DEFAULT_OFFSET_MINUTES
        };
    } catch {
        return { enabled: false, offsetMinutes: DEFAULT_OFFSET_MINUTES };
    }
};

const saveConfig = (config: AutoSignConfig): void => {
    try {
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        logger.warn(`[auto-sign] 保存设置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const state = {
    config: loadConfig(),
    saved: null as SavedLogin | null,
    context: null as LoginContext | null,
    enrolled: [] as CourseItem[],
    nextCheckAt: 0,
    nextTriggerAt: null as number | null,
    nextCourseName: '',
    lastRunAt: null as number | null,
    lastMessage: '',
    needsCaptcha: false,
    running: false,
    /** Set once the Electron main process said whether a login is saved. */
    credentialsKnown: typeof process.send !== 'function',
    recent: [] as string[]
};

/** Waits (briefly) for the saved login from the Electron main process at startup. */
export const waitForSavedLogin = async (timeoutMs = 3000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!state.credentialsKnown && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

const record = (message: string): void => {
    state.lastMessage = message;
    state.recent = [`${formatChinaTime(Date.now())} ${message}`, ...state.recent].slice(0, 20);
    logger.info(`[auto-sign] ${message}`);
};

const pushTrayStatus = (): void => {
    let text = '自动签到：未开启';
    if (state.config.enabled) {
        if (state.needsCaptcha) {
            text = '自动签到：需要打开程序输入验证码';
        } else if (state.nextTriggerAt) {
            text = `自动签到：下次 ${formatChinaTime(state.nextTriggerAt)} ${state.nextCourseName}`;
        } else {
            text = '自动签到：已开启，暂无待签课程';
        }
    }
    sendToMain({ type: 'status', text });
};

export const getAutoSignStatus = (): AutoSignStatus => ({
    enabled: state.config.enabled,
    offsetMinutes: state.config.offsetMinutes,
    offsetChoices: SIGN_OFFSET_CHOICES,
    hasSavedLogin: state.saved !== null,
    persistent: typeof process.send === 'function',
    studentId: state.saved?.studentId ?? '',
    nextTriggerAt: state.config.enabled ? state.nextTriggerAt : null,
    nextTriggerText: state.config.enabled && state.nextTriggerAt ? formatChinaTime(state.nextTriggerAt) : '',
    nextCourseName: state.config.enabled ? state.nextCourseName : '',
    lastRunAt: state.lastRunAt,
    lastMessage: state.lastMessage,
    needsCaptcha: state.needsCaptcha,
    recent: state.recent
});

/** Remembers the login (encrypted by the Electron main process) and reuses its session. */
export const rememberLogin = (login: SavedLogin, context: LoginContext): void => {
    state.saved = login;
    state.context = context;
    state.needsCaptcha = false;
    sendToMain({ type: 'save-credentials', ...login });
    scheduleSoon();
};

/** Forgets the saved login and turns auto-sign off (used on logout). */
export const forgetLogin = (): void => {
    state.saved = null;
    state.context = null;
    state.enrolled = [];
    state.config = { ...state.config, enabled: false };
    state.nextTriggerAt = null;
    state.nextCourseName = '';
    saveConfig(state.config);
    sendToMain({ type: 'forget-credentials' });
    pushTrayStatus();
};

export const updateAutoSign = (changes: { enabled?: boolean; offsetMinutes?: number }): AutoSignStatus => {
    if (changes.enabled === true && !state.saved) {
        throw new Error('需要先在登录时勾选「记住登录」，后台才能自动登录并签到');
    }
    const offset = Number(changes.offsetMinutes);
    state.config = {
        enabled: changes.enabled ?? state.config.enabled,
        offsetMinutes: SIGN_OFFSET_CHOICES.includes(offset) ? offset : state.config.offsetMinutes
    };
    saveConfig(state.config);
    if (state.config.enabled) {
        record(changes.enabled === true ? '自动签到已开启' : '签到时间已更新');
        scheduleSoon();
    } else {
        state.nextTriggerAt = null;
        state.nextCourseName = '';
        record('自动签到已关闭');
    }
    pushTrayStatus();
    return getAutoSignStatus();
};

/** The background session, logging in with the saved credentials when needed. */
export const ensureBackgroundContext = async (): Promise<LoginContext> => {
    if (state.context) {
        return state.context;
    }
    if (!state.saved) {
        throw new Error('没有保存的登录信息');
    }
    try {
        state.context = await loginAndBuildContext({ ...state.saved });
        state.enrolled = [];
        state.needsCaptcha = false;
        return state.context;
    } catch (error) {
        if (error instanceof CaptchaChallenge) {
            if (!state.needsCaptcha) {
                state.needsCaptcha = true;
                sendToMain({
                    type: 'notify',
                    title: '自动签到需要验证码',
                    body: '学校要求输入验证码，请打开 iClass 签到并重新登录'
                });
            }
            throw new Error('登录需要输入验证码，请打开程序重新登录');
        }
        throw error;
    }
};

const scheduleSoon = (): void => {
    state.nextCheckAt = 0;
};

/**
 * The by-date query also returns the same lesson for other teaching sections. Keep one
 * record per lesson: the section the student is enrolled in, else a signed one, else the
 * first. Signing another section's lesson would be wrong.
 */
const pickOwnLessons = (items: CourseDetailItem[], enrolledIds: Set<string>): CourseDetailItem[] => {
    const groups = new Map<string, CourseDetailItem[]>();
    for (const item of items) {
        const key = `${item.date}|${item.startTime}|${item.endTime}|${item.name}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()].map((group) =>
        group.find((item) => enrolledIds.has(item.id))
        ?? group.find((item) => item.signStatus === '1')
        ?? group[0]
    );
};

const loadLessons = async (context: LoginContext): Promise<CourseDetailItem[]> => {
    if (state.enrolled.length === 0) {
        const courses = await getSemesterCoursesForFrontend(context.client);
        if (!courses.ok || !courses.data) {
            throw new Error(courses.message);
        }
        state.enrolled = courses.data.courses;
    }
    const details = await getMergedCourseDetailsForFrontend(context.client, state.enrolled, LOOKAHEAD_DAYS);
    if (!details.ok || !details.data) {
        throw new Error(details.message);
    }
    return pickOwnLessons(details.data.details, new Set(state.enrolled.map((course) => course.id)));
};

/**
 * One pass: signs every lesson whose window is open (from the chosen minutes before class
 * until class ends, Beijing time), then plans the next check. Failed lessons are retried
 * every few minutes while their window is open.
 */
const runCycle = async (): Promise<void> => {
    const now = Date.now();
    state.lastRunAt = now;
    let lessons: CourseDetailItem[];
    try {
        let context = await ensureBackgroundContext();
        try {
            lessons = await loadLessons(context);
        } catch {
            // The iClass session may have expired: log in again once.
            state.context = null;
            context = await ensureBackgroundContext();
            lessons = await loadLessons(context);
        }
    } catch (error) {
        record(error instanceof Error ? error.message : String(error));
        state.nextCheckAt = now + (state.needsCaptcha ? RECHECK_MS : RETRY_DELAY_MS);
        return;
    }

    const offsetMs = state.config.offsetMinutes * 60 * 1000;
    const windows = lessons
        .filter((lesson) => lesson.signStatus !== '1')
        .map((lesson) => {
            const start = chinaTimeToMs(lesson.date, lesson.startTime);
            const end = chinaTimeToMs(lesson.date, lesson.endTime);
            return start === null || end === null ? null : { lesson, open: start - offsetMs, end };
        })
        .filter((item): item is { lesson: CourseDetailItem; open: number; end: number } => item !== null);

    let retry = false;
    for (const { lesson, open, end } of windows) {
        if (now < open || now > end) {
            continue;
        }
        try {
            await state.context!.client.signNow(lesson.courseSchedId);
            lesson.signStatus = '1';
            record(`已签到：${lesson.name}`);
            sendToMain({ type: 'notify', title: '自动签到成功', body: `${lesson.name}（${lesson.startTime}）` });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            record(`签到失败：${lesson.name}，${message}`);
            if (end > now + RETRY_DELAY_MS) {
                retry = true;
            } else {
                sendToMain({ type: 'notify', title: '自动签到失败', body: `${lesson.name}：${message}` });
            }
        }
    }

    const upcoming = windows
        .filter(({ lesson, open }) => lesson.signStatus !== '1' && open > now)
        .sort((a, b) => a.open - b.open)[0];
    state.nextTriggerAt = upcoming?.open ?? null;
    state.nextCourseName = upcoming?.lesson.name ?? '';
    state.nextCheckAt = Math.min(
        upcoming?.open ?? Number.POSITIVE_INFINITY,
        retry ? now + RETRY_DELAY_MS : Number.POSITIVE_INFINITY,
        now + RECHECK_MS
    );
};

const tick = async (): Promise<void> => {
    if (!state.config.enabled || !state.saved || state.running || Date.now() < state.nextCheckAt) {
        return;
    }
    state.running = true;
    try {
        await runCycle();
    } catch (error) {
        record(error instanceof Error ? error.message : String(error));
        state.nextCheckAt = Date.now() + RETRY_DELAY_MS;
    } finally {
        state.running = false;
        pushTrayStatus();
    }
};

/**
 * Starts the scheduler. It checks every 30 seconds whether a planned time has passed, so a
 * computer waking from sleep catches up instead of relying on one long timer.
 */
export const startAutoSign = (): void => {
    process.on('message', (message: any) => {
        if (message?.type === 'credentials-none') {
            state.credentialsKnown = true;
        }
        if (message?.type === 'credentials' && message.studentId && message.password) {
            state.credentialsKnown = true;
            state.saved = {
                studentId: String(message.studentId),
                password: String(message.password),
                networkMode: ['auto', 'direct', 'vpn'].includes(message.networkMode) ? message.networkMode : 'auto'
            };
            logger.info('[auto-sign] 已读取保存的登录信息');
            scheduleSoon();
            pushTrayStatus();
        }
    });
    setInterval(() => void tick(), TICK_MS);
    setTimeout(() => void tick(), 3000);
    pushTrayStatus();
};
