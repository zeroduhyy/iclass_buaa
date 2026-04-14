import got, { Got } from 'got';
import { CookieJar } from 'tough-cookie';
import { vpnLogin } from './authCore';
import { CourseDetailItem, CourseItem, getCourseByDate as getCourseByDateCore, getCourses, getCoursesDetail, getCurrentSemester } from './courseCore';
import { signNow as signNowOnline } from './signCore';
import { fetchUserInfoFromApi } from './userCore';

export interface IClassLoginInput {
    studentId: string;
    vpnUsername?: string;
    vpnPassword?: string;
}

export class IClassClient {
    public client: Got;
    public userInfo: any = null;
    public sessionId: string | null = null;
    public serverTimeOffset: number = 0;

    constructor(
        private useVpn: boolean = false
    ) {
        const jar = new CookieJar();
        this.client = got.extend({
            cookieJar: jar,
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
        const vpnUsername = String(input.vpnUsername ?? '').trim();
        const vpnPassword = String(input.vpnPassword ?? '');

        if (!studentId) {
            throw new Error('studentId 不能为空');
        }

        if (this.useVpn) {
            await vpnLogin(this.client, vpnUsername, vpnPassword);
            await this.fetchUserInfo(studentId);
            return;
        }


        await this.fetchUserInfo(studentId);
    }

    async fetchUserInfo(username: string): Promise<void> {
        const info = await fetchUserInfoFromApi(this.client, this.useVpn, username);
        this.userInfo = info.userInfo;
        this.sessionId = info.sessionId;
        this.serverTimeOffset = info.serverTimeOffset;
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


    async signNow(courseSchedId: string, timestamp: number): Promise<any> {
        const userId = this.userInfo?.id;
        const sessionId = this.sessionId;
        if (!userId || !sessionId) {
            throw new Error('缺少 userId 或 sessionId，请先登录并获取用户信息');
        }

        return await signNowOnline(
            this.client,
            this.useVpn,
            String(userId),
            sessionId,
            courseSchedId,
            timestamp
        );
    }
}
