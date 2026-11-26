import got, { Got } from 'got';
import { CookieJar } from 'tough-cookie';
import { PendingCaptcha, ssoLogin } from './authCore';
import { CourseDetailItem, CourseItem, getCourseByDate as getCourseByDateCore, getCourses, getCoursesDetail, getCurrentSemester } from './courseCore';
import { getServerTimestamp, signNow as signNowOnline } from './signCore';
import { fetchSignCredential, fetchUserInfoFromApi, resolveIclassLoginName } from './userCore';

export interface IClassLoginInput {
    studentId: string;
    password: string;
    /** Answer to the captcha of [pending], when the previous attempt asked for one. */
    captcha?: string;
    pending?: PendingCaptcha | null;
}

export class IClassClient {
    public client: Got;
    public userInfo: any = null;
    public sessionId: string | null = null;
    public loginName: string | null = null;

    constructor(public readonly useVpn: boolean = false) {
        const cookieJar = new CookieJar();
        this.client = got.extend({
            cookieJar,
            timeout: {
                request: 15000
            },
            https: {
                rejectUnauthorized: true
            },
            throwHttpErrors: false
        });
    }

    async login(input: IClassLoginInput): Promise<void> {
        const studentId = String(input.studentId ?? '').trim();
        const password = String(input.password ?? '');

        if (!studentId) {
            throw new Error('studentId 不能为空');
        }

        if (!password) {
            throw new Error('请输入统一认证密码');
        }

        await ssoLogin(this.client, studentId, password, this.useVpn, {
            captcha: input.captcha,
            pending: input.pending
        });
        const loginName = await resolveIclassLoginName(this.client, this.useVpn);
        if (!loginName) {
            throw new Error('无法从 iClass 跳转解析 loginName');
        }
        this.loginName = loginName;
        await this.fetchUserInfo(loginName);
    }

    async fetchUserInfo(username: string): Promise<void> {
        const info = await fetchUserInfoFromApi(this.client, this.useVpn, username);
        this.userInfo = info.userInfo;
        // The current Class API expects the transient loginName in the Sessionid
        // header. Keep the response sessionId only as parsed response metadata.
        this.sessionId = username;
    }

    async getCurrentSemester(): Promise<string | null> {
        const userId = this.userInfo?.id;
        const sessionId = this.sessionId;
        if (!userId || !sessionId) {
            throw new Error('缺少 userId 或 sessionId，请先登录并获取用户信息');
        }

        return await getCurrentSemester(this.client, this.useVpn, String(userId), sessionId);
    }

    async getCourses(semesterCode: string): Promise<CourseItem[]> {
        const userId = this.userInfo?.id;
        const sessionId = this.sessionId;
        if (!userId || !sessionId) {
            throw new Error('缺少 userId 或 sessionId，请先登录并获取用户信息');
        }

        return await getCourses(
            this.client,
            this.useVpn,
            String(userId),
            sessionId,
            semesterCode
        );
    }

    async getCoursesDetail(courses: CourseItem[]): Promise<CourseDetailItem[]> {
        const userId = this.userInfo?.id;
        const sessionId = this.sessionId;
        if (!userId || !sessionId) {
            throw new Error('缺少 userId 或 sessionId，请先登录并获取用户信息');
        }

        return await getCoursesDetail(
            this.client,
            this.useVpn,
            String(userId),
            sessionId,
            courses
        );
    }

    async getCourseByDate(dateStr: string): Promise<CourseDetailItem[]> {
        const userId = this.userInfo?.id;
        const sessionId = this.sessionId;
        if (!userId || !sessionId) {
            throw new Error('缺少 userId 或 sessionId，请先登录并获取用户信息');
        }

        return await getCourseByDateCore(
            this.client,
            this.useVpn,
            String(userId),
            sessionId,
            dateStr
        );
    }


    async getSignTimestamp(): Promise<number> {
        const userId = this.userInfo?.id;
        const sessionId = this.sessionId;
        if (!userId || !sessionId) {
            throw new Error('缺少 userId 或 sessionId，请先登录并获取用户信息');
        }

        return await getServerTimestamp(
            this.client,
            this.useVpn,
            String(userId),
            sessionId
        );
    }

    async signNow(courseSchedId: string): Promise<any> {
        if (!this.userInfo?.id || !this.sessionId) {
            throw new Error('缺少 userId 或 sessionId，请先登录并获取用户信息');
        }

        // The sign endpoint only accepts the real id + sessionId from the app login; the
        // loginName used as Sessionid for queries is rejected (302 to its error page).
        const credential = await fetchSignCredential(this.client, this.useVpn, this.loginName);
        return await signNowOnline(
            this.client,
            this.useVpn,
            credential.userId,
            credential.sessionId,
            courseSchedId
        );
    }
}
