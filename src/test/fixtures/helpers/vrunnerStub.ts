import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Локальный vanessa-runner проекта, отвечающий на запрос версии сразу.
 *
 * @param root - Корень временного проекта
 * @param version - Версия, которую напечатает раннер
 */
export function writeLocalRunner(root: string, version: string): void {
	const bin = path.join(root, 'oscript_modules', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	if (process.platform === 'win32') {
		fs.writeFileSync(path.join(bin, 'vrunner.bat'), `@echo ${version}\r\n`, 'utf8');
		return;
	}
	const runner = path.join(bin, 'vrunner');
	fs.writeFileSync(runner, `#!/bin/sh\necho ${version}\n`, 'utf8');
	fs.chmodSync(runner, 0o755);
}
