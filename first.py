import sys
import os
import json
import re
import requests
from getpass import getpass


def print_header():
    print("=" * 50)
    print("北航iClass签到配置自动生成工具")
    print("=" * 50)
    print("本工具将自动获取您的loginName和课程ID，并生成config.json文件")
    print("请按照提示输入您的信息\n")


def login_buaa_sso():
    """登录北航SSO系统并获取loginName和session信息"""
    print("\n[步骤1] 登录北航SSO系统")

    username = input("请输入您的学号: ")
    password = getpass("请输入您的密码(输入时不会显示): ")

    print("\n正在登录SSO系统...")

    # 创建会话对象
    session = requests.Session()

    # 获取登录页面的execution参数
    response = session.get(
        "https://sso.buaa.edu.cn/login",
        params={"service": "https://iclass.buaa.edu.cn:8346/eams-apps/app"},
        allow_redirects=True,
    )

    # 从页面中提取execution参数
    execution_match = re.search(r'name="execution" value="([^"]+)"', response.text)
    if not execution_match:
        print("获取登录参数失败，请稍后重试")
        return None, None

    execution = execution_match.group(1)

    # 提交登录表单
    login_data = {
        "username": username,
        "password": password,
        "submit": "登录",
        "type": "username_password",
        "execution": execution,
        "_eventId": "submit",
    }

    response = session.post(
        "https://sso.buaa.edu.cn/login", data=login_data, allow_redirects=False
    )

    # 如果登录成功应该有重定向
    if response.status_code in (301, 302, 303, 307, 308):
        # 处理可能的弱密码页面
        if "weakpasswordpage" in response.headers.get("Location", ""):
            print("检测到弱密码提醒页面，自动处理中...")
            weak_password_url = response.headers.get("Location")
            response = session.get(weak_password_url, allow_redirects=False)

            # 从弱密码页面提取execution参数
            continue_match = re.search(
                r'name="execution" value="([^"]+)"', response.text
            )
            if continue_match:
                execution_val = continue_match.group(1)

                # 等待几秒钟模拟用户操作
                print("等待几秒钟...")
                import time

                time.sleep(5)

                # 提交"忽略一次"表单
                continue_data = {
                    "execution": execution_val,
                    "_eventId": "ignoreAndContinue",
                }

                response = session.post(
                    "https://sso.buaa.edu.cn/login",
                    data=continue_data,
                    allow_redirects=False,
                )

        # 跟随重定向链接
        redirect_url = response.headers.get("Location")
        response = session.get(redirect_url, allow_redirects=True)

        # 尝试从URL中提取loginName
        login_name_match = re.search(r"loginName=([^&#]+)", response.url)
        if login_name_match:
            login_name = login_name_match.group(1)
            print("登录成功！")
            return login_name, session

    print("登录失败，请检查用户名和密码")
    return None, None


def get_user_info(session, login_name):
    """获取用户ID和会话ID"""
    print("\n[步骤2] 获取用户信息")

    login_api = "https://iclass.buaa.edu.cn:8346/app/user/login.action"
    params = {
        "phone": login_name,
        "password": "",
        "verificationType": "2",
        "verificationUrl": "",
        "userLevel": "1",
    }

    response = session.get(login_api, params=params)

    if response.status_code == 200:
        data = response.json()
        if data.get("STATUS") == "0":
            user_id = data.get("result", {}).get("id")
            session_id = data.get("result", {}).get("sessionId")
            user_name = data.get("result", {}).get("realName")
            print(f"获取用户信息成功！欢迎您，{user_name}")
            return user_id, session_id

    print("获取用户信息失败")
    return None, None


def get_courses(session, user_id, session_id):
    """获取用户的所有课程"""
    print("\n[步骤3] 获取课程列表")

    # 先获取当前学期信息
    semester_url = (
        "https://iclass.buaa.edu.cn:8346/app/course/get_base_school_year.action"
    )
    params = {"userId": user_id, "type": "2"}
    headers = {"sessionId": session_id}

    semester_response = session.get(semester_url, params=params, headers=headers)

    current_semester = None
    if semester_response.status_code == 200:
        data = semester_response.json()
        if data.get("STATUS") == "0":
            semesters = data.get("result", [])
            for semester in semesters:
                if semester.get("yearStatus") == "1":
                    current_semester = semester.get("code")
                    print(f"当前学期: {semester.get('name')} ({current_semester})")
                    break

            # 如果没有找到当前学期，使用第一个
            if not current_semester and semesters:
                current_semester = semesters[0].get("code")
                print(f"使用学期: {semesters[0].get('name')} ({current_semester})")

    if not current_semester:
        print("获取学期信息失败")
        return []

    # 获取课程列表
    courses_url = (
        "https://iclass.buaa.edu.cn:8346/app/choosecourse/get_myall_course.action"
    )
    params = {"user_type": "1", "id": user_id, "xq_code": current_semester}

    courses_response = session.get(courses_url, params=params, headers=headers)

    if courses_response.status_code == 200:
        data = courses_response.json()
        if data.get("STATUS") == "0":
            courses_data = data.get("result", [])
            print(f"找到 {len(courses_data)} 门课程")

            courses = []
            for course in courses_data:
                course_name = course.get("course_name", "未知课程")
                course_id = course.get("course_id", "")
                if course_id:
                    courses.append({"name": course_name, "id": course_id})
                    print(f"  - {course_name} (ID: {course_id})")

            return courses

    print("获取课程列表失败")
    return []


def create_config_file(login_name, courses):
    """创建config.json文件"""
    print("\n[步骤4] 创建配置文件")

    # 准备配置数据
    course_entries = []
    for course in courses:
        course_entries.append(f"{course['name']}:{course['id']}")

    config_data = {"loginName": login_name, "courses": course_entries}

    # 写入config.json文件
    try:
        with open("config.json", "w", encoding="utf-8") as f:
            json.dump(config_data, f, ensure_ascii=False, indent=4)
        print("配置文件已成功创建: config.json")
        return True
    except Exception as e:
        print(f"创建配置文件失败: {str(e)}")
        return False


def main():
    print_header()

    # 登录SSO
    login_name, session = login_buaa_sso()
    if not login_name or not session:
        print("\n登录失败，无法继续。请检查网络连接和账号信息后重试。")
        return

    # 获取用户信息
    user_id, session_id = get_user_info(session, login_name)
    if not user_id or not session_id:
        print("\n获取用户信息失败，无法继续。")
        return

    # 获取课程列表
    courses = get_courses(session, user_id, session_id)
    if not courses:
        print("\n未找到课程，无法继续。")
        return

    # 创建配置文件
    success = create_config_file(login_name, courses)

    if success:
        print("\n配置完成！您现在可以运行 start.py 来启动签到二维码生成器。")
        print("运行命令: python start.py")
        print("然后在浏览器中访问: http://localhost:5000")
    else:
        print("\n配置失败，请重试。")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n操作已取消。")
    except Exception as e:
        print(f"\n程序发生错误: {str(e)}")

    input("\n按回车键退出...")
