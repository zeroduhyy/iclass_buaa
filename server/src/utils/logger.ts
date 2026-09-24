import winston from 'winston';

// 定义日志格式
const myFormat = winston.format.printf(({ level, message, timestamp }) => {
    // 这行就是你看到的最终打印格式，可以根据喜好调整
    return `[${timestamp}] ${level}: ${message}`;
});

/**
 * 无界面运行时（systemd / 重定向到文件）不要塞 ANSI 颜色码，否则 journalctl 和日志文件里
 * 全是转义字符。判据：显式设了 NO_COLOR，或 stdout 不是 TTY。
 */
const useColor =
    !process.env.NO_COLOR && Boolean(process.stdout && process.stdout.isTTY);

const logger = winston.createLogger({
    level: process.env.ICLASS_LOG_LEVEL ?? 'debug', // 同样支持级别控制
    format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }), // 时间戳
        ...(useColor ? [winston.format.colorize()] : []), // 颜色（对应 pino 的 colorize）
        myFormat // 应用自定义格式
    ),
    transports: [
        new winston.transports.Console() // 输出到控制台
    ]
});

export default logger;
