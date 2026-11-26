import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import type { CourseItem } from '../core/courseCore';
import {
	CaptchaChallenge,
	loginAndBuildContext,
	LoginContext,
	LoginInput,
	NetworkMode,
	ServiceResult as AuthServiceResult
} from '../services/authService';
import {
	generateSignQrForFrontend,
	getMergedCourseDetailsForFrontend,
	getSemesterCoursesForFrontend,
	signNowForFrontend,
	ServiceResult as CourseServiceResult,
	SemesterCoursesData
} from '../services/courseService';
import logger from '../utils/logger';
import {
	ensureBackgroundContext,
	forgetLogin,
	getAutoSignStatus,
	rememberLogin,
	updateAutoSign,
	waitForSavedLogin
} from '../services/autoSignService';

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

const extractToken = (req: IncomingMessage): string => {
	const headerToken = String(req.headers['x-session-token'] ?? '').trim();
	if (headerToken) {
		return headerToken;
	}

	const authHeader = String(req.headers.authorization ?? '').trim();
	if (authHeader.toLowerCase().startsWith('bearer ')) {
		return authHeader.slice(7).trim();
	}

	return '';
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
	const password = String(body?.password ?? '');
	// networkMode: auto | direct | vpn. Older clients send useVpn instead.
	const rawMode = String(body?.networkMode ?? '').trim().toLowerCase();
	const networkMode: NetworkMode = rawMode === 'direct' || rawMode === 'vpn' || rawMode === 'auto'
		? rawMode
		: body?.useVpn === undefined ? 'auto' : parseBool(body?.useVpn, false) ? 'vpn' : 'direct';
	const captcha = String(body?.captcha ?? '').trim();
	const attemptId = String(body?.attemptId ?? '').trim();
	// Remember the login (encrypted on this computer) for auto-login and background auto-sign.
	const remember = parseBool(body?.remember, false);

	if (!studentId || !password) {
		logger.warn(`[login] 参数缺失: studentIdPresent=${Boolean(studentId)}, passwordPresent=${Boolean(password)}, bodyKeys=[${bodyKeys}]`);
		sendJson(res, 400, {
			ok: false,
			code: 'INVALID_PARAM',
			message: !studentId ? '学号不能为空' : '请输入统一认证密码',
			data: null
		});
		return;
	}



	const input: LoginInput = {
		studentId,
		password,
		networkMode,
		captcha: captcha || undefined,
		attemptId: attemptId || undefined
	};

	logger.info(`[login] 参数校验通过: studentId=${studentId}, networkMode=${networkMode}, captcha=${captcha ? 'yes' : 'no'}`);

	try {
		const context = await loginAndBuildContext(input);
		const token = randomUUID();
		for (const [existingToken, state] of sessions) {
			if (state.context.studentId === context.studentId && state.context.useVpn === context.useVpn) {
				sessions.delete(existingToken);
			}
		}
		sessions.set(token, { context, courses: [] });
		if (remember) {
			rememberLogin({ studentId, password, networkMode }, context);
		}
		logger.info(`[login] 登录成功: userId=${context.userId}, userName=${context.userName}, token=${token.slice(0, 8)}...`);

		sendJson(res, 200, {
			ok: true,
			code: 'OK',
			message: '登录成功',
			data: {
				token,
				userId: context.userId,
				userName: context.userName,
				useVpn: context.useVpn
			}
		});
	} catch (error) {
		if (error instanceof CaptchaChallenge) {
			logger.info('[login] 需要验证码');
			sendJson(res, 200, {
				ok: false,
				code: 'CAPTCHA_REQUIRED',
				message: error.message,
				data: {
					attemptId: error.attemptId,
					captchaImage: error.imageDataUrl
				}
			});
			return;
		}
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

const handleCourses = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
	const token = extractToken(req);
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

const handleCourseDetails = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
	const token = extractToken(req);
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

const handleSign = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
	const token = extractToken(req);
	const body = await readJsonBody(req);
	const state = sessions.get(token);

	if (!state) {
		unauthorized(res);
		return;
	}

	const courseSchedId = String(body?.courseSchedId ?? '').trim();

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

	const result = await signNowForFrontend(state.context.client, courseSchedId);
	sendJson(res, result.ok ? 200 : 400, result);
};

const handleSignQr = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
	const token = extractToken(req);
	const body = await readJsonBody(req);
	const state = sessions.get(token);

	if (!state) {
		unauthorized(res);
		return;
	}

	const courseSchedId = String(body?.courseSchedId ?? '').trim();
	const result = await generateSignQrForFrontend(
		state.context.client,
		courseSchedId
	);
	sendJson(res, result.ok ? 200 : 400, result);
};

/** Logs in with the saved login, so the app opens without the login page. */
const handleSavedSession = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
	await waitForSavedLogin();
	const status = getAutoSignStatus();
	if (!status.hasSavedLogin) {
		sendJson(res, 200, { ok: false, code: 'NO_SAVED_LOGIN', message: '', data: null });
		return;
	}
	try {
		const context = await ensureBackgroundContext();
		const token = randomUUID();
		sessions.set(token, { context, courses: [] });
		sendJson(res, 200, {
			ok: true,
			code: 'OK',
			message: '已自动登录',
			data: { token, userId: context.userId, userName: context.userName, useVpn: context.useVpn }
		});
	} catch (error) {
		sendJson(res, 200, {
			ok: false,
			code: 'SAVED_LOGIN_FAILED',
			message: error instanceof Error ? error.message : '自动登录失败',
			data: { studentId: status.studentId }
		});
	}
};

const handleAutoSign = async (req: IncomingMessage, res: ServerResponse, method: string): Promise<void> => {
	if (!sessions.get(extractToken(req))) {
		unauthorized(res);
		return;
	}
	if (method === 'GET') {
		sendJson(res, 200, { ok: true, code: 'OK', message: '', data: getAutoSignStatus() });
		return;
	}
	const body = await readJsonBody(req);
	try {
		const status = updateAutoSign({
			enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
			offsetMinutes: body?.offsetMinutes === undefined ? undefined : Number(body.offsetMinutes)
		});
		sendJson(res, 200, { ok: true, code: 'OK', message: status.lastMessage, data: status });
	} catch (error) {
		sendJson(res, 400, {
			ok: false,
			code: 'AUTO_SIGN_FAILED',
			message: error instanceof Error ? error.message : '设置失败',
			data: getAutoSignStatus()
		});
	}
};

const handleLogout = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
	const token = extractToken(req);
	if (token) {
		sessions.delete(token);
	}
	// Logging out forgets the saved login and stops auto-sign, as on Android.
	forgetLogin();

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
				await handleCourses(req, res);
				return;
			}

			if (method === 'GET' && path === '/api/course-details') {
				await handleCourseDetails(req, res);
				return;
			}

			if (method === 'POST' && path === '/api/sign') {
				await handleSign(req, res);
				return;
			}

			if (method === 'POST' && path === '/api/sign-qr') {
				await handleSignQr(req, res);
				return;
			}

			if (method === 'GET' && path === '/api/saved-session') {
				await handleSavedSession(req, res);
				return;
			}

			if ((method === 'GET' || method === 'POST') && path === '/api/auto-sign') {
				await handleAutoSign(req, res, method);
				return;
			}

			if (method === 'POST' && path === '/api/logout') {
				await handleLogout(req, res);
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

	server.listen(port, '127.0.0.1', () => {
		logger.info(`[api] server started at http://127.0.0.1:${port}`);
	});

	return server;
};
