import pino from "pino";
import { env, isDev, isTest } from "../config.js";

export const loggerOptions = isTest
  ? false
  : {
      level: env.LOG_LEVEL,
      ...(isDev ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
    };

export const logger = loggerOptions === false ? pino({ level: "silent" }) : pino(loggerOptions);
