"""
Authentication module for BUAA SSO system.
Handles login and session management.
"""

import requests
from bs4 import BeautifulSoup
import logging
import time
import urllib3


# from config.py

SSO_LOGIN_URL = "https://sso.buaa.edu.cn/login"
ICLASS_SERVICE_URL = "https://iclass.buaa.edu.cn:8346/"
ICLASS_API_BASE = "https://iclass.buaa.edu.cn:8346/app"
ICLASS_QR_BASE = "http://iclass.buaa.edu.cn:8081/app/course/stu_scan_sign.action"


# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("auth")


class SSOAuth:
    def __init__(self, username=None, password=None, verify_ssl=True):
        """Initialize the SSO authentication handler.

        Args:
            username: 用户名/学号
            password: 密码
            verify_ssl: 是否验证 SSL 证书。对于证书过期且你信任目标站点的情况，可传入 False 临时绕过证书校验。
        """
        self.username = username
        self.password = password
        # requests.Session().verify 控制是否验证 SSL 证书
        self.session = requests.Session()
        self.session.verify = verify_ssl
        # 如果选择不验证证书，屏蔽 urllib3 的 InsecureRequestWarning
        if not verify_ssl:
           urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        self.session_id = None
        self.user_info = None
        # 最近一次错误信息，供调用者展示
        self.last_error = None

    def login(self):
        """
        Log in to the BUAA SSO system and return the session.
        Returns:
            bool: True if login successful, False otherwise
        """
        if not self.username or not self.password:
            self.last_error = "用户名或密码未提供"
            logger.error("Username or password not provided")
            return False

        try:
            # Step 1: Get the login page to obtain the execution parameter
            logger.info("Fetching SSO login page...")
            response = self.session.get(
                SSO_LOGIN_URL,
                params={"service": ICLASS_SERVICE_URL},
                allow_redirects=True,
            )

            # Parse the login page to get the execution parameter
            soup = BeautifulSoup(response.text, "html.parser")
            execution = soup.find("input", {"name": "execution"}).get("value")

            if not execution:
                self.last_error = "无法从 SSO 登录页面解析必要参数（execution）"
                logger.error("Could not find execution parameter")
                return False

            logger.info(f"Got execution parameter: {execution[:20]}...")

            # Step 2: Submit login credentials
            logger.info("Submitting login credentials...")
            login_data = {
                "username": self.username,
                "password": self.password,
                "submit": "登录",
                "type": "username_password",
                "execution": execution,
                "_eventId": "submit",
            }

            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
                "Referer": SSO_LOGIN_URL,
                "Content-Type": "application/x-www-form-urlencoded",
            }

            # IMPORTANT: Don't follow redirects immediately
            response = self.session.post(
                SSO_LOGIN_URL,
                headers=headers,
                data=login_data,
                allow_redirects=False,
            )

            logger.info(f"Initial login response status: {response.status_code}")

            # If 401 Unauthorized, treat it as the weak password page regardless of content
            if response.status_code == 401:
                logger.info("Got 401 Unauthorized - Processing as weak password page")

                # Extract the execution parameter from the response
                soup = BeautifulSoup(response.text, "html.parser")
                continue_form = soup.find("form", {"id": "continueForm"})

                if continue_form:
                    execution_input = continue_form.find("input", {"name": "execution"})

                    if execution_input:
                        execution_val = execution_input.get("value")
                        logger.info(
                            f"Found execution value for continue form: {execution_val[:20]}..."
                        )

                        # Wait for 6 seconds for the countdown
                        logger.info(
                            "Waiting for 6 seconds for the 'Ignore Once' button to become active..."
                        )
                        time.sleep(6)

                        # Submit the "ignoreAndContinue" form
                        continue_data = {
                            "execution": execution_val,
                            "_eventId": "ignoreAndContinue",
                        }

                        logger.info("Submitting 'Ignore Once' request...")
                        response = self.session.post(
                            SSO_LOGIN_URL,
                            headers=headers,
                            data=continue_data,
                            allow_redirects=False,
                        )

                        logger.info(
                            f"'Ignore Once' response status: {response.status_code}"
                        )

                        # Follow the redirect chain from this point
                        if response.status_code in (301, 302, 303, 307, 308):
                            redirect_url = response.headers.get("Location")
                            logger.info(f"Redirecting to: {redirect_url}")

                            # Follow all redirects automatically now
                            response = self.session.get(
                                redirect_url, allow_redirects=True
                            )

                            logger.info(
                                f"Final URL after 'Ignore Once': {response.url}"
                            )

                            if "iclass.buaa.edu.cn" in response.url:
                                logger.info(
                                    "Successfully handled weak password and completed login"
                                )
                                self._get_user_info()
                                return True
                            else:
                                self.last_error = f"忽略提示后跳转到 iClass 失败，URL: {response.url}"
                                logger.error(
                                    f"Failed to redirect to iClass after 'Ignore Once'. URL: {response.url}"
                                )
                                return False
                    else:
                        self.last_error = "在弱密码页面找不到 continue 表单的 execution 参数"
                        logger.error(
                            "Could not find execution parameter in the continue form"
                        )
                        return False
                else:
                    self.last_error = "弱密码页面未找到 continue 表单（页面结构可能变化）"
                    logger.error("Could not find continue form on the page")
                    return False

            # If not 401, follow normal redirect flow
            elif response.status_code in (301, 302, 303, 307, 308):
                redirect_url = response.headers.get("Location")
                logger.info(f"Redirecting to: {redirect_url}")

                # Follow the redirect
                try:
                    response = self.session.get(redirect_url, allow_redirects=True)
                except Exception as e:
                    self.last_error = f"重定向时网络/证书错误：{e}"
                    logger.error(f"Error following redirect: {e}")
                    return False

                # Check if we're successfully logged in
                logger.info(f"Final URL after redirects: {response.url}")

                if "iclass.buaa.edu.cn" in response.url:
                    logger.info("Login successful")
                    self._get_user_info()
                    return True

            # If we get here, login failed
            self.last_error = f"登录失败，最终 URL: {getattr(response, 'url', 'unknown')}"
            logger.error(f"Login failed. Final URL: {getattr(response, 'url', 'unknown')}")
            return False

        except Exception as e:
            self.last_error = str(e)
            logger.error(f"Error during login: {str(e)}")
            return False

    def _get_user_info(self):
        try:
            logger.info("Fetching user info from iClass API...")
            login_api = f"{ICLASS_API_BASE}/user/login.action"
            params = {
                "phone": self.username,  # 直接用学号
                "password": "",
                "verificationType": "2",
                "verificationUrl": "",
                "userLevel": "1",
            }

            response = self.session.get(login_api, params=params)
            if response.status_code == 200:
                user_data = response.json()
                if user_data.get("STATUS") == "0":
                    self.user_info = user_data.get("result", {})
                    self.session_id = self.user_info.get("sessionId")
                    logger.info(f"Got user info for: {self.user_info.get('realName')}")
                    return True
                else:
                    self.last_error = f"iClass API 返回错误: {user_data}"
                    logger.error(f"Failed to get user info: {user_data}")
                    return False
            else:
                self.last_error = f"请求 iClass API 失败，HTTP 状态: {response.status_code}"
                logger.error(f"Failed to get user info: {response.status_code}")
                return False
        except Exception as e:
            self.last_error = str(e)
            logger.error(f"Error getting user info: {str(e)}")
            return False
