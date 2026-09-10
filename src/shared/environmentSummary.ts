/**
 * Сводка окружения для обращения в поддержку.
 *
 * Собирает то, что помогает разобрать «у меня не работает», и не трогает
 * секреты: токены, пароли и строки подключений в текст не попадают.
 */

/** Найденный инструмент или его отсутствие. */
export interface EnvironmentToolInfo {
	/** Путь или имя команды, если инструмент найден. */
	path?: string;
	/** Версия, если удалось прочитать. */
	version?: string;
}

/** Состояние одного загружаемого компонента. */
export interface EnvironmentComponentInfo {
	/** Название в сводке. */
	title: string;
	/** Тег или версия в кэше. */
	version?: string;
	/** Путь в кэше расширения. */
	cachePath?: string;
	/** Свой путь из настроек, если задан. */
	overridePath?: string;
	/** Автозагрузка выключена. */
	autoloadOff: boolean;
}

/** Данные сводки: форматтер не ходит в файловую систему и не читает настройки. */
export interface EnvironmentSummary {
	/** Тип и выпуск ОС, без архитектуры. */
	os: string;
	/** Архитектура процесса. */
	arch: string;
	/** Имя редактора (VS Code, Cursor). */
	editor: string;
	/** Версия редактора. */
	editorVersion: string;
	/** Имя удалённого окна, если есть. */
	remoteName?: string;
	/** Доверена ли рабочая область. */
	workspaceTrusted?: boolean;
	/** Версия этого расширения. */
	extensionVersion: string;
	/** Версия MCP-расширения; отсутствие — не установлено. */
	mcpVersion?: string;
	/** Версия Node.js процесса редактора. */
	nodeVersion: string;
	/** OneScript. */
	oscript: EnvironmentToolInfo;
	/** vrunner. */
	vrunner: EnvironmentToolInfo;
	/** Загруженные компоненты. */
	components: EnvironmentComponentInfo[];
	/** Найденные версии платформы с rac. */
	platformVersions: string[];
	/** Путь к rac. */
	racPath?: string;
	/** Найденные версии 1С:EDT. */
	edtVersions: string[];
	/** Путь к 1cedtcli выбранной установки. */
	edtCliPath?: string;
	/** IPC включён. */
	ipcEnabled: boolean;
	/** Порт IPC. */
	ipcPort: number;
	/** Токен IPC задан; само значение в сводку не входит. */
	ipcTokenSet: boolean;
}

/**
 * Собирает текстовый блок сводки.
 *
 * @param summary - Собранные сведения
 * @returns Текст, готовый вставить в обращение
 */
export function formatEnvironmentSummary(summary: EnvironmentSummary): string {
	const lines = [
		'## Окружение',
		'',
		`- ОС: ${summary.os} (${summary.arch})`,
		`- Редактор: ${summary.editor} ${summary.editorVersion}`,
	];
	if (summary.remoteName) {
		lines.push(`- Удалённый режим: ${summary.remoteName}`);
	}
	if (summary.workspaceTrusted !== undefined) {
		lines.push(`- Рабочая область: ${summary.workspaceTrusted ? 'доверенная' : 'ограниченная'}`);
	}
	lines.push(`- Расширение: ${summary.extensionVersion}`);
	lines.push(`- MCP: ${summary.mcpVersion ?? 'не установлено'}`);
	lines.push(`- Node: ${summary.nodeVersion}`);
	lines.push(formatToolLine('OneScript', summary.oscript));
	lines.push(formatToolLine('vrunner', summary.vrunner));
	lines.push('- Компоненты:');
	if (summary.components.length === 0) {
		lines.push('  - нет');
	} else {
		for (const component of summary.components) {
			lines.push(`  - ${formatComponentLine(component)}`);
		}
	}
	lines.push(
		`- Платформа 1С: ${summary.platformVersions.length > 0 ? summary.platformVersions.join(', ') : 'не найдена'}`
	);
	lines.push(`- rac: ${summary.racPath ?? 'не найден'}`);
	lines.push(
		`- 1С:EDT: ${summary.edtVersions.length > 0 ? summary.edtVersions.join(', ') : 'не найдена'}`
	);
	if (summary.edtCliPath) {
		lines.push(`- 1cedtcli: ${summary.edtCliPath}`);
	}
	lines.push(formatIpcLine(summary));
	return `${lines.join('\n')}\n`;
}

/**
 * Строка про инструмент: путь и версия либо «не найден».
 *
 * @param label - Подпись
 * @param tool - Сведения
 * @returns Строка списка
 */
export function formatToolLine(label: string, tool: EnvironmentToolInfo): string {
	const parts = [tool.version, tool.path].filter((part): part is string => part !== undefined && part !== '');
	if (parts.length === 0) {
		return `- ${label}: не найден`;
	}
	return `- ${label}: ${parts.join(', ')}`;
}

/**
 * Строка про загружаемый компонент.
 *
 * @param component - Сведения
 * @returns Строка без маркера списка
 */
export function formatComponentLine(component: EnvironmentComponentInfo): string {
	const parts = [component.version ?? 'не загружен'];
	if (component.cachePath) {
		parts.push(component.cachePath);
	}
	if (component.overridePath) {
		parts.push(`свой путь: ${component.overridePath}`);
	}
	if (component.autoloadOff) {
		parts.push('автозагрузка выключена');
	}
	return `${component.title}: ${parts.join(', ')}`;
}

/**
 * Строка про IPC без значения токена.
 *
 * @param summary - Сводка
 * @returns Строка списка
 */
function formatIpcLine(summary: EnvironmentSummary): string {
	const parts = [
		summary.ipcEnabled ? 'включён' : 'выключен',
		`порт ${summary.ipcPort}`,
		summary.ipcTokenSet ? 'токен задан' : 'токен не задан',
	];
	return `- IPC: ${parts.join(', ')}`;
}
