import { useMemo, useState } from "react";
import type { SubmitEventHandler } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { setSession } from "../utils/session";

interface LocationState {
    studentId?: string;
}

const LoginVpnPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const state = (location.state as LocationState | null) ?? null;

    const [studentId, setStudentId] = useState(state?.studentId ?? "");
    const [vpnUsername, setVpnUsername] = useState(state?.studentId ?? "");
    const [vpnPassword, setVpnPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const canSubmit = useMemo(() => {
        return Boolean(studentId.trim() && vpnUsername.trim() && vpnPassword);
    }, [studentId, vpnPassword, vpnUsername]);

    const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (event) => {
        event.preventDefault();
        if (!canSubmit) {
            setError("请完整填写学号、VPN 账号和密码");
            return;
        }

        setLoading(true);
        setError("");
        try {
            const res = await login({
                studentId: studentId.trim(),
                useVpn: true,
                vpnUsername: vpnUsername.trim(),
                vpnPassword,
            });

            if (!res.ok || !res.data) {
                setError(res.message || "VPN 登录失败");
                return;
            }

            setSession(res.data.token, res.data.userId, res.data.userName, true);
            navigate("/calendar", { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : "VPN 登录失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="page login-page">
            <section className="card auth-card">
                <div className="auth-title-wrap">
                    <small className="auth-kicker">SECURE VPN</small>
                    <h1 className="auth-title">VPN 登录</h1>
                    <p className="hint auth-subtitle">输入学号及 VPN 账号密码</p>
                </div>

                <form onSubmit={handleSubmit} className="stack" autoComplete="off">
                    <label htmlFor="studentId">学号</label>
                    <input id="studentId" value={studentId} onChange={(e) => setStudentId(e.target.value)} autoComplete="off" spellCheck={false} />

                    <label htmlFor="vpnUsername">VPN 账号</label>
                    <input id="vpnUsername" value={vpnUsername} onChange={(e) => setVpnUsername(e.target.value)} autoComplete="off" spellCheck={false} />

                    <label htmlFor="vpnPassword">VPN 密码</label>
                    <div className="password-wrap">
                        <input
                            id="vpnPassword"
                            type={showPassword ? "text" : "password"}
                            value={vpnPassword}
                            onChange={(e) => setVpnPassword(e.target.value)}
                            autoComplete="new-password"
                            spellCheck={false}
                        />
                        <button
                            type="button"
                            className="password-eye"
                            onClick={() => setShowPassword((v) => !v)}
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

                    <div className="actions auth-actions">
                        <button type="button" className="ghost" onClick={() => navigate("/login")}>返回</button>
                        <button type="submit" disabled={loading || !canSubmit}>
                            {loading ? "登录中..." : "确认 VPN 登录"}
                        </button>
                    </div>
                </form>

                {error && <p className="error-text">{error}</p>}
            </section>
        </main>
    );
};

export default LoginVpnPage;
