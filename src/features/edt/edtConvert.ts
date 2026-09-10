/**
 * Конвертация исходников между форматами силами 1С:EDT.
 *
 * vanessa-runner 3 умеет это сам, но до `3.0.0-rc8` такой команды у него нет.
 * Внутри раннер всё равно вызывает `1cedtcli`, поэтому при старом раннере
 * расширение обращается к EDT напрямую и результат получается тот же.
 *
 * @module edtConvert
 */

import * as path from 'node:path';
import { VRunnerManager } from '../../shared/vrunnerManager';
import type { SourceRoot } from '../../shared/projectLayout';
import { edtWorkspaceDir, runEdtCommand } from './edtRunner';

/**
 * Конвертирует исходники в противоположный формат.
 *
 * Формат источника известен из раскладки: проект EDT выгружается в XML командой
 * `export`, выгрузка конфигуратора собирается в проект командой `import`.
 *
 * @param workspaceRoot - Корень рабочей области
 * @param source - Конфигурация, исходники которой конвертируются
 * @param outputPath - Каталог результата
 * @returns Код возврата 1cedtcli
 */
export async function convertSourcesWithEdt(
	workspaceRoot: string,
	source: SourceRoot,
	outputPath: string
): Promise<number> {
	const vrunner = VRunnerManager.getInstance();
	const workspaceDir = edtWorkspaceDir(workspaceRoot, vrunner.getOutPath());
	const projectName = path.basename(source.dir);

	if (source.format === 'edt') {
		return runEdtCommand({
			command: 'export',
			args: ['--project', source.dir, '--configuration-files', outputPath],
			title: `EDT: выгрузка ${projectName} в формат конфигуратора`,
			workspaceDir,
			cwd: workspaceRoot,
		});
	}

	return runEdtCommand({
		command: 'import',
		args: ['--configuration-files', source.dir, '--project-name', path.basename(outputPath)],
		title: `EDT: импорт ${projectName} в проект`,
		workspaceDir: outputPath,
		cwd: workspaceRoot,
	});
}
