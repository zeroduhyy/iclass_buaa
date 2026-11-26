import { useCallback, useEffect, useState } from "react";
import { getAutoSign, updateAutoSign } from "../api/autoSign";
import type { AutoSignStatus } from "../types/api";
import { getAutoStart, isDesktopApp, setAutoStart } from "../utils/desktop";

const offsetLabel = (minutes: number): string => {
    if (minutes > 0) return `课前 ${minutes} 分钟`;
    if (minutes === 0) return "上课时";
    return `课后 ${-minutes} 分钟`;
};

const REFRESH_MS = 30 * 1000;

/** Auto-sign settings and status: on/off, sign time, launch at login (Windows app). */
const AutoSignPanel = () => {
    const [status, setStatus] = useState<AutoSignStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [autoStart, setAutoStartState] = useState(false);
    const desktop = isDesktopApp();

    const refresh = useCallback(async () => {
        const res = await getAutoSign();
        if (res.ok && res.data) {
            setStatus(res.data);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => void refresh(), REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [refresh]);

    useEffect(() => {
        if (desktop) {
            void getAutoStart().then(setAutoStartState);
        }
    }, [desktop]);

    const apply = async (changes: { enabled?: boolean; offsetMinutes?: number }) => {
        setBusy(true);
        setError("");
        const res = await updateAutoSign(changes);
        if (res.data) {
            setStatus(res.data);
        }
        if (!res.ok) {
            setError(res.message);
        }
        setBusy(false);
    };

    const toggleAutoStart = async (enabled: boolean) => {
        setAutoStartState(await setAutoStart(enabled));
    };

    if (!status) {
        return null;
    }

    return (
        <section className={`card auto-sign-panel ${status.enabled ? "on" : ""}`}>
            <div className="auto-sign-head">
                <div>
                    <h3>自动签到</h3>
                    <p className="hint">
                        {status.enabled
                            ? status.nextTriggerText
                                ? `下次签到：${status.nextTriggerText}（北京时间） ${status.nextCourseName}`
                                : "已开启，暂无待签课程，会定时检查课表"
                            : `开启后在${offsetLabel(status.offsetMinutes)}自动签到，所有课程都会签`}
                    </p>
                </div>
                <label className="switch" title={status.enabled ? "关闭自动签到" : "开启自动签到"}>
                    <input
                        type="checkbox"
                        checked={status.enabled}
                        disabled={busy}
                        onChange={(e) => void apply({ enabled: e.target.checked })}
                    />
                    <span />
                </label>
            </div>

            <div className="offset-row">
                <span className="hint">签到时间</span>
                {status.offsetChoices.map((minutes) => (
                    <button
                        key={minutes}
                        type="button"
                        className={`chip ${minutes === status.offsetMinutes ? "active" : ""}`}
                        disabled={busy}
                        onClick={() => void apply({ offsetMinutes: minutes })}
                    >
                        {offsetLabel(minutes)}
                    </button>
                ))}
            </div>

            {status.needsCaptcha && (
                <p className="auto-sign-warn">学校要求输入验证码，后台无法自动登录。请退出登录后重新登录一次。</p>
            )}
            {!status.hasSavedLogin && (
                <p className="auto-sign-warn">自动签到需要保存登录：请退出后重新登录，并勾选「记住登录」。</p>
            )}
            {status.hasSavedLogin && !status.persistent && (
                <p className="hint">开发模式：登录信息只保存在内存中，重启后需要重新登录。</p>
            )}
            {error && <p className="error-text">{error}</p>}

            <div className="auto-sign-foot">
                {desktop && (
                    <label className="check">
                        <input type="checkbox" checked={autoStart} onChange={(e) => void toggleAutoStart(e.target.checked)} />
                        开机自动启动（在托盘后台运行）
                    </label>
                )}
                {status.lastMessage && <span className="hint">最近：{status.recent[0] ?? status.lastMessage}</span>}
            </div>
            {desktop && <p className="hint">关闭窗口后程序会留在任务栏托盘继续自动签到，右键托盘图标可退出。</p>}
        </section>
    );
};

export default AutoSignPanel;
