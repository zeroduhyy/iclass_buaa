import type { CourseDetailItem, CourseItem } from '../core/courseCore';
import { IClassClient } from '../core/IClassClient';
import { buildScanSignUrl } from '../core/signCore';
import logger from '../utils/logger';

export interface ServiceResult<T> {
	ok: boolean;
	code: string;
	message: string;
	data: T | null;
}

export interface SemesterCoursesData {
	semesterCode: string;
	courses: CourseItem[];
}

export interface SignQrData {
	qrUrl: string;
	courseSchedId: string;
	timestamp: number;
}

export interface SignTimeWindowResult {
	ok: boolean;
	message: string;
	windowStart?: number;
	windowEnd?: number;
}

const normalizeErrorMessage = (error: unknown): string => {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return '请求失败，请稍后重试';
};

const formatDateYmd = (date: Date): string => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}${month}${day}`;
};

const parseDateTimeMs = (dateYmd: string, hhmm: string): number | null => {
	const match = String(dateYmd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
	const timeMatch = String(hhmm).match(/^(\d{2}):(\d{2})/);
	if (!match || !timeMatch) {
		return null;
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(timeMatch[1]);
	const minute = Number(timeMatch[2]);

	const date = new Date(year, month - 1, day, hour, minute, 0, 0);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return date.getTime();
};

const mergeCourseDetails = (
	fromDetail: CourseDetailItem[],
	fromDateQuery: CourseDetailItem[]
): CourseDetailItem[] => {
	const merged: CourseDetailItem[] = [];
	const seen = new Set<string>();

	for (const item of [...fromDetail, ...fromDateQuery]) {
		const key = item.courseSchedId
			? `sched:${item.courseSchedId}`
			: `fallback:${item.id}|${item.date}|${item.name}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(item);
	}

	return merged;
};

export const loadSemesterAndCourses = async (
	client: IClassClient
): Promise<SemesterCoursesData> => {
	const semesterCode = await client.getCurrentSemester();
	if (!semesterCode) {
		throw new Error('未获取到当前学期');
	}

	const courses = await client.getCourses(semesterCode);
	return { semesterCode, courses };
};

export const loadCoursesDetail = async (
	client: IClassClient,
	courses: CourseItem[]
): Promise<CourseDetailItem[]> => {
	return await client.getCoursesDetail(courses);
};

export const getSemesterCoursesForFrontend = async (
	client: IClassClient
): Promise<ServiceResult<SemesterCoursesData>> => {
	try {
		const data = await loadSemesterAndCourses(client);
		return {
			ok: true,
			code: 'OK',
			message: '课程获取成功',
			data
		};
	} catch (error) {
		return {
			ok: false,
			code: 'COURSE_LIST_FAILED',
			message: normalizeErrorMessage(error),
			data: null
		};
	}
};

export const getMergedCourseDetailsForFrontend = async (
	client: IClassClient,
	courses: CourseItem[],
	futureDays: number = 7
): Promise<ServiceResult<{ details: CourseDetailItem[] }>> => {
	try {
		const detailData = await loadCoursesDetail(client, courses);
		const dateQueriedDetails: CourseDetailItem[] = [];

		for (let offset = 0; offset <= futureDays; offset += 1) {
			const date = new Date();
			date.setDate(date.getDate() + offset);
			const dateStr = formatDateYmd(date);
			try {
				const dayDetails = await client.getCourseByDate(dateStr);
				dateQueriedDetails.push(...dayDetails);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn(`[course-service] getCourseByDate failed for ${dateStr}: ${message}`);

				if (message.includes('dateStr 格式错误')) {
					throw error;
				}
			}
		}

		return {
			ok: true,
			code: 'OK',
			message: '课程详情获取成功',
			data: { details: mergeCourseDetails(detailData, dateQueriedDetails) }
		};
	} catch (error) {
		return {
			ok: false,
			code: 'COURSE_DETAIL_FAILED',
			message: normalizeErrorMessage(error),
			data: null
		};
	}
};

export const signNowForFrontend = async (
	client: IClassClient,
	courseSchedId: string,
	timestamp: number
): Promise<ServiceResult<any>> => {
	if (!courseSchedId) {
		return {
			ok: false,
			code: 'INVALID_PARAM',
			message: 'courseSchedId 不能为空',
			data: null
		};
	}

	try {
		const signResult = await client.signNow(courseSchedId, timestamp);
		return {
			ok: true,
			code: 'OK',
			message: '签到请求已提交',
			data: signResult
		};
	} catch (error) {
		return {
			ok: false,
			code: 'SIGN_FAILED',
			message: normalizeErrorMessage(error),
			data: null
		};
	}
};


export const generateSignQrForFrontend = async (
	useVpn: boolean,
	courseSchedId: string,
	timestamp: number
): Promise<ServiceResult<SignQrData>> => {
	if (useVpn) {
		return {
			ok: false,
			code: 'UNSUPPORTED_MODE',
			message: 'VPN 模式不支持生成二维码，请使用直接签到',
			data: null
		};
	}

	if (!courseSchedId) {
		return {
			ok: false,
			code: 'INVALID_PARAM',
			message: 'courseSchedId 不能为空',
			data: null
		};
	}

	const qrTimestamp = timestamp;
	const signUrl = buildScanSignUrl(useVpn);
	const qrUrl = `${signUrl}?courseSchedId=${encodeURIComponent(courseSchedId)}&timestamp=${encodeURIComponent(String(qrTimestamp))}`;

	return {
		ok: true,
		code: 'OK',
		message: '二维码链接生成成功',
		data: {
			qrUrl,
			courseSchedId,
			timestamp: qrTimestamp
		}
	};
};
