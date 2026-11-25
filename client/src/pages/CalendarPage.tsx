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
        return message.startsWith("签到失败") ? message : `签到失败: ${message}`;
    }

    const windowStart = (data as { windowStart?: unknown }).windowStart;
    const windowEnd = (data as { windowEnd?: unknown }).windowEnd;
    if (typeof windowStart !== "number" || typeof windowEnd !== "number") {
        return `签到失败: ${message}`;
    }

    return `签到失败: ${message}（可签到时段：${formatHm(windowStart)} - ${formatHm(windowEnd)}）`;
};

type MessageTone = "info" | "success" | "error";

interface PanelMessage {
    tone: MessageTone;
    text: string;
}

const statusLabel = (item: CourseDetailItem, todayYmd: string): { text: string; cls: string } => {
    if (item.signStatus === "1") {
        return { text: "已签到", cls: "signed" };
    }
    if (item.date < todayYmd) {
        return { text: "未签到", cls: "missed" };
    }
    if (item.date === todayYmd) {
        return { text: "今日待签", cls: "today" };
    }
    return { text: "未开始", cls: "upcoming" };
};

const CalendarPage = () => {
    const navigate = useNavigate();
    const [weekOffset, setWeekOffset] = useState(0);
    const [selectedCourse, setSelectedCourse] = useState<CourseDetailItem | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [panelMessage, setPanelMessage] = useState<PanelMessage | null>(null);
    const [isSigning, setIsSigning] = useState(false);
    const [qrImageDataUrl, setQrImageDataUrl] = useState("");
    const [qrGeneratedAt, setQrGeneratedAt] = useState<number | null>(null);
    const [isQrRefreshing, setIsQrRefreshing] = useState(false);
    const [detailItems, setDetailItems] = useState<CourseDetailItem[]>([]);
    const qrTimerRef = useRef<number | null>(null);

    const user = useMemo(() => getUserDisplay(), []);
    const isVpnMode = useMemo(() => getUseVpnMode(), []);
    const isSelectedSigned = selectedCourse?.signStatus === "1";
    const todayYmd = formatYmd(new Date());

    const showMessage = (text: string, tone: MessageTone = "info") => {
        setPanelMessage(text ? { tone, text } : null);
    };

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

    // 同名、同日、同时段的课次只显示一张卡片：按日期查询会把同一门课其他教学班的课次也返回，
    // 它们课程 id 不同。优先取已签到的记录，其次取本人签到过的课程 id，最后才取第一条。
    const { courseMapByCell, duplicateCount } = useMemo(() => {
        const signedCourseIds = new Set(
            detailItems.filter((item) => item.signStatus === "1").map((item) => item.id)
        );
        const groups = new Map<string, CourseDetailItem[]>();
        for (const item of detailItems) {
            const key = `${item.date}|${item.startTime}|${item.endTime}|${item.name}`;
            const group = groups.get(key) ?? [];
            group.push(item);
            groups.set(key, group);
        }

        const counts = new Map<string, number>();
        const map = new Map<string, CourseDetailItem[]>();
        for (const group of groups.values()) {
            const item =
                group.find((entry) => entry.signStatus === "1") ??
                group.find((entry) => signedCourseIds.has(entry.id)) ??
                group[0];
            counts.set(item.courseSchedId, group.length);
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

        return { courseMapByCell: map, duplicateCount: counts };
    }, [detailItems]);

    const weekStats = useMemo(() => {
        const start = formatYmd(weekDates[0]);
        const end = formatYmd(weekDates[6]);
        const unique = [...courseMapByCell.values()].flat();
        const inWeek = unique.filter((item) => item.date >= start && item.date <= end);
        const signed = inWeek.filter((item) => item.signStatus === "1").length;
        const todayPending = unique.filter(
            (item) => item.date === todayYmd && item.signStatus !== "1"
        ).length;
        return { total: inWeek.length, signed, todayPending };
    }, [courseMapByCell, weekDates, todayYmd]);

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

            const details = detailRes.data.details ?? [];
            setDetailItems(details);
            setSelectedCourse((prev) =>
                prev ? details.find((item) => item.courseSchedId === prev.courseSchedId) ?? prev : prev
            );
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
        setPanelMessage(null);
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
                void refreshQrOnce(courseSchedId).catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : "二维码刷新失败";
                    showMessage(`二维码刷新失败: ${message}`, "error");
                    stopQrRefresh();
                });
            }, 2000);
        } catch (err) {
            showMessage(err instanceof Error ? `二维码生成失败: ${err.message}` : "二维码生成失败", "error");
            stopQrRefresh();
        }
    };

    const handleSignNow = async () => {
        if (!selectedCourse?.courseSchedId || isSelectedSigned || isSigning) {
            return;
        }

        const courseSchedId = selectedCourse.courseSchedId;
        setIsSigning(true);
        showMessage("签到中...");
        try {
            const res = await signCourse({ courseSchedId });
            if (!res.ok) {
                if (res.code === "SIGN_UNKNOWN") {
                    // 请求已发出但结果不明：回读课程状态，不自动重试。
                    showMessage(`${res.message}（已自动刷新课程状态）`, "error");
                    await loadCalendarData();
                    return;
                }
                showMessage(buildSignFailMessage(res.message, res.data), "error");
                return;
            }

            // 服务端已校验 STATUS 与 stuSignStatus，ok 即代表签到成功。
            showMessage("签到成功", "success");
            setDetailItems((prev) =>
                prev.map((item) =>
                    item.courseSchedId === courseSchedId ? { ...item, signStatus: "1" } : item
                )
            );
            setSelectedCourse((prev) => (prev ? { ...prev, signStatus: "1" } : prev));
        } catch (err) {
            showMessage(err instanceof Error ? `签到失败: ${err.message}` : "签到失败", "error");
        } finally {
            setIsSigning(false);
        }
    };

    const selectedStatus = selectedCourse ? statusLabel(selectedCourse, todayYmd) : null;

    return (
        <main className="page calendar-page">
            <header className="topbar">
                <div>
                    <small className="auth-kicker">BUAA ICLASS</small>
                    <h2 className="topbar-title">课程日历签到</h2>
                    <p className="hint topbar-hint">
                        欢迎，{user.userName || user.userId || "同学"}
                        <span className={`mode-badge ${isVpnMode ? "vpn" : "direct"}`}>
                            {isVpnMode ? "WebVPN" : "校园网直连"}
                        </span>
                    </p>
                </div>
                <div className="topbar-actions">
                    <button className="ghost" disabled={loading} onClick={() => void loadCalendarData()}>
                        {loading ? "刷新中..." : "刷新课程"}
                    </button>
                    <button className="logout-btn" onClick={() => void handleLogout()}>退出登录</button>
                </div>
            </header>

            <section className="week-nav card">
                <div className="week-nav-controls">
                    <button className="ghost" onClick={() => setWeekOffset((v) => v - 1)}>‹ 上一周</button>
                    <strong className="week-label">{weekRangeLabel}</strong>
                    <button className="ghost" onClick={() => setWeekOffset((v) => v + 1)}>下一周 ›</button>
                    {weekOffset !== 0 && (
                        <button className="ghost" onClick={() => setWeekOffset(0)}>回到本周</button>
                    )}
                </div>
                <div className="week-stats">
                    <span>本周 <b>{weekStats.total}</b> 节</span>
                    <span>已签 <b>{weekStats.signed}</b></span>
                    <span className={weekStats.todayPending > 0 ? "accent" : ""}>
                        今日待签 <b>{weekStats.todayPending}</b>
                    </span>
                </div>
            </section>

            {error && (
                <section className="card error-banner">
                    <p>{error}</p>
                    <button className="ghost small" onClick={() => void loadCalendarData()}>重试</button>
                </section>
            )}

            <section className="calendar-shell card">
                <div className="legend">
                    <span><i className="dot today" />今日待签</span>
                    <span><i className="dot upcoming" />未开始</span>
                    <span><i className="dot missed" />未签到</span>
                    <span><i className="dot signed" />已签到</span>
                </div>
                <div className="calendar-scroll">
                    <div className="calendar-table">
                        <div className="table-head time-head">时间 / 星期</div>
                        {weekdays.map((day, index) => {
                            const isToday = formatYmd(weekDates[index]) === todayYmd;
                            return (
                                <div key={`head-${day}`} className={`table-head day-head ${isToday ? "is-today" : ""}`}>
                                    <span>
                                        {day}
                                        {isToday && <em className="today-tag">今天</em>}
                                    </span>
                                    <small className={index <= 4 ? "day-date" : "day-date muted"}>
                                        {formatMonthDay(weekDates[index])}
                                    </small>
                                </div>
                            );
                        })}

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
                                        <div
                                            key={`${slot.key}-${day}`}
                                            className={`day-slot ${dateYmd === todayYmd ? "is-today" : ""}`}
                                        >
                                            {cellItems.map((item) => {
                                                const status = statusLabel(item, todayYmd);
                                                const isActive = selectedCourse?.courseSchedId === item.courseSchedId;
                                                return (
                                                    <button
                                                        key={item.courseSchedId}
                                                        className={`course-item ${status.cls} ${isActive ? "active" : ""}`}
                                                        onClick={() => handleSelectCourse(item)}
                                                        title={`${item.name} · ${status.text}`}
                                                    >
                                                        <span className="course-title">{item.name}</span>
                                                        <span className="course-time">{item.startTime}-{item.endTime}</span>
                                                        <span className="course-status">
                                                            {status.text}
                                                            {(duplicateCount.get(item.courseSchedId) ?? 1) > 1 && (
                                                                <em className="dup-badge">
                                                                    ×{duplicateCount.get(item.courseSchedId)}
                                                                </em>
                                                            )}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </Fragment>
                        ))}
                    </div>
                </div>
                {loading && detailItems.length === 0 && <div className="loading-mask">课程加载中...</div>}
            </section>

            <section className="card selected-panel">
                {!selectedCourse ? (
                    <p className="empty-hint">点击日历中的课程，即可签到或生成签到二维码</p>
                ) : (
                    <div className="selected-layout">
                        <div className="selected-info">
                            <div className="selected-head">
                                <h3>{selectedCourse.name}</h3>
                                {selectedStatus && (
                                    <span className={`status-pill ${selectedStatus.cls}`}>{selectedStatus.text}</span>
                                )}
                            </div>
                            <p className="selected-meta">
                                {selectedCourse.date} · {selectedCourse.startTime}-{selectedCourse.endTime}
                            </p>
                            <div className="actions">
                                <button disabled={isSelectedSigned || isSigning} onClick={() => void handleSignNow()}>
                                    {isSelectedSigned ? "已签到" : isSigning ? "签到中..." : "直接签到"}
                                </button>
                                <button className="secondary" onClick={() => void handleGenerateQr()}>
                                    {isQrRefreshing ? "停止二维码" : "生成签到二维码"}
                                </button>
                            </div>
                            {panelMessage && (
                                <p className={`panel-message ${panelMessage.tone}`}>{panelMessage.text}</p>
                            )}
                            <p className="hint small-hint">
                                二维码每 2 秒刷新一次，请用智慧北航 App 扫码
                                {isVpnMode ? "（扫码的手机需要连接校园网）" : ""}。
                            </p>
                        </div>
                        {qrImageDataUrl && (
                            <div className="qr-preview">
                                <img src={qrImageDataUrl} alt="签到二维码" className="qr-image" />
                                <p className="hint qr-time">
                                    {isQrRefreshing && <i className="live-dot" />}
                                    {formatDateTime(qrGeneratedAt ?? Date.now())}
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </section>
        </main>
    );
};

export default CalendarPage;
