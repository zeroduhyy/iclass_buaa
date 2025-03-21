from flask import Flask, render_template, request, jsonify
import requests
import json
from datetime import datetime

app = Flask(__name__)


# 加载配置文件
def load_config():
    with open("config.json", "r", encoding="utf-8") as f:
        return json.load(f)


config = load_config()

# 登录的 URL 和参数
login_url = "https://iclass.buaa.edu.cn:8346/app/user/login.action"
login_data = {
    "phone": config["loginName"],  # 从配置文件中读取 phone 参数
    "password": "",  # 从配置文件中读取密码
    "verificationType": "2",
    "verificationUrl": "",
    "userLevel": "1",
}


# 发送登录请求并获取 sessionId
def login():
    response = requests.post(login_url, data=login_data)
    login_response = response.json()
    if "result" in login_response:
        return login_response["result"]["id"], login_response["result"]["sessionId"]
    return None, None


# 获取课程签到详情
def get_courses(user_id, session_id):
    courses = config["courses"]  # 从配置文件中读取课程列表

    course_info_url = f"https://iclass.buaa.edu.cn:8346/app/my/get_my_course_sign_detail.action?id={user_id}&courseId="
    headers = {"Cookie": f"SESSION={session_id}"}
    available_courses = []

    for course in courses:
        course_name, course_id = course.split(":")
        course_url = course_info_url + course_id.strip()
        course_response = requests.get(course_url, headers=headers)
        course_data = course_response.json()

        if "result" in course_data and len(course_data["result"]) > 0:
            # 按照日期对课程记录进行排序
            sorted_courses = sorted(
                course_data["result"],
                key=lambda x: x["teachTime"],
                reverse=True,  # 倒序，最新的日期排在前面
            )

            # 保存所有课程记录，而不仅仅是最新的
            for course_record in sorted_courses:
                # 格式化日期，使其更易读
                teach_date = course_record["teachTime"]
                formatted_date = f"{teach_date[:4]}-{teach_date[4:6]}-{teach_date[6:]}"

                # 添加到可用课程列表
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
def index():
    user_id, session_id = login()
    if not user_id or not session_id:
        return "登录失败", 500

    courses = get_courses(user_id, session_id)
    return render_template("index.html", courses=courses)


@app.route("/generate_qr", methods=["POST"])
def generate_qr():
    course_sched_id = request.json.get("courseSchedId")
    timestamp = request.json.get("timestamp", 0)
    url = f"http://iclass.buaa.edu.cn:8081/app/course/stu_scan_sign.action?courseSchedId={course_sched_id}&timestamp={timestamp}"

    return jsonify({"qrUrl": url})


if __name__ == "__main__":
    app.run(debug=True)
