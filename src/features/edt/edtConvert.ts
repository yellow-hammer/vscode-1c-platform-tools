/**
 * Конвертация исходного кода между форматами силами 1C:EDT.
 *
 * Проект EDT выгружается в формат конфигуратора командой `export`, выгрузка
 * конфигуратора становится проектом командой `import`. Проекту расширения нужен
 * базовый проект: при выгрузке он подключается к рабочей области первым, при
 * импорте передаётся явно, иначе EDT примет расширение за конфигурацию.
 *
 * @module edtConvert
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { VRunnerManager } from '../../shared/vrunnerManager';
import type { SourceFormat } from '../../shared/projectLayout';
import { TaskOutputChain } from '../tasks/vrunnerTask';
import {
	detachProject,
	edtProjectName,
	edtWorkspaceDir,
	ensureProjectRegistered,
	runEdtCommand,
	type EdtRunResult,
} from './edtRunner';

/** Каталог в каталоге сборки, куда по умолчанию конвертируется конфигурация из выгрузки конфигуратора. */
export const CONVERTED_CONFIGURATION_DIR = 'cf-edt';

/** Что и куда конвертируется; каталоги абсолютные. */
export interface EdtConversion {
	/** Проект EDT или выгрузка конфигуратора. */
	sourceDir: string;
	/** Формат исходного кода: результат будет в другом. */
	format: SourceFormat;
	/** Каталог результата. */
	outputPath: string;
	/** Базовый проект EDT, когда конвертируется расширение. */
	baseProjectDir?: string;
}

/**
 * Базовый проект EDT для расширения из выгрузки конфигуратора.
 *
 * Первым берётся проект, в который конвертировалась конфигурация, затем
 * единственная конфигурация EDT рабочей области.
 *
 * @param convertedConfiguration - Каталог конвертированной конфигурации по умолчанию
 * @param edtConfigurations - Проекты конфигураций EDT рабочей области
 * @param exists - Проверка файла
 * @returns Каталог базового проекта либо undefined
 */
export function designerExtensionBase(
	convertedConfiguration: string,
	edtConfigurations: readonly string[],
	exists: (file: string) => boolean = fs.existsSync
): string | undefined {
	if (exists(path.join(convertedConfiguration, '.project'))) {
		return convertedConfiguration;
	}
	return edtConfigurations.length === 1 ? edtConfigurations[0] : undefined;
}

/**
 * Конвертирует исходный код в другой формат.
 *
 * @param workspaceRoot - Корень рабочей области
 * @param conversion - Что и куда конвертируется
 * @param background - Команду ждёт вызывающий: 1cedtcli идёт в фоне, без терминала
 * @returns Итог первой неудавшейся команды 1cedtcli либо последней
 */
export async function convertSourcesWithEdt(
	workspaceRoot: string,
	conversion: EdtConversion,
	background = false
): Promise<EdtRunResult> {
	const workspaceDir = edtWorkspaceDir(workspaceRoot, VRunnerManager.getInstance().getOutPath());
	const output = new TaskOutputChain(background);

	if (conversion.baseProjectDir !== undefined) {
		const registered = await ensureProjectRegistered(conversion.baseProjectDir, workspaceDir, workspaceRoot, output);
		if (registered.exitCode !== 0) {
			return registered;
		}
	}

	if (conversion.format === 'edt') {
		const registered = await ensureProjectRegistered(conversion.sourceDir, workspaceDir, workspaceRoot, output);
		if (registered.exitCode !== 0) {
			return registered;
		}
		await fsp.rm(conversion.outputPath, { recursive: true, force: true });
		const name = edtProjectName(conversion.sourceDir);
		return runEdtCommand({
			command: 'export',
			args: ['--project-name', name, '--configuration-files', conversion.outputPath],
			title: `EDT: выгрузка ${name} в формат конфигуратора`,
			workspaceDir,
			cwd: workspaceRoot,
			output,
		});
	}

	// Проект прошлой конвертации ещё подключён к рабочей области: в подключённый проект импорт не идёт
	const detached = await detachProject(conversion.outputPath, workspaceDir, workspaceRoot, output);
	if (detached.exitCode !== 0) {
		return detached;
	}
	await fsp.rm(conversion.outputPath, { recursive: true, force: true });
	const baseArgs = conversion.baseProjectDir === undefined
		? []
		: ['--base-project-name', edtProjectName(conversion.baseProjectDir)];
	return runEdtCommand({
		command: 'import',
		args: ['--configuration-files', conversion.sourceDir, '--project', conversion.outputPath, ...baseArgs],
		title: `EDT: импорт ${path.basename(conversion.sourceDir)} в проект`,
		workspaceDir,
		cwd: workspaceRoot,
		output,
	});
}
