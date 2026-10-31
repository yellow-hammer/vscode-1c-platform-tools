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

/** Движок OneScript проекта. */
export interface EnvironmentEngineInfo extends EnvironmentToolInfo {
	/** Откуда взят движок. */
	source?: string;
	/** ВерсияСреды из packagedef проекта. */
	required?: string;
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

/** Каталог установки платформы и версии в нём. */
export interface EnvironmentPlatformInstallation {
	/** Каталог установки. */
	root: string;
	/** Версии от новых к старым; пусто, если каталогов версий нет. */
	versions: string[];
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
	/** Движок OneScript проекта. */
	oscript: EnvironmentEngineInfo;
	/** vrunner. */
	vrunner: EnvironmentToolInfo;
	/** Загруженные компоненты. */
	components: EnvironmentComponentInfo[];
	/** Найденные установки платформы. */
	platformInstallations: EnvironmentPlatformInstallation[];
	/** Путь к 1cestart. */
	cestartPath?: string;
	/** Путь к rac. */
	racPath?: string;
	/** Найденные версии 1С:EDT. */
	edtVersions: string[];
	/** Путь к 1cedtcli выбранной установки. */
	edtCliPath?: string;
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
	lines.push(formatEngineLine(summary.oscript));
	lines.push(formatToolLine('vrunner', summary.vrunner));
	lines.push('- Компоненты:');
	if (summary.components.length === 0) {
		lines.push('  - нет');
	} else {
		for (const component of summary.components) {
			lines.push(`  - ${formatComponentLine(component)}`);
		}
	}
	lines.push(`- Платформа 1С: ${formatPlatformInstallations(summary.platformInstallations)}`);
	lines.push(`- 1cestart: ${summary.cestartPath ?? 'не найден'}`);
	lines.push(`- rac: ${summary.racPath ?? 'не найден'}`);
	lines.push(
		`- 1С:EDT: ${summary.edtVersions.length > 0 ? summary.edtVersions.join(', ') : 'не найдена'}`
	);
	if (summary.edtCliPath) {
		lines.push(`- 1cedtcli: ${summary.edtCliPath}`);
	}
	return `${lines.join('\n')}\n`;
}

/**
 * Установки платформы: версии и каталог каждой установки.
 *
 * @param installations - Найденные установки
 * @returns Текст после подписи
 */
export function formatPlatformInstallations(installations: readonly EnvironmentPlatformInstallation[]): string {
	if (installations.length === 0) {
		return 'не найдена';
	}
	return installations
		.map((item) => (item.versions.length > 0 ? `${item.versions.join(', ')} в ${item.root}` : item.root))
		.join('; ');
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
 * Строка про движок OneScript: как у инструмента, и откуда он взят и что требует проект.
 *
 * @param engine - Сведения о движке
 * @returns Строка списка
 */
export function formatEngineLine(engine: EnvironmentEngineInfo): string {
	const notes = [
		engine.source ? `выбран: ${engine.source}` : undefined,
		engine.required ? `ВерсияСреды: ${engine.required}` : undefined,
	].filter((note): note is string => note !== undefined);
	const line = formatToolLine('OneScript', engine);
	return notes.length > 0 ? `${line} (${notes.join('; ')})` : line;
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
