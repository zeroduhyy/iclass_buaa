from flask import Flask, render_template, request, jsonify, redirect, url_for, session
import requests
import time
from typing import Any, Dict, List, Optional
from simple_sso import SSOAuth  # 学长的模块

app = Flask(__name__)
app.secret_key = "iclass_signin_secret_key"  # 添加密钥用于session

# 注意：SSL 验证将基于用户在登录表单的选择（每个会话独立）。
# 这里保留一个安全的默认值（True），但实际使用以 session['verify_ssl'] 为准。
DEFAULT_VERIFY_SSL = True


# 接口URL定义
class URL:
    DIRECT_BASE = "https://iclass.buaa.edu.cn:{port}"
    VPN_BASE = "https://d.buaa.edu.cn/https-{port}/77726476706e69737468656265737421f9f44d9d342326526b0988e29d51367ba018"

    @classmethod
    def _base_8347(cls, use_vpn: bool = False) -> str:
        return (
            cls.VPN_BASE.format(port=8347)
            if use_vpn
            else cls.DIRECT_BASE.format(port=8347)
        )

    @classmethod
    def _base_8346(cls, use_vpn: bool = False) -> str:
        return (
            cls.VPN_BASE.format(port=8346)
            if use_vpn
            else cls.DIRECT_BASE.format(port=8346)
        )

    @classmethod
    def login_url(cls, use_vpn: bool = False) -> str:
        return f"{cls._base_8347(use_vpn)}/app/user/login.action"

    @classmethod
    def course_url(cls, use_vpn: bool = False) -> str:
        return f"{cls._base_8347(use_vpn)}/app/choosecourse/get_myall_course.action"

    @classmethod
    def semester_url(cls, use_vpn: bool = False) -> str:
        return f"{cls._base_8347(use_vpn)}/app/course/get_base_school_year.action"

    @classmethod
    def course_info_url(cls, use_vpn: bool = False) -> str:
        return f"{cls._base_8347(use_vpn)}/app/my/get_my_course_sign_detail.action"

    @classmethod
    def scan_sign_url(cls, use_vpn: bool = False) -> str:
        # 2026-03 起，扫码签到需走 8346 的 eschool 路径，并使用 POST
        return f"{cls._base_8346(use_vpn)}/eschool/app/course/stu_scan_sign.action"


class Header(Dict):
    def __init__(self, params: Optional[Dict[str, Any]] = None):
        super().__init__(
            {
                "Accept": "application/json",
                "Accept-Language": "zh-CN,zh;q=0.9",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
        )
        if params:
            self.update(params)


def get_current_semester(
    user_id: str,
    session_id: str,
    verify: bool = True,
    use_vpn: bool = False,
    http_session: Optional[requests.Session] = None,
):
    """获取当前学期信息"""
    params = {"userId": user_id, "type": "2"}
    headers = Header({"sessionId": session_id})

    requester = http_session or requests
    response = requester.get(
        url=URL.semester_url(use_vpn),
        params=params,
        headers=headers,
        verify=verify,
    )

    if response.status_code != 200:
        return None

    try:
        data = response.json()
    except ValueError:
        return None
    if data.get("STATUS") != "0":
        return None

    semesters = data.get("result", [])
    current_semester = None

    # 查找当前学期
    for semester in semesters:
        if semester.get("yearStatus") == "1":
            current_semester = semester.get("code")
            break

    # 如果没有找到当前学期，使用第一个
    if not current_semester and semesters:
        current_semester = semesters[0].get("code")

    return current_semester


def get_courses(
    user_id: str,
    session_id: str,
    semester_code: str,
    verify: bool = True,
    use_vpn: bool = False,
    http_session: Optional[requests.Session] = None,
):
    """获取用户的课程列表"""
    params = {"user_type": "1", "id": user_id, "xq_code": semester_code}
    headers = Header({"sessionId": session_id})

    requester = http_session or requests
    response = requester.get(
        url=URL.course_url(use_vpn), params=params, headers=headers, verify=verify
    )

    if response.status_code != 200:
        return []

    try:
        data = response.json()
    except ValueError:
        return []
    if data.get("STATUS") != "0":
        return []

    courses_data = data.get("result", [])

    courses = []
    for course in courses_data:
        course_name = course.get("course_name", "未知课程")
        course_id = course.get("course_id", "")
        if course_id:
            courses.append({"name": course_name, "id": course_id})

    return courses


def get_courses_detail(
    session: requests.Session,
    user_id: str,
    session_id: str,
    courses: List[Dict],
    use_vpn: bool = False,
):
    """获取课程签到详情，必须带上 sessionId"""
    course_info_url = f"{URL.course_info_url(use_vpn)}?id={user_id}&courseId="
    available_courses = []

    for course in courses:
        course_name = course["name"]
        course_id = course["id"]

        # 在 URL 上拼接 sessionId
        course_url = f"{course_info_url}{course_id}&sessionId={session_id}"

        course_response = session.get(course_url)
        course_data = course_response.json()
        print(f"[get_courses_detail] {course_name} 响应: {course_data}")

        # 处理数据
        if "result" in course_data and course_data["result"]:
            sorted_courses = sorted(
                course_data["result"],
                key=lambda x: x["teachTime"],
                reverse=True,
            )
            for course_record in sorted_courses:
                teach_date = course_record["teachTime"]
                formatted_date = f"{teach_date[:4]}-{teach_date[4:6]}-{teach_date[6:]}"
                available_courses.append(
                    {
                        "name": course_name,
                        "id": course_id,
                        "courseSchedId": course_record["courseSchedId"],
                        "date": formatted_date,
                        "fullRecord": course_record,
                    }
                )

    return available_courses


def get_authenticated_sso_from_session() -> SSOAuth:
    """基于当前 Flask session 构建带登录态的 SSOAuth。"""
    verify_ssl = session.get("verify_ssl", DEFAULT_VERIFY_SSL)
    sso_auth = SSOAuth(
        verify_ssl=verify_ssl,
        use_vpn=session.get("use_vpn", False),
    )
    sso_auth.session.cookies.update(session.get("cookies", {}))
    sso_auth.session_id = session.get("session_id")
    return sso_auth


@app.route("/")
def login_page():
    """登录页面"""
    # 如果已经登录，直接跳转到课程页面
    if "user_id" in session and "session_id" in session:
        return redirect(url_for("courses"))
    return render_template("login.html", verify_ssl=True, use_vpn=False)


# 修改路由名称，使其更加清晰
@app.route("/courses")
def courses():
    """课程列表页面"""
    if "user_id" not in session or "session_id" not in session:
        return redirect(url_for("login_page"))

    sso_auth = get_authenticated_sso_from_session()

    courses_detail = get_courses_detail(
        sso_auth.session,
        session["user_id"],
        session["session_id"],
        session["courses"],
        use_vpn=session.get("use_vpn", False),
    )
    return render_template(
        "index.html",
        courses=courses_detail,
        user_name=session.get("user_name", ""),
        use_vpn=session.get("use_vpn", False),
    )


@app.route("/login", methods=["POST"])
def login():
    """处理登录请求"""
    student_id = request.form.get("student_id")
    password = request.form.get("password")  # 如果登录需要密码
    verify_ssl = True if request.form.get("verify_ssl") else False
    use_vpn = True if request.form.get("use_vpn") else False

    if not student_id or not password:
        return render_template(
            "login.html",
            error="请输入学号和密码",
            student_id=student_id or "",
            password=password or "",
            verify_ssl=verify_ssl,
            use_vpn=use_vpn,
        )

    # 读取用户在表单中的连接方式选择
    # 保存到会话以便后续页面使用相同选择
    session["verify_ssl"] = verify_ssl
    session["use_vpn"] = use_vpn

    # 使用 SSO 登录
    sso_auth = SSOAuth(
        username=student_id,
        password=password,
        verify_ssl=verify_ssl,
        use_vpn=use_vpn,
    )
    if not sso_auth.login():
        # 如果 SSOAuth 提供了更详细的错误信息，则显示之
        error_msg = (
            getattr(sso_auth, "last_error", None) or "登录失败，请检查学号或密码"
        )
        return render_template(
            "login.html",
            error=error_msg,
            student_id=student_id,
            password=password or "",
            verify_ssl=verify_ssl,
            use_vpn=use_vpn,
        )

    # 获取用户信息
    user_info = sso_auth.user_info
    if not user_info:
        error_msg = getattr(sso_auth, "last_error", None) or "获取用户信息失败"
        return render_template(
            "login.html",
            error=error_msg,
            student_id=student_id,
            password=password or "",
            verify_ssl=verify_ssl,
            use_vpn=use_vpn,
        )

    user_id = user_info.get("id")
    user_name = user_info.get("realName", student_id)
    session_id = sso_auth.session_id

    if not user_id or not session_id:
        error_msg = (
            getattr(sso_auth, "last_error", None) or "登录成功但未获取到完整会话信息"
        )
        return render_template(
            "login.html",
            error=error_msg,
            student_id=student_id,
            password=password or "",
            verify_ssl=verify_ssl,
            use_vpn=use_vpn,
        )

    # 获取当前学期（遵循用户的 verify_ssl 选择）
    semester_code = get_current_semester(
        user_id,
        session_id,
        verify=verify_ssl,
        use_vpn=use_vpn,
        http_session=sso_auth.session,
    )
    if not semester_code:
        # 提供更具体的提示（例如证书/网络/接口问题）
        error_msg = (
            getattr(sso_auth, "last_error", None)
            or "获取学期信息失败：可能是 iClass 接口不可用或网络/证书问题。"
        )
        return render_template(
            "login.html",
            error=error_msg,
            student_id=student_id,
            password=password or "",
            verify_ssl=verify_ssl,
            use_vpn=use_vpn,
        )

    # 获取课程列表（遵循用户的 verify_ssl 选择）
    courses = get_courses(
        user_id,
        session_id,
        semester_code,
        verify=verify_ssl,
        use_vpn=use_vpn,
        http_session=sso_auth.session,
    )
    # 允许无课程用户登录，便于开发时检查页面 UI。
    if not courses:
        courses = []

    # 保存到 session
    session["user_id"] = user_id
    session["session_id"] = session_id
    session["user_name"] = user_name
    session["student_id"] = student_id
    session["courses"] = courses
    session["cookies"] = sso_auth.session.cookies.get_dict()  # 正确获取 SSO cookies

    return redirect(url_for("courses"))


@app.route("/generate_qr", methods=["POST"])
def generate_qr():
    """生成二维码的API"""
    payload = request.get_json(silent=True) or {}
    course_sched_id = payload.get("courseSchedId")
    # 与 Rust 客户端保持一致：默认使用当前毫秒时间戳 + 36000
    timestamp = payload.get("timestamp") or int(time.time() * 1000) + 36000
    # 新版签到二维码应指向 8346 + /eschool/app/course/stu_scan_sign.action
    url = f"{URL.scan_sign_url(session.get('use_vpn', False))}?courseSchedId={course_sched_id}&timestamp={timestamp}"

    return jsonify({"qrUrl": url})


@app.route("/sign_now", methods=["POST"])
def sign_now():
    """直接调用新版签到接口（无需扫码）。"""
    if "user_id" not in session or "session_id" not in session:
        return jsonify({"STATUS": "1", "ERRMSG": "未登录，请先登录后重试"}), 401

    payload = request.get_json(silent=True) or {}
    course_sched_id = str(payload.get("courseSchedId", "")).strip()
    if not course_sched_id:
        return jsonify({"STATUS": "1", "ERRMSG": "courseSchedId 不能为空"}), 400

    # 与 Rust 客户端保持一致：默认使用当前毫秒时间戳 + 36000
    timestamp = payload.get("timestamp") or int(time.time() * 1000) + 36000
    user_id = session["user_id"]
    session_id = session["session_id"]

    sign_url = f"{URL.scan_sign_url(session.get('use_vpn', False))}?courseSchedId={course_sched_id}&timestamp={timestamp}"
    headers = Header({"sessionId": session_id})
    params = {"id": user_id}

    sso_auth = get_authenticated_sso_from_session()
    try:
        resp = sso_auth.session.post(
            sign_url, params=params, headers=headers, timeout=15
        )
        data = resp.json()
    except requests.RequestException as exc:
        return jsonify({"STATUS": "1", "ERRMSG": f"签到请求失败: {exc}"}), 502
    except ValueError:
        return jsonify({"STATUS": "1", "ERRMSG": "签到接口返回非 JSON"}), 502

    return jsonify(data)


@app.route("/logout")
def logout():
    """退出登录"""
    session.clear()
    return redirect(url_for("login_page"))


if __name__ == "__main__":
    app.run(debug=True)
