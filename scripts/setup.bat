@echo off
:: 关键：设置代码页为 UTF-8
chcp 65001 >nul

echo [1/3] 正在检测 Node.js 环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未找到 Node.js，请先安装!
    pause
    exit
)

echo [2/3] 正在安装依赖 (请保持网络畅通)...
call npm install
cd client && call npm install && cd ..
cd server && call npm install && cd ..

echo [3/3] 依赖安装完成！正在启动应用...
npm run dev
pause