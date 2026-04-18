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
 * Форматирует строку лога с меткой времени и уровнем
 */
function formatMessage(level: string, message: string): string {
	const now = new Date();
	const time = now.toISOString();
	return `[${time}] [${level}] ${message}`;
}

/**
 * Пишет сообщение в output, если уровень не ниже настроенного
 */
function log(level: LogLevelName, message: string): void {
	const configured = getConfiguredLevel();
	const currentLevel = LOG_LEVELS[level];
	if (currentLevel > configured) {
		return;
	}
	const formatted = formatMessage(level, message);
	getChannel().appendLine(formatted);
}

/**
 * Выводит сообщения в панель Output в соответствии с настройкой logLevel.
 */
export const logger = {
	/** Критические ошибки (всегда видны при уровне error и выше) */
	error(message: string): void {
		log('error', message);
	},

	/** Предупреждения (видны при warnings, info, debug) */
	warn(message: string): void {
		log('warnings', message);
	},

	/** Информационные сообщения (видны при info, debug) */
	info(message: string): void {
		log('info', message);
	},

	/** Отладочные сообщения (видны только при debug) */
	debug(message: string): void {
		log('debug', message);
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
