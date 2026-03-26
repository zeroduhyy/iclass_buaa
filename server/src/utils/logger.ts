import winston from 'winston';

// 定义日志格式
const myFormat = winston.format.printf(({ level, message, timestamp }) => {
    // 这行就是你看到的最终打印格式，可以根据喜好调整
    return `[${timestamp}] ${level}: ${message}`;
});

const logger = winston.createLogger({
    level: 'debug', // 同样支持级别控制
    format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }), // 时间戳
        winston.format.colorize(), // 颜色（对应 pino 的 colorize）
        myFormat // 应用自定义格式
    ),
    transports: [
        new winston.transports.Console() // 输出到控制台
    ]
});

export default logger;