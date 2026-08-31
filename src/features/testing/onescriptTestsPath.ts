import * as vscode from 'vscode';
import { DEFAULT_PATHS } from '../../shared/pathDefaults';
import { logger } from '../../shared/logger';

const log = logger.scope('testing');

/** Устаревшая настройка каталога тестов OneScript. */
const LEGACY_SETTING = 'test.path.onescriptTests';

/** Сообщали ли про устаревшую настройку в этом сеансе. */
let warned = false;

/**
 * Каталог скриптовых тестов OneScript.
 *
 * Каталог тестов один - `path.tests`: в его корне лежат `*.os`, а рядом
 * подкаталоги с исходниками тестовых расширений и обработок. Отдельная
 * настройка `test.onescriptTestsPath` описывала то же самое и осталась ради
 * проектов, где её уже задали: заданное значение выигрывает, но об этом
 * говорится в журнале, чтобы настройка не жила незамеченной.
 *
 * @returns Путь к каталогу тестов OneScript относительно корня проекта
 */
export function resolveOnescriptTestsPath(): string {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const legacy = config.inspect<string>(LEGACY_SETTING);
	const explicit = legacy?.workspaceFolderValue ?? legacy?.workspaceValue ?? legacy?.globalValue;
	if (typeof explicit === 'string' && explicit.length > 0) {
		if (!warned) {
			warned = true;
			log.warn(
				`Настройка 1c-platform-tools.${LEGACY_SETTING} устарела: каталог тестов задаётся ` +
				'в 1c-platform-tools.path.tests. Пока используется заданное значение: ' + explicit
			);
		}
		return explicit;
	}
	return config.get<string>('path.tests', DEFAULT_PATHS.tests);
}
