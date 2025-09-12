from flask import Flask, render_template, request, jsonify, redirect, url_for, session
import requests
from typing import Dict, List
from simple_sso import SSOAuth  # 学长的模块

app = Flask(__name__)
app.secret_key = "iclass_signin_secret_key"  # 添加密钥用于session


# 接口URL定义
class URL:
    loginUrl = "https://iclass.buaa.edu.cn:8346/app/user/login.action"
    courseUrl = (
        "https://iclass.buaa.edu.cn:8346/app/choosecourse/get_myall_course.action"
    )
    semesterUrl = (
        "https://iclass.buaa.edu.cn:8346/app/course/get_base_school_year.action"
    )
    courseInfoUrl = (
        "https://iclass.buaa.edu.cn:8346/app/my/get_my_course_sign_detail.action"
    )


class Header(Dict):
    def __init__(self, params: Dict = None):
        super().__init__(
            {
                "Accept": "application/json",
                "Accept-Language": "zh-CN,zh;q=0.9",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
        )
        if params:
            self.update(params)


def get_user_info(student_id: str):
    """通过学号获取userId和sessionId"""
    params = {
        "password": "",
        "phone": student_id,
        "userLevel": "1",
        "verificationType": "2",
        "verificationUrl": "",
    }

    response = requests.get(url=URL.loginUrl, params=params, headers=Header())

    if response.status_code != 200:
        return None, None, None

    data = response.json()
    if data.get("STATUS") != "0":
        return None, None, None

    user_id = data["result"]["id"]
    session_id = data["result"]["sessionId"]
    user_name = data["result"].get("realName", "未知用户")

    return user_id, session_id, user_name


def get_current_semester(user_id: str, session_id: str):
    """获取当前学期信息"""
    params = {"userId": user_id, "type": "2"}
    headers = Header({"sessionId": session_id})

    response = requests.get(url=URL.semesterUrl, params=params, headers=headers)

    if response.status_code != 200:
        return None

    data = response.json()
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


def get_courses(user_id: str, session_id: str, semester_code: str):
    """获取用户的课程列表"""
    params = {"user_type": "1", "id": user_id, "xq_code": semester_code}
    headers = Header({"sessionId": session_id})

    response = requests.get(url=URL.courseUrl, params=params, headers=headers)

    if response.status_code != 200:
        return []

    data = response.json()
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
    session: requests.Session, user_id: str, session_id: str, courses: List[Dict]
):
    """获取课程签到详情，必须带上 sessionId"""
    course_info_url = f"{URL.courseInfoUrl}?id={user_id}&courseId="
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


@app.route("/")
def login_page():
    """登录页面"""
    # 如果已经登录，直接跳转到课程页面
    if "user_id" in session and "session_id" in session:
        return redirect(url_for("courses"))
    return render_template("login.html")


# 修改路由名称，使其更加清晰
@app.route("/courses")
def courses():
    """课程列表页面"""
    if "user_id" not in session or "session_id" not in session:
        return redirect(url_for("login_page"))

    # 安全获取 cookies
    cookies = session.get("cookies", {})
    sso_auth = SSOAuth()
    sso_auth.session.cookies.update(cookies)
    sso_auth.session_id = session.get("session_id")

    courses_detail = get_courses_detail(
        sso_auth.session, session["user_id"], session["session_id"], session["courses"]
    )
    return render_template(
        "index.html", courses=courses_detail, user_name=session.get("user_name", "")
    )


@app.route("/login", methods=["POST"])
def login():
    """处理登录请求"""
    student_id = request.form.get("student_id")
    password = request.form.get("password")  # 如果登录需要密码
    if not student_id or not password:
        return render_template(
            "login.html", error="请输入学号和密码", student_id=student_id or ""
        )

    # 使用 SSO 登录
    sso_auth = SSOAuth(username=student_id, password=password)
    if not sso_auth.login():
        return render_template(
            "login.html", error="登录失败，请检查学号或密码", student_id=student_id
        )

    # 获取用户信息
    user_info = sso_auth.user_info
    if not user_info:
        return render_template("login.html", error="获取用户信息失败")

    user_id = user_info.get("id")
    user_name = user_info.get("realName", student_id)

    # 获取当前学期
    semester_code = get_current_semester(user_id, sso_auth.session_id)
    if not semester_code:
        return render_template("login.html", error="获取学期信息失败")

    # 获取课程列表
    courses = get_courses(user_id, sso_auth.session_id, semester_code)
    if not courses:
        return render_template("login.html", error="未找到课程信息")

    # 保存到 session
    session["user_id"] = user_id
    session["session_id"] = sso_auth.session_id
    session["user_name"] = user_name
    session["student_id"] = student_id
    session["courses"] = courses
    session["cookies"] = sso_auth.session.cookies.get_dict()  # 正确获取 SSO cookies

    return redirect(url_for("courses"))


@app.route("/generate_qr", methods=["POST"])
def generate_qr():
    """生成二维码的API"""
    course_sched_id = request.json.get("courseSchedId")
    timestamp = request.json.get("timestamp", 0)
    url = f"http://iclass.buaa.edu.cn:8081/app/course/stu_scan_sign.action?courseSchedId={course_sched_id}&timestamp={timestamp}"

    return jsonify({"qrUrl": url})


@app.route("/logout")
def logout():
    """退出登录"""
    session.clear()
    return redirect(url_for("login_page"))


if __name__ == "__main__":
    app.run(debug=True)
