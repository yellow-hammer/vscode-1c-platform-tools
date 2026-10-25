import * as vscode from 'vscode';

const OUTPUT_CHANNEL_NAME = '1C: Platform Tools';
const EXTENSION_ID = 'yellow-hammer.1c-platform-tools';

/** Команда окна, показывающая канал Output: к префиксу дописывается идентификатор канала. */
const SHOW_CHANNEL_COMMAND = 'workbench.action.output.show.';

let outputChannel: vscode.LogOutputChannel | undefined;

/**
 * Возвращает канал вывода с поддержкой уровней, создавая его при первом обращении.
 * Таймстемпы, уровень и фильтрацию по уровню обеспечивает сам VS Code
 * (селектор уровня у канала Output / «Developer: Set Log Level…»).
 */
function getChannel(): vscode.LogOutputChannel {
	outputChannel ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, { log: true });
	return outputChannel;
}

/**
 * Раскрывает панель Output на заданном канале.
 *
 * Журнал (`{ log: true }`) Cursor регистрирует в окне под идентификатором с суффиксом рабочей
 * области, и `show()` его не находит. Поэтому канал показывается командой окна из списка каналов
 * панели: её идентификатор начинается с идентификатора расширения и имени канала без символов,
 * запрещённых в имени файла, а продолжение у VS Code и Cursor своё. Если такой команды нет
 * или их несколько, остаётся `show()`.
 *
 * @param channel - Канал расширения
 */
export async function revealOutputChannel(channel: vscode.OutputChannel): Promise<void> {
	const command = `${SHOW_CHANNEL_COMMAND}${EXTENSION_ID}.${channel.name.replace(/[\\/:*?"<>|]/g, '')}`;
	const found = (await vscode.commands.getCommands(true)).filter(
		(id) => id === command || id.startsWith(`${command}.`)
	);
	if (found.length === 1) {
		await vscode.commands.executeCommand(found[0]);
		return;
	}
	channel.show(true);
}

/** Добавляет к сообщению префикс компонента: `[компонент] сообщение`. */
function withScope(scope: string, message: string): string {
	return `[${scope}] ${message}`;
}

/**
 * true для уровней Debug и подробнее (Trace), но не для Off.
 * Off (=0) численно меньше Debug, поэтому исключается отдельной проверкой.
 */
export function isVerboseLevel(level: vscode.LogLevel): boolean {
	return level !== vscode.LogLevel.Off && level <= vscode.LogLevel.Debug;
}

/** Логгер компонента: пишет с постоянным префиксом [компонент]. */
export interface ScopedLogger {
	error(message: string): void;
	warn(message: string): void;
	info(message: string): void;
	debug(message: string): void;
	trace(message: string): void;
}

/**
 * Выводит сообщения в панель Output поверх `LogOutputChannel`: уровень, таймстемп
 * и фильтрацию по уровню обеспечивает VS Code. В текст добавляется только префикс
 * компонента, который модули получают через scope(): `const log = logger.scope('md-sparrow');`
 */
export const logger = {
	/** Критические ошибки */
	error(message: string): void {
		getChannel().error(message);
	},

	/** Предупреждения */
	warn(message: string): void {
		getChannel().warn(message);
	},

	/** Информационные сообщения */
	info(message: string): void {
		getChannel().info(message);
	},

	/** Отладочные сообщения */
	debug(message: string): void {
		getChannel().debug(message);
	},

	/** Подробная трассировка */
	trace(message: string): void {
		getChannel().trace(message);
	},

	/** Логгер с постоянным компонентом в префиксе: `[компонент] сообщение`. */
	scope(name: string): ScopedLogger {
		return {
			error: (message: string) => getChannel().error(withScope(name, message)),
			warn: (message: string) => getChannel().warn(withScope(name, message)),
			info: (message: string) => getChannel().info(withScope(name, message)),
			debug: (message: string) => getChannel().debug(withScope(name, message)),
			trace: (message: string) => getChannel().trace(withScope(name, message)),
		};
	},

	/** true, если активен уровень Debug или подробнее (Trace) — для диагностики DAP-адаптера. */
	isDebugEnabled(): boolean {
		return isVerboseLevel(getChannel().logLevel);
	},

	/** Показать панель Output с журналом расширения. */
	show(): void {
		void revealOutputChannel(getChannel());
	},

	/** Освободить канал (вызывать при деактивации расширения) */
	dispose(): void {
		outputChannel?.dispose();
		outputChannel = undefined;
	},
};
