import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import type { CourseItem } from '../core/courseCore';
import {
	loginAndBuildContext,
	LoginContext,
	LoginInput,
	ServiceResult as AuthServiceResult
} from '../services/authService';
import {
	generateSignQrForFrontend,
	getMergedCourseDetailsForFrontend,
	getSemesterCoursesForFrontend,
	signNowForFrontend,
	ServiceResult as CourseServiceResult,
	SemesterCoursesData,
	validateSignTimeWindow
} from '../services/courseService';
import logger from '../utils/logger';

type AnyServiceResult = AuthServiceResult<any> | CourseServiceResult<any>;

interface SessionState {
	context: LoginContext;
	courses: CourseItem[];
}

const sessions = new Map<string, SessionState>();

const DEFAULT_API_PORT = Number(process.env.API_PORT ?? 3000);

const setCorsHeaders = (res: ServerResponse): void => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
};

const sendJson = (res: ServerResponse, statusCode: number, payload: AnyServiceResult | Record<string, unknown>): void => {
	setCorsHeaders(res);
	res.statusCode = statusCode;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.end(JSON.stringify(payload));
};

const readJsonBody = async (req: IncomingMessage): Promise<any> => {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	if (chunks.length === 0) {
		return {};
	}

	const raw = Buffer.concat(chunks).toString('utf8');
	if (!raw.trim()) {
		return {};
	}

	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`请求体不是有效 JSON，raw=${raw.slice(0, 200)}`);
	}
};

const parseBool = (value: unknown, fallback: boolean): boolean => {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'true' || normalized === '1') {
			return true;
		}
		if (normalized === 'false' || normalized === '0') {
			return false;
		}
	}
	return fallback;
};

const extractToken = (req: IncomingMessage, urlObj: URL): string => {
	const headerToken = String(req.headers['x-session-token'] ?? '').trim();
	if (headerToken) {
		return headerToken;
	}

	const authHeader = String(req.headers.authorization ?? '').trim();
	if (authHeader.toLowerCase().startsWith('bearer ')) {
		return authHeader.slice(7).trim();
	}

	return String(urlObj.searchParams.get('token') ?? '').trim();
};

const unauthorized = (res: ServerResponse): void => {
	sendJson(res, 401, {
		ok: false,
		code: 'UNAUTHORIZED',
		message: '会话无效或已过期，请重新登录',
		data: null
	});
};

const handleLogin = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
	let body: any;
	try {
		body = await readJsonBody(req);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		logger.warn(`[login] 请求体解析失败: ${reason}`);
		sendJson(res, 400, {
			ok: false,
			code: 'INVALID_JSON',
			message: '请求体必须是合法 JSON',
			data: null
		});
		return;
	}

	const bodyKeys = body && typeof body === 'object' ? Object.keys(body).join(',') : '';
	logger.info(`[login] 收到请求 content-type=${String(req.headers['content-type'] ?? '')}, keys=[${bodyKeys}]`);

	const studentId = String(body?.studentId ?? '').trim();
	const useVpn = parseBool(body?.useVpn, false);
	const vpnUsername = String(body?.vpnUsername ?? '').trim();
	const vpnPassword = String(body?.vpnPassword ?? '');

	if (!studentId) {
		logger.warn(`[login] 参数缺失: studentIdPresent=false, bodyKeys=[${bodyKeys}]`);
		sendJson(res, 400, {
			ok: false,
			code: 'INVALID_PARAM',
			message: 'studentId 不能为空',
			data: null
		});
		return;
	}



	if (useVpn && (!vpnUsername || !vpnPassword)) {
		logger.warn(`[login] VPN 模式缺少认证参数: studentId=${studentId}, vpnUsernamePresent=${vpnUsername.length > 0}, vpnPasswordPresent=${vpnPassword.length > 0}`);
		sendJson(res, 400, {
			ok: false,
			code: 'INVALID_PARAM',
			message: 'VPN 模式必须同时提供 vpnUsername 和 vpnPassword',
			data: null
		});
		return;
	}

	const input: LoginInput = {
		studentId,
		useVpn,
		vpnUsername,
		vpnPassword
	};

	logger.info(`[login] 参数校验通过: studentId=${studentId}, useVpn=${input.useVpn}`);

	try {
		const context = await loginAndBuildContext(input);
		const token = randomUUID();
		sessions.set(token, { context, courses: [] });
		logger.info(`[login] 登录成功: userId=${context.userId}, userName=${context.userName}, token=${token.slice(0, 8)}...`);

		sendJson(res, 200, {
			ok: true,
			code: 'OK',
			message: '登录成功',
			data: {
				token,
				userId: context.userId,
				userName: context.userName,
				sessionId: context.sessionId
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : '登录失败';
		logger.warn(`[login] 登录失败: ${message}`);
		sendJson(res, 401, {
			ok: false,
			code: 'AUTH_FAILED',
			message,
			data: null
		});
	}
};

const handleCourses = async (req: IncomingMessage, res: ServerResponse, urlObj: URL): Promise<void> => {
	const token = extractToken(req, urlObj);
	const state = sessions.get(token);
	if (!state) {
		unauthorized(res);
		return;
	}

	const result: CourseServiceResult<SemesterCoursesData> = await getSemesterCoursesForFrontend(state.context.client);
	if (result.ok && result.data) {
		state.courses = result.data.courses;
		sendJson(res, 200, result);
		return;
	}

	sendJson(res, 400, result);
};

const handleCourseDetails = async (req: IncomingMessage, res: ServerResponse, urlObj: URL): Promise<void> => {
	const token = extractToken(req, urlObj);
	const state = sessions.get(token);
	if (!state) {
		unauthorized(res);
		return;
	}

	if (state.courses.length === 0) {
		const prefetch = await getSemesterCoursesForFrontend(state.context.client);
		if (prefetch.ok && prefetch.data) {
			state.courses = prefetch.data.courses;
		} else {
			sendJson(res, 400, prefetch);
			return;
		}
	}

	const result = await getMergedCourseDetailsForFrontend(state.context.client, state.courses, 7);
	sendJson(res, result.ok ? 200 : 400, result);
};

const handleSign = async (req: IncomingMessage, res: ServerResponse, urlObj: URL): Promise<void> => {
	const tokenFromQuery = extractToken(req, urlObj);
	const body = await readJsonBody(req);
	const token = tokenFromQuery || String(body?.token ?? '').trim();
	const state = sessions.get(token);

	if (!state) {
		unauthorized(res);
		return;
	}

	const courseSchedId = String(body?.courseSchedId ?? '').trim();
	const timestamp = Number(body?.timestamp ?? Date.now());

	if (!courseSchedId) {
		sendJson(res, 400, {
			ok: false,
			code: 'INVALID_PARAM',
			message: 'courseSchedId 不能为空',
			data: null
		});
		return;
	}

	if (state.courses.length === 0) {
		const prefetch = await getSemesterCoursesForFrontend(state.context.client);
		if (prefetch.ok && prefetch.data) {
			state.courses = prefetch.data.courses;
		} else {
			sendJson(res, 400, prefetch);
			return;
		}
	}

	const detailResult = await getMergedCourseDetailsForFrontend(state.context.client, state.courses, 7);
	if (!detailResult.ok || !detailResult.data) {
		sendJson(res, 400, {
			ok: false,
			code: 'SIGN_TIME_CHECK_FAILED',
			message: detailResult.message || '签到时间校验失败',
			data: null
		});
		return;
	}

	const targetCourse = detailResult.data.details.find((item) => String(item.courseSchedId) === courseSchedId);
	if (!targetCourse) {
		sendJson(res, 400, {
			ok: false,
			code: 'COURSE_NOT_FOUND',
			message: '未找到对应课程，无法校验签到时间',
			data: null
		});
		return;
	}

	const windowCheck = validateSignTimeWindow(targetCourse, Date.now());
	if (!windowCheck.ok) {
		sendJson(res, 400, {
			ok: false,
			code: 'SIGN_TIME_NOT_ALLOWED',
			message: windowCheck.message,
			data: {
				courseSchedId,
				windowStart: windowCheck.windowStart ?? null,
				windowEnd: windowCheck.windowEnd ?? null,
				now: Date.now()
			}
		});
		return;
	}

	const result = await signNowForFrontend(state.context.client, courseSchedId, timestamp);
	sendJson(res, result.ok ? 200 : 400, result);
};

const handleSignQr = async (req: IncomingMessage, res: ServerResponse, urlObj: URL): Promise<void> => {
	const tokenFromQuery = extractToken(req, urlObj);
	const body = await readJsonBody(req);
	const token = tokenFromQuery || String(body?.token ?? '').trim();
	const state = sessions.get(token);

	if (!state) {
		unauthorized(res);
		return;
	}

	const courseSchedId = String(body?.courseSchedId ?? '').trim();
	const timestamp = Number(body?.timestamp ?? Date.now());
	const result = await generateSignQrForFrontend(state.context.useVpn, courseSchedId, timestamp);
	sendJson(res, result.ok ? 200 : 400, result);
};

const handleLogout = (req: IncomingMessage, res: ServerResponse, urlObj: URL): void => {
	const token = extractToken(req, urlObj);
	if (token) {
		sessions.delete(token);
	}

	sendJson(res, 200, {
		ok: true,
		code: 'OK',
		message: '已退出登录',
		data: null
	});
};

export const startApiServer = (port: number = DEFAULT_API_PORT) => {
	const server = createServer(async (req, res) => {
		setCorsHeaders(res);

		if (req.method === 'OPTIONS') {
			res.statusCode = 204;
			res.end();
			return;
		}

		const method = String(req.method ?? 'GET').toUpperCase();
		const urlObj = new URL(req.url ?? '/', 'http://localhost');
		const path = urlObj.pathname;

		try {
			if (method === 'GET' && path === '/api/health') {
				sendJson(res, 200, {
					ok: true,
					code: 'OK',
					message: 'service running',
					data: {
						activeSessions: sessions.size
					}
				});
				return;
			}

			if (method === 'POST' && path === '/api/login') {
				await handleLogin(req, res);
				return;
			}

			if (method === 'GET' && path === '/api/courses') {
				await handleCourses(req, res, urlObj);
				return;
			}

			if (method === 'GET' && path === '/api/course-details') {
				await handleCourseDetails(req, res, urlObj);
				return;
			}

			if (method === 'POST' && path === '/api/sign') {
				await handleSign(req, res, urlObj);
				return;
			}

			if (method === 'POST' && path === '/api/sign-qr') {
				await handleSignQr(req, res, urlObj);
				return;
			}

			if (method === 'POST' && path === '/api/logout') {
				handleLogout(req, res, urlObj);
				return;
			}

			sendJson(res, 404, {
				ok: false,
				code: 'NOT_FOUND',
				message: '接口不存在',
				data: null
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[api] ${method} ${path} failed: ${message}`);
			sendJson(res, 500, {
				ok: false,
				code: 'INTERNAL_ERROR',
				message: '服务器内部错误',
				data: null
			});
		}
	});

	server.listen(port, () => {
		logger.info(`[api] server started at http://127.0.0.1:${port}`);
	});

	return server;
};
