import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { logout } from "../api/auth";
import { fetchCourseDetails, generateSignQr, signNow as signCourse } from "../api/course";
import type { CourseDetailItem } from "../types/api";
import { clearSession, getUseVpnMode, getUserDisplay } from "../utils/session";

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const timeSlots = [
    { key: "morning", label: "上午", range: "08:00-12:15" },
    { key: "afternoon", label: "下午", range: "14:00-18:15" },
    { key: "night", label: "晚上", range: "19:00-22:25" }
];

const formatYmd = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};

const parseHour = (time: string): number => {
    const match = String(time).match(/^(\d{1,2}):/);
    return match ? Number(match[1]) : -1;
};

const parseMinute = (time: string): number => {
    const match = String(time).match(/^(\d{1,2}):(\d{2})/);
    if (!match) {
        return Number.MAX_SAFE_INTEGER;
    }
    return Number(match[1]) * 60 + Number(match[2]);
};

const getSlotKey = (item: CourseDetailItem): "morning" | "afternoon" | "night" => {
    const hour = parseHour(item.startTime);
    if (hour >= 8 && hour < 12) {
        return "morning";
    }
    if (hour >= 14 && hour < 18) {
        return "afternoon";
    }
    return "night";
};

const toCellKey = (dateYmd: string, slot: string): string => `${dateYmd}|${slot}`;

const formatMonthDay = (date: Date): string => {
    return `${date.getMonth() + 1}/${date.getDate()}`;
};

const formatDateTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
};

const formatHm = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
};

const buildSignFailMessage = (message: string, data: unknown): string => {
    if (!data || typeof data !== "object") {
        return `签到失败: ${message}`;
    }

    const windowStart = (data as { windowStart?: unknown }).windowStart;
    const windowEnd = (data as { windowEnd?: unknown }).windowEnd;
    if (typeof windowStart !== "number" || typeof windowEnd !== "number") {
        return `签到失败: ${message}`;
    }

    return `签到失败: ${message}（可签到时段：${formatHm(windowStart)} - ${formatHm(windowEnd)}）`;
};

const CalendarPage = () => {
    const navigate = useNavigate();
    const [weekOffset, setWeekOffset] = useState(0);
    const [selectedCourse, setSelectedCourse] = useState<CourseDetailItem | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [signMessage, setSignMessage] = useState("");
    const [qrImageDataUrl, setQrImageDataUrl] = useState("");
    const [qrGeneratedAt, setQrGeneratedAt] = useState<number | null>(null);
    const [isQrRefreshing, setIsQrRefreshing] = useState(false);
    const [detailItems, setDetailItems] = useState<CourseDetailItem[]>([]);
    const qrTimerRef = useRef<number | null>(null);

    const user = useMemo(() => getUserDisplay(), []);
    const isVpnMode = useMemo(() => getUseVpnMode(), []);
    const isSelectedSigned = selectedCourse?.signStatus === "1";

    const weekStart = useMemo(() => {
        const now = new Date();
        const day = now.getDay();
        const mondayShift = day === 0 ? 6 : day - 1;
        const monday = new Date(now);
        monday.setHours(0, 0, 0, 0);
        monday.setDate(now.getDate() - mondayShift + weekOffset * 7);
        return monday;
    }, [weekOffset]);

    const weekDates = useMemo(() => {
        return weekdays.map((_, index) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + index);
            return date;
        });
    }, [weekStart]);

    const courseMapByCell = useMemo(() => {
        const map = new Map<string, CourseDetailItem[]>();
        for (const item of detailItems) {
            const cellKey = toCellKey(item.date, getSlotKey(item));
            const list = map.get(cellKey) ?? [];
            list.push(item);
            map.set(cellKey, list);
        }

        for (const list of map.values()) {
            list.sort((a, b) => {
                const startDiff = parseMinute(a.startTime) - parseMinute(b.startTime);
                if (startDiff !== 0) {
                    return startDiff;
                }

                const endDiff = parseMinute(a.endTime) - parseMinute(b.endTime);
                if (endDiff !== 0) {
                    return endDiff;
                }

                return String(a.name).localeCompare(String(b.name));
            });
        }

        return map;
    }, [detailItems]);

    const weekRangeLabel = useMemo(() => {
        const start = weekDates[0];
        const end = weekDates[6];
        const base = `${formatMonthDay(start)} - ${formatMonthDay(end)}`;
        if (weekOffset === 0) {
            return `${base} (本周)`;
        }
        return weekOffset > 0 ? `${base} (${weekOffset}周后)` : `${base} (${Math.abs(weekOffset)}周前)`;
    }, [weekDates, weekOffset]);

    const handleLogout = async () => {
        try {
            await logout();
        } finally {
            clearSession();
            navigate("/login", { replace: true });
        }
    };

    const loadCalendarData = async () => {
        setLoading(true);
        setError("");
        try {

            const detailRes = await fetchCourseDetails();
            if (!detailRes.ok || !detailRes.data) {
                throw new Error(detailRes.message || "课程详情获取失败");
            }

            setDetailItems(detailRes.data.details ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载课程失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadCalendarData();
    }, []);

    useEffect(() => {
        return () => {
            if (qrTimerRef.current !== null) {
                window.clearInterval(qrTimerRef.current);
                qrTimerRef.current = null;
            }
        };
    }, []);

    const stopQrRefresh = () => {
        if (qrTimerRef.current !== null) {
            window.clearInterval(qrTimerRef.current);
            qrTimerRef.current = null;
        }
        setIsQrRefreshing(false);
    };

    const handleSelectCourse = (item: CourseDetailItem) => {
        stopQrRefresh();
        setSelectedCourse(item);
        setSignMessage("");
        setQrImageDataUrl("");
        setQrGeneratedAt(null);
    };

    const refreshQrOnce = async (courseSchedId: string) => {
        const res = await generateSignQr({ courseSchedId });
        if (!res.ok || !res.data) {
            throw new Error(res.message || "二维码生成失败");
        }

        const dataUrl = await QRCode.toDataURL(res.data.qrUrl, {
            width: 280,
            margin: 2
        });

        setQrImageDataUrl(dataUrl);
        setQrGeneratedAt(res.data.timestamp);
    };

    const handleGenerateQr = async () => {
        const courseSchedId = selectedCourse?.courseSchedId;
        if (!courseSchedId) {
            return;
        }

        if (isQrRefreshing) {
            stopQrRefresh();
            return;
        }
        setQrImageDataUrl("");
        setQrGeneratedAt(null);

        try {
            await refreshQrOnce(courseSchedId);
            setIsQrRefreshing(true);

            qrTimerRef.current = window.setInterval(() => {
                void refreshQrOnce(courseSchedId).catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : "二维码刷新失败";
                    setSignMessage(`二维码刷新失败: ${message}`);
                    stopQrRefresh();
                });
            }, 2000);
        } catch (err) {
            setSignMessage(err instanceof Error ? `二维码生成失败: ${err.message}` : "二维码生成失败");
            stopQrRefresh();
        }
    };

    const handleSignNow = async () => {
        if (!selectedCourse?.courseSchedId || isSelectedSigned) {
            return;
        }

        setSignMessage("签到中...");
        try {
            const res = await signCourse({ courseSchedId: selectedCourse.courseSchedId });
            if (!res.ok) {
                setSignMessage(buildSignFailMessage(res.message, res.data));
                return;
            }

            const signPayload = (res.data ?? {}) as { ERRMSG?: unknown; STATUS?: unknown };
            const errMsg = String(signPayload.ERRMSG ?? "");
            const status = String(signPayload.STATUS ?? "");
            const successLike = status === "0";
            setSignMessage(successLike ? "签到成功" : `签到结果: ${errMsg || "已提交"}`);

            if (successLike) {
                setDetailItems((prev) =>
                    prev.map((item) =>
                        item.courseSchedId === selectedCourse.courseSchedId
                            ? { ...item, signStatus: "1" }
                            : item
                    )
                );
                setSelectedCourse((prev) => (prev ? { ...prev, signStatus: "1" } : prev));
            }
        } catch (err) {
            setSignMessage(err instanceof Error ? `签到失败: ${err.message}` : "签到失败");
        }
    };

    return (
        <main className="page calendar-page">
            <header className="topbar">
                <div>
                    <h2>北航 iClass 日历签到</h2>
                    <p className="hint">欢迎，{user.userName || user.userId || "同学"}</p>
                </div>
                <button className="logout-btn" onClick={handleLogout}>退出登录</button>
            </header>

            <section className="week-nav card">
                <button onClick={() => setWeekOffset((v) => v - 1)}>上一周</button>
                <strong>{weekRangeLabel}</strong>
                <button onClick={() => setWeekOffset((v) => v + 1)}>下一周</button>
                <button className="ghost" onClick={() => setWeekOffset(0)}>本周</button>
            </section>

            {loading && <section className="card selected-panel"><p>课程加载中...</p></section>}
            {error && <section className="card selected-panel"><p className="error-text">{error}</p></section>}

            <section className="calendar-shell card">
                <div className="calendar-scroll">
                    <div className="calendar-table">
                        <div className="table-head time-head">时间/星期</div>
                        {weekdays.map((day, index) => (
                            <div key={`head-${day}`} className="table-head day-head">
                                <span>{day}</span>
                                <small className={index <= 4 ? "day-date" : "day-date muted"}>
                                    {formatMonthDay(weekDates[index])}
                                </small>
                            </div>
                        ))}

                        {timeSlots.map((slot) => (
                            <Fragment key={slot.key}>
                                <div className="time-axis">
                                    <strong>{slot.label}</strong>
                                    <span>{slot.range}</span>
                                </div>
                                {weekdays.map((day, index) => {
                                    const dateYmd = formatYmd(weekDates[index]);
                                    const cellItems = courseMapByCell.get(toCellKey(dateYmd, slot.key)) ?? [];
                                    return (
                                        <div key={`${slot.key}-${day}`} className="day-slot">
                                            {cellItems.length === 0 && <small className="hint">-</small>}
                                            {cellItems.map((item) => (
                                                <button
                                                    key={item.courseSchedId}
                                                    className={`ghost small course-item ${item.signStatus === "1" ? "signed" : "unsigned"}`}
                                                    onClick={() => handleSelectCourse(item)}
                                                >
                                                    <span className="course-title">{item.name}</span>
                                                    <span className="course-time">{item.startTime}-{item.endTime}</span>
                                                </button>
                                            ))}
                                        </div>
                                    );
                                })}
                            </Fragment>
                        ))}
                    </div>
                </div>
            </section>

            <section className="card selected-panel">
                <h3>已选课程</h3>
                <p>{selectedCourse ? `${selectedCourse.name} (${selectedCourse.date} ${selectedCourse.startTime}-${selectedCourse.endTime})` : "未选择课程"}</p>
                <div className="actions">
                    <button disabled={!selectedCourse || isSelectedSigned} onClick={() => void handleSignNow()}>
                        {isSelectedSigned ? "已签到" : "直接签到"}
                    </button>
                    {!isVpnMode && (
                        <button className="secondary" disabled={!selectedCourse} onClick={() => void handleGenerateQr()}>
                            {isQrRefreshing ? "停止二维码刷新" : "生成二维码"}
                        </button>
                    )}
                </div>
                {signMessage && <p className="hint">{signMessage}</p>}
                {!isVpnMode && qrImageDataUrl && (
                    <div className="qr-preview">
                        <img src={qrImageDataUrl} alt="签到二维码" className="qr-image" />
                        <p className="hint">生成时间：{formatDateTime(qrGeneratedAt ?? Date.now())}</p>
                    </div>
                )}
            </section>
        </main>
    );
};

export default CalendarPage;
