const COLORS = {
    reset: "\x1b[0m",
    gray: "\x1b[90m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m"
} as const;

function timestamp(): string {
    return new Date().toISOString().split("T")[1].replace("Z", "");
}

function paint(color: string, label: string, message: string): string {
    return `${COLORS.gray}[${timestamp()}]${COLORS.reset} ${color}${label}${COLORS.reset} ${message}`;
}

export interface Logger {
    debug(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export const logger: Logger = {

    debug(message: string): void {
        if (!process.env.DEBUG) return;
        console.log(paint(COLORS.gray, "DEBUG", message));
    },

    info(message: string): void {
        console.log(paint(COLORS.cyan, "INFO ", message));
    },

    success(message: string): void {
        console.log(paint(COLORS.green, "OK   ", message));
    },

    warn(message: string): void {
        console.warn(paint(COLORS.yellow, "WARN ", message));
    },

    error(message: string): void {
        console.error(paint(COLORS.red, "ERROR", message));
    }

};
