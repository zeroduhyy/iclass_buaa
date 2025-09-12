"""
Authentication module for BUAA SSO system.
Handles login and session management.
"""

import requests
from bs4 import BeautifulSoup
import config
import logging
import time

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("auth")


class SSOAuth:
    def __init__(self, username=None, password=None):
        """Initialize the SSO authentication handler."""
        self.username = username or config.USERNAME
        self.password = password or config.PASSWORD
        self.session = requests.Session()
        self.session_id = None
        self.user_info = None

    def login(self):
        """
        Log in to the BUAA SSO system and return the session.
        Returns:
            bool: True if login successful, False otherwise
        """
        if not self.username or not self.password:
            logger.error("Username or password not provided")
            return False

        try:
            # Step 1: Get the login page to obtain the execution parameter
            logger.info("Fetching SSO login page...")
            response = self.session.get(
                config.SSO_LOGIN_URL,
                params={"service": config.ICLASS_SERVICE_URL},
                allow_redirects=True,
            )

            # Parse the login page to get the execution parameter
            soup = BeautifulSoup(response.text, "html.parser")
            execution = soup.find("input", {"name": "execution"}).get("value")

            if not execution:
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
                "Referer": config.SSO_LOGIN_URL,
                "Content-Type": "application/x-www-form-urlencoded",
            }

            # IMPORTANT: Don't follow redirects immediately
            response = self.session.post(
                config.SSO_LOGIN_URL,
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
                            config.SSO_LOGIN_URL,
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
                                logger.error(
                                    f"Failed to redirect to iClass after 'Ignore Once'. URL: {response.url}"
                                )
                                return False
                    else:
                        logger.error(
                            "Could not find execution parameter in the continue form"
                        )
                        return False
                else:
                    logger.error("Could not find continue form on the page")
                    return False

            # If not 401, follow normal redirect flow
            elif response.status_code in (301, 302, 303, 307, 308):
                redirect_url = response.headers.get("Location")
                logger.info(f"Redirecting to: {redirect_url}")

                # Follow the redirect
                response = self.session.get(redirect_url, allow_redirects=True)

                # Check if we're successfully logged in
                logger.info(f"Final URL after redirects: {response.url}")

                if "iclass.buaa.edu.cn" in response.url:
                    logger.info("Login successful")
                    self._get_user_info()
                    return True

            # If we get here, login failed
            logger.error(f"Login failed. Final URL: {response.url}")
            return False

        except Exception as e:
            logger.error(f"Error during login: {str(e)}")
            return False

    def _get_user_info(self):
        try:
            logger.info("Fetching user info from iClass API...")
            login_api = f"{config.ICLASS_API_BASE}/user/login.action"
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
                else:
                    logger.error(f"Failed to get user info: {user_data}")
            else:
                logger.error(f"Failed to get user info: {response.status_code}")
        except Exception as e:
            logger.error(f"Error getting user info: {str(e)}")
