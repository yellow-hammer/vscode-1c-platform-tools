import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONVENTIONAL_PATHS } from '../../shared/projectPaths';
import { logger } from '../../shared/logger';

const log = logger.scope('testing');

/**
 * Подсказка для проектов со старой раскладкой тестовых обработок.
 *
 * Исходники тестовых обработок переехали из `src/tests` в `tests/epf`: в `src`
 * остаётся только поставляемое решение. Автоматически подменять каталог нельзя
 * - раскладка фиксированная, поэтому старый каталог не подхватывается молча,
 * а превращается в явное сообщение.
 *
 * @param workspaceRoot - Корень проекта
 * @returns Текст подсказки либо undefined, если раскладка в порядке
 */
export function legacyTestsSrcHint(workspaceRoot: string): string | undefined {
	const testsSrc = CONVENTIONAL_PATHS.testsEpf;
	if (fs.existsSync(path.join(workspaceRoot, testsSrc))) {
		return undefined;
	}
	if (!fs.existsSync(path.join(workspaceRoot, 'src', 'tests'))) {
		return undefined;
	}
	return (
		`Исходники тестовых обработок теперь ожидаются в ${testsSrc}, ` +
		'а в проекте они лежат в src/tests. Перенесите каталог: раскладка тестов определяется по каталогу tests.'
	);
}

/**
 * Показывает подсказку о старой раскладке один раз за сеанс.
 *
 * @param workspaceRoot - Корень проекта
 */
export function warnOnLegacyTestsSrc(workspaceRoot: string): void {
	if (warned) {
		return;
	}
	const hint = legacyTestsSrcHint(workspaceRoot);
	if (!hint) {
		return;
	}
	warned = true;
	log.warn(hint);
	void vscode.window.showWarningMessage(hint);
}

/** Показывали ли подсказку в этом сеансе: повторять её на каждый прогон незачем. */
let warned = false;
