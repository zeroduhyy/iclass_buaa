import type { CourseDetailItem, CourseItem } from '../core/courseCore';
import { IClassClient } from '../core/IClassClient';
import { buildScanSignUrl, SignRequestResult, SignTimestampSource } from '../core/signCore';
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

export interface SignVerifyResult {
	/** 是否成功发起了复检请求（false 表示网络等原因没查到） */
	checked: boolean;
	/** 复检读到的 signStatus，null 表示没查到该节次 */
	signStatus: string | null;
	/** 复检判定：signStatus === '1' */
	signed: boolean;
	/** 复检过程中的异常信息 */
	error?: string;
}

export interface SignOutcomeData {
	courseSchedId: string;
	/** 实际提交给 iClass 的时间戳（毫秒） */
	timestamp: number;
	/** 时间戳来源：server = iClass 下发（正常）；qr = 二维码自带；local = 本机时钟兜底（不可靠） */
	timestampSource: SignTimestampSource;
	/** 取到服务端时间戳的地址（source === 'server' 时有值） */
	timestampUrl: string | null;
	/** 取服务端时间戳失败时的原因 */
	timestampError?: string;
	/** 实际提交给 iClass 的完整参数集（便于排查"到底发了什么"） */
	submittedParams: Record<string, string>;
	/** 提交时间戳与本机（已校正）时钟的差值，毫秒。负数=比本机时钟旧 */
	timestampSkewMs: number | null;
	/** 实际请求的签到地址 */
	signUrl: string;
	/** 一共提交了几次（二维码时间戳被拒后会换服务端时间戳再试） */
	attempts: number;
	/** iClass 原始返回，便于排查 */
	iclassStatus: string;
	iclassErrCode: string;
	iclassErrMsg: string;
	iclassRaw: unknown;
	verify: SignVerifyResult;
}

export interface ParsedSignQr {
	ok: boolean;
	message: string;
	courseSchedId?: string;
	timestamp?: number;
	/** 链接里的全部 query 参数，原样保留 */
	params?: Record<string, string>;
}

/**
 * 解析老师二维码里的链接（或纯 query 串）。
 *
 * 关键点：**原样保留全部参数**，不只取 courseSchedId/timestamp —— 如果 iClass 的
 * 二维码里还有我们不知道的参数，透传过去才有机会成功；同时把全部参数打印出来，
 * 本身就是最有力的诊断信息。
 */
export const parseSignQrUrl = (raw: string): ParsedSignQr => {
	const value = String(raw ?? '').trim();
	if (!value) {
		return { ok: false, message: '二维码链接为空' };
	}

	const params: Record<string, string> = {};
	try {
		const withoutHash = value.split('#')[0];
		const queryIdx = withoutHash.indexOf('?');
		const query = queryIdx >= 0 ? withoutHash.slice(queryIdx + 1) : withoutHash;
		for (const [k, v] of new URLSearchParams(query).entries()) {
			params[k] = v;
		}
	} catch {
		return { ok: false, message: '二维码链接解析失败，请确认粘贴的是完整链接' };
	}

	const findKey = (name: string): string | undefined =>
		Object.keys(params).find((k) => k.toLowerCase() === name.toLowerCase());

	const schedKey = findKey('courseSchedId');
	const tsKey = findKey('timestamp');

	const missing: string[] = [];
	if (!schedKey) missing.push('courseSchedId');
	if (!tsKey) missing.push('timestamp');

	if (missing.length > 0) {
		const found = Object.keys(params).join(', ') || '（没有解析到任何参数）';
		return {
			ok: false,
			message: `二维码链接里缺少 ${missing.join('、')}；实际解析到的参数：${found}`,
			params
		};
	}

	const ts = Number(params[tsKey as string]);
	return {
		ok: true,
		message: '解析成功',
		courseSchedId: params[schedKey as string],
		timestamp: Number.isFinite(ts) ? ts : undefined,
		params
	};
};

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

/**
 * 复检：重新拉取当日课表，读取该节次的真实 signStatus。
 * iClass 的 signStatus 是唯一可信的签到结果来源，接口返回的 STATUS 只能说明请求被受理。
 */
const readSignStatus = async (
	client: IClassClient,
	courseSchedId: string
): Promise<SignVerifyResult> => {
	try {
		const items = await client.getCourseByDate(formatDateYmd(new Date()));
		const hit = items.find((item) => String(item.courseSchedId) === String(courseSchedId));
		if (!hit) {
			return {
				checked: true,
				signStatus: null,
				signed: false,
				error: '当日课表中未找到该节次，无法确认签到状态'
			};
		}

		return {
			checked: true,
			signStatus: hit.signStatus,
			signed: hit.signStatus === '1'
		};
	} catch (error) {
		return {
			checked: false,
			signStatus: null,
			signed: false,
			error: normalizeErrorMessage(error)
		};
	}
};

/**
 * 发起签到并复检。
 *
 * 注意：iClass 的 stu_scan_sign 只要请求被受理就返回 HTTP 200，失败时
 * STATUS='1' + ERRCODE/ERRMSG 一并放在 200 的 body 里。因此这里绝不把
 * "HTTP 通了" 当作签到成功，必须以复检到的 signStatus === '1' 为准。
 */
export const signNowForFrontend = async (
	client: IClassClient,
	courseSchedId: string,
	extraParams?: Record<string, string>
): Promise<ServiceResult<SignOutcomeData>> => {
	if (!courseSchedId) {
		return {
			ok: false,
			code: 'INVALID_PARAM',
			message: 'courseSchedId 不能为空',
			data: null
		};
	}

	// 时间戳由 IClassClient 内部向 iClass 索取（get_timestamp.action），
	// 不再由调用方用本机时钟拼 —— 本机时间戳会被 iClass 判 ERRCODE 100。
	let request: SignRequestResult;
	try {
		request = await client.signNow(courseSchedId, extraParams);
	} catch (error) {
		return {
			ok: false,
			code: 'SIGN_REQUEST_FAILED',
			message: `签到请求发送失败：${normalizeErrorMessage(error)}`,
			data: null
		};
	}

	const iclassRaw = request.response;
	const iclassStatus = String(iclassRaw?.STATUS ?? '');
	const iclassErrCode = String(iclassRaw?.ERRCODE ?? '');
	const iclassErrMsg = String(iclassRaw?.ERRMSG ?? '');

	// 实际提交出去的那一套参数：query（courseSchedId/timestamp）+ 表单体（id）
	const submittedParams: Record<string, string> = {
		...request.query,
		...request.form
	};

	const verify = await readSignStatus(client, courseSchedId);
	const data: SignOutcomeData = {
		courseSchedId,
		timestamp: request.timestamp,
		timestampSource: request.timestampSource,
		timestampUrl: request.timestampUrl,
		timestampError: request.timestampError,
		submittedParams,
		timestampSkewMs: request.timestampSkewMs,
		signUrl: request.signUrl,
		attempts: request.attempts,
		iclassStatus,
		iclassErrCode,
		iclassErrMsg,
		iclassRaw,
		verify
	};

	// 时间戳来源不正常时，必须让用户看见 —— 这是本轮 100 参数错误的根因所在
	const sourceNote =
		request.timestampSource === 'local'
			? `（注意：未能取到 iClass 下发的服务端时间戳，本次用的是本机时钟兜底：${request.timestampError ?? '未知原因'}）`
			: '';

	// 1) 复检到已签到 —— 唯一可以称为"成功"的情形
	if (verify.signed) {
		return {
			ok: true,
			code: 'SIGN_OK',
			message: '签到成功（已复检确认）',
			data
		};
	}

	// 2) iClass 明确报错
	if (iclassStatus !== '0') {
		const detail = [
			iclassErrCode ? `ERRCODE=${iclassErrCode}` : '',
			iclassErrMsg || 'iClass 未返回错误信息'
		].filter(Boolean).join(' ');
		return {
			ok: false,
			code: 'SIGN_REJECTED',
			message: `签到未成功：${detail}${sourceNote}`,
			data
		};
	}

	// 3) iClass 说成功，但复检没查到 —— 不能报成功
	return {
		ok: false,
		code: verify.checked ? 'SIGN_UNVERIFIED' : 'SIGN_UNKNOWN',
		message: verify.checked
			? 'iClass 返回成功，但复检未查到已签到记录（可能尚未落库），请稍后重试'
			: `iClass 返回成功，但复检失败，无法确认：${verify.error ?? '未知原因'}`,
		data
	};
};


export const generateSignQrForFrontend = async (
	client: IClassClient,
	useVpn: boolean,
	courseSchedId: string
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

	// 二维码里的时间戳同样必须是 iClass 下发的那一个，否则扫出来也是 100 参数错误
	const ts = await client.getSignTimestamp();
	if (ts.source !== 'server') {
		return {
			ok: false,
			code: 'SIGN_TIMESTAMP_UNAVAILABLE',
			message: `未能取到 iClass 下发的签到时间戳，生成的二维码不可用：${ts.error ?? '未知原因'}`,
			data: null
		};
	}

	const signUrl = buildScanSignUrl(useVpn);
	const qrUrl = `${signUrl}?courseSchedId=${encodeURIComponent(courseSchedId)}&timestamp=${encodeURIComponent(String(ts.timestamp))}`;

	return {
		ok: true,
		code: 'OK',
		message: '二维码链接生成成功',
		data: {
			qrUrl,
			courseSchedId,
			timestamp: ts.timestamp
		}
	};
};
