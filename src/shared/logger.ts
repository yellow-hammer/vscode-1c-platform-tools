import * as vscode from 'vscode';

/** Уровни логирования: чем больше число, тем подробнее вывод */
const LOG_LEVELS = {
	error: 0,
	warnings: 1,
	info: 2,
	debug: 3,
} as const;

export type LogLevelName = keyof typeof LOG_LEVELS;

const OUTPUT_CHANNEL_NAME = '1C: Platform Tools';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Возвращает канал вывода, создавая его при первом обращении
 */
function getChannel(): vscode.OutputChannel {
	outputChannel ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
	return outputChannel;
}

/**
 * Читает текущий уровень логирования из настроек
 */
function getConfiguredLevel(): number {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const name = config.get<LogLevelName>('logLevel', 'info');
	return LOG_LEVELS[name] ?? LOG_LEVELS.info;
}

/**
 * Форматирует строку лога: [время] [уровень] [компонент] сообщение
 */
function formatMessage(level: string, scope: string | undefined, message: string): string {
	const time = new Date().toISOString();
	return scope ? `[${time}] [${level}] [${scope}] ${message}` : `[${time}] [${level}] ${message}`;
}

/**
 * Пишет сообщение в output, если уровень не ниже настроенного
 */
function log(level: LogLevelName, scope: string | undefined, message: string): void {
	const configured = getConfiguredLevel();
	const currentLevel = LOG_LEVELS[level];
	if (currentLevel > configured) {
		return;
	}
	getChannel().appendLine(formatMessage(level, scope, message));
}

/** Логгер компонента: пишет с постоянным префиксом [компонент]. */
export interface ScopedLogger {
	error(message: string): void;
	warn(message: string): void;
	info(message: string): void;
	debug(message: string): void;
}

/**
 * Выводит сообщения в панель Output в соответствии с настройкой logLevel.
 * Модули получают свой префикс через scope(): `const log = logger.scope('md-sparrow');`
 */
export const logger = {
	/** Критические ошибки (всегда видны при уровне error и выше) */
	error(message: string): void {
		log('error', undefined, message);
	},

	/** Предупреждения (видны при warnings, info, debug) */
	warn(message: string): void {
		log('warnings', undefined, message);
	},

	/** Информационные сообщения (видны при info, debug) */
	info(message: string): void {
		log('info', undefined, message);
	},

	/** Отладочные сообщения (видны только при debug) */
	debug(message: string): void {
		log('debug', undefined, message);
	},

	/** Логгер с постоянным компонентом в префиксе: [время] [уровень] [компонент] сообщение. */
	scope(name: string): ScopedLogger {
		return {
			error: (message: string) => log('error', name, message),
			warn: (message: string) => log('warnings', name, message),
			info: (message: string) => log('info', name, message),
			debug: (message: string) => log('debug', name, message),
		};
	},

	/** Показать панель Output с логами расширения */
	show(): void {
		getChannel().show();
	},

	/** Освободить канал (вызывать при деактивации расширения) */
	dispose(): void {
		if (outputChannel) {
			outputChannel.dispose();
			outputChannel = undefined;
		}
	},
};
