import { useState } from "react";
import type { SubmitEventHandler } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { setSession } from "../utils/session";

const LoginStudentPage = () => {
    const navigate = useNavigate();
    const [studentId, setStudentId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleDirectLogin: SubmitEventHandler<HTMLFormElement> = async (event) => {
        event.preventDefault();
        if (!studentId.trim()) {
            setError("请输入学号");
            return;
        }

        setLoading(true);
        setError("");
        try {
            const res = await login({
                studentId: studentId.trim(),
                useVpn: false
            });

            if (!res.ok || !res.data) {
                setError(res.message || "直连登录失败");
                return;
            }

            setSession(res.data.token, res.data.userId, res.data.userName, false);
            navigate("/calendar", { replace: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : "直连登录失败");
        } finally {
            setLoading(false);
        }
    };

    const goToVpnStep = () => {
        if (!studentId.trim()) {
            setError("请先输入学号");
            return;
        }
        navigate("/login/vpn", { state: { studentId: studentId.trim() } });
    };

    return (
        <main className="page login-page">
            <section className="card auth-card">
                <div className="auth-title-wrap">
                    <small className="auth-kicker">BUAA ICLASS</small>
                    <h1 className="auth-title">签到系统登录</h1>
                    <p className="hint auth-subtitle">先输入学号，再选择登录方式</p>
                </div>

                <form onSubmit={handleDirectLogin} className="stack" autoComplete="off">
                    <label htmlFor="studentId" className="student-id-label">学号</label>
                    <input
                        className="student-id-input"
                        id="studentId"
                        value={studentId}
                        onChange={(e) => setStudentId(e.target.value)}
                        placeholder="例如：12345678"
                        autoComplete="off"
                        spellCheck={false}
                    />

                    <div className="actions auth-actions auth-actions-lg">
                        <button type="button" className="secondary" onClick={goToVpnStep} disabled={loading}>
                            VPN 登录
                        </button>
                        <button type="submit" disabled={loading}>
                            {loading ? "登录中..." : "直连登录"}
                        </button>
                    </div>
                </form>

                {error && <p className="error-text">{error}</p>}
            </section>
        </main>
    );
};

export default LoginStudentPage;
