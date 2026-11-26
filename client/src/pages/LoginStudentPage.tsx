import { useState } from "react";
import type { SubmitEventHandler } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import type { CaptchaData, LoginData, NetworkMode } from "../types/api";
import { setSession } from "../utils/session";

const NETWORK_MODES: { value: NetworkMode; label: string; hint: string }[] = [
    { value: "auto", label: "自动", hint: "能直连 iClass 就直连，连不上自动改走 WebVPN。" },
    { value: "direct", label: "直连", hint: "只走直连，适合一直在校园网的情况。" },
    { value: "vpn", label: "WebVPN", hint: "只走 WebVPN（d.buaa.edu.cn），登录需要输入验证码。" }
];

const LoginStudentPage = () => {
    const navigate = useNavigate();
    const [studentId, setStudentId] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [networkMode, setNetworkMode] = useState<NetworkMode>("auto");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [challenge, setChallenge] = useState<CaptchaData | null>(null);
    const [captcha, setCaptcha] = useState("");

    /** Sends the login; with [answer] it answers the current captcha, otherwise starts over. */
    const performLogin = async (answer?: string) => {
        if (!studentId.trim()) {
            setError("请输入学号");
            return;
        }
        if (!password) {
            setError("请输入统一认证密码");
            return;
        }

        setLoading(true);
        setError("");
        try {
            const res = await login({
                studentId: studentId.trim(),
                password,
                networkMode,
                captcha: answer,
                attemptId: answer ? challenge?.attemptId : undefined
            });

            if (res.code === "CAPTCHA_REQUIRED" && res.data) {
                setChallenge(res.data as CaptchaData);
                setCaptcha("");
                setError(answer ? res.message : "");
                return;
            }
            if (!res.ok || !res.data) {
                setChallenge(null);
                setError(res.message || "登录失败");
                return;
            }

            const data = res.data as LoginData;
            setSession(data.token, data.userId, data.userName, data.useVpn);
            navigate("/calendar", { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : "登录失败");
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit: SubmitEventHandler<HTMLFormElement> = (event) => {
        event.preventDefault();
        if (challenge) {
            if (!captcha.trim()) {
                setError("请输入验证码");
                return;
            }
            void performLogin(captcha.trim());
            return;
        }
        void performLogin();
    };

    const changeMode = (mode: NetworkMode) => {
        setNetworkMode(mode);
        setChallenge(null);
        setCaptcha("");
        setError("");
    };

    const modeHint = NETWORK_MODES.find((mode) => mode.value === networkMode)?.hint;

    return (
        <main className="page login-page">
            <section className="card auth-card">
                <div className="auth-title-wrap">
                    <small className="auth-kicker">BUAA ICLASS</small>
                    <h1 className="auth-title">签到系统登录</h1>
                    <p className="hint auth-subtitle">直连和 WebVPN 使用同一组统一认证账号密码</p>
                </div>

                <form onSubmit={handleSubmit} className="stack auth-form" autoComplete="off">
                    <label htmlFor="studentId">学号</label>
                    <input
                        id="studentId"
                        value={studentId}
                        onChange={(e) => {
                            setStudentId(e.target.value);
                            setChallenge(null);
                        }}
                        placeholder="例如：12345678"
                        autoComplete="off"
                        spellCheck={false}
                    />

                    <label htmlFor="password">统一认证密码</label>
                    <div className="password-wrap">
                        <input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            spellCheck={false}
                        />
                        <button
                            type="button"
                            className="password-eye"
                            onClick={() => setShowPassword((value) => !value)}
                            aria-label={showPassword ? "隐藏密码" : "显示密码"}
                            title={showPassword ? "隐藏密码" : "显示密码"}
                        >
                            {showPassword ? (
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M3 3L21 21" />
                                    <path d="M10.58 10.58A2 2 0 0013.42 13.42" />
                                    <path d="M9.88 5.09A9.77 9.77 0 0112 4c5 0 9 4 10 8a11.26 11.26 0 01-2.17 3.38" />
                                    <path d="M6.6 6.6A11.18 11.18 0 002 12c1 4 5 8 10 8a9.77 9.77 0 004.91-1.3" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M2 12C3 8 7 4 12 4s9 4 10 8c-1 4-5 8-10 8S3 16 2 12z" />
                                    <circle cx="12" cy="12" r="3" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {challenge && (
                        <>
                            <label htmlFor="captcha">验证码</label>
                            <div className="captcha-row">
                                <input
                                    id="captcha"
                                    value={captcha}
                                    onChange={(e) => setCaptcha(e.target.value)}
                                    placeholder="输入图中字符"
                                    autoComplete="off"
                                    spellCheck={false}
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    className="captcha-image"
                                    onClick={() => void performLogin()}
                                    disabled={loading}
                                    title="看不清？点击换一张"
                                >
                                    <img src={challenge.captchaImage} alt="验证码，点击换一张" />
                                </button>
                            </div>
                            <p className="hint captcha-hint">学校要求输入验证码；看不清可以点图片换一张。</p>
                        </>
                    )}

                    <label>网络</label>
                    <div className="segmented" role="radiogroup" aria-label="网络">
                        {NETWORK_MODES.map((mode) => (
                            <button
                                key={mode.value}
                                type="button"
                                role="radio"
                                aria-checked={networkMode === mode.value}
                                className={networkMode === mode.value ? "active" : ""}
                                onClick={() => changeMode(mode.value)}
                                disabled={loading}
                            >
                                {mode.label}
                            </button>
                        ))}
                    </div>
                    <p className="hint mode-hint">{modeHint}</p>

                    <div className="actions auth-actions auth-actions-lg">
                        <button type="submit" disabled={loading}>
                            {loading ? "登录中..." : "登录"}
                        </button>
                    </div>
                </form>

                {error && <p className="error-text">{error}</p>}
            </section>
        </main>
    );
};

export default LoginStudentPage;
