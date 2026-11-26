/**
 * Выбор версии формата новой конфигурации: список форматов даёт md-sparrow.
 * @module dumpFormatPick
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsRead } from './mdSparrowParams';
import { designerXmlVersionToMdSparrowFlag } from './mdSparrowSchemaVersion';

const log = logger.scope('metadata');

/** Формат выгрузки и линейка платформы, которая его пишет: ответ md-sparrow `cf-format-versions`. */
interface DumpFormat {
	readonly version: string;
	readonly platform: string;
}

/** Платформа нового проекта EDT и флаг формата для заготовки. */
export interface EdtPlatformChoice {
	/** Флаг md-sparrow, например `V2_20`. */
	readonly schemaVersion: string;
	/** Линейка платформы, она попадёт в `Runtime-Version`. */
	readonly platform: string;
}

/**
 * Список форматов выгрузки из md-sparrow, от нового к старому.
 *
 * @param context - Контекст расширения: нужен для запуска md-sparrow
 * @param format - Формат создаваемого проекта, для которого нужны эталоны
 * @returns Форматы либо undefined, если список не получен
 */
async function dumpFormatsNewestFirst(
	context: vscode.ExtensionContext, format: 'designer' | 'edt'
): Promise<DumpFormat[] | undefined> {
	try {
		const res = await runMdSparrowParamsRead(await ensureMdSparrowRuntime(context), { op: 'cf-format-versions', format });
		if (res.exitCode !== 0) {
			throw new Error(res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`);
		}
		const formats = JSON.parse(res.stdout) as DumpFormat[];
		// md-sparrow перечисляет форматы от старого к новому, а выбирают обычно новый
		return [...formats].reverse();
	} catch (e) {
		log.error(`версии формата выгрузки: ${e instanceof Error ? e.message : String(e)}`);
		void vscode.window.showErrorMessage('Не удалось получить версии формата выгрузки.');
		return undefined;
	}
}

/**
 * Спрашивает версию формата новой конфигурации.
 *
 * @param context - Контекст расширения: нужен для запуска md-sparrow
 * @param title - Заголовок выбора
 * @returns Флаг md-sparrow, например `V2_21`; undefined, если выбор отменён или список не получен
 */
export async function pickDumpFormat(context: vscode.ExtensionContext, title: string): Promise<string | undefined> {
	const formats = await dumpFormatsNewestFirst(context, 'designer');
	if (!formats) {
		return undefined;
	}
	const pick = await vscode.window.showQuickPick(
		formats.map((format) => ({ label: format.version, description: `платформа ${format.platform}` })),
		{ title }
	);
	return pick && designerXmlVersionToMdSparrowFlag(pick.label);
}

/**
 * Спрашивает линейку платформы нового проекта EDT.
 *
 * Список тот же, что у выгрузки конфигуратора: его отдаёт md-sparrow.
 * В манифест проекта пишется выбранная линейка, а не всегда 8.5.1.
 *
 * @param context - Контекст расширения: нужен для запуска md-sparrow
 * @returns Платформа и флаг формата либо undefined, если выбор отменён или список не получен
 */
export async function pickEdtPlatform(context: vscode.ExtensionContext): Promise<EdtPlatformChoice | undefined> {
	const formats = await dumpFormatsNewestFirst(context, 'edt');
	if (!formats) {
		return undefined;
	}
	const pick = await vscode.window.showQuickPick(
		formats.map((format) => ({
			label: format.platform,
			description: `формат ${format.version}`,
			format,
		})),
		{
			title: 'Версия платформы',
			placeHolder: 'Попадёт в манифест проекта',
		}
	);
	if (!pick) {
		return undefined;
	}
	return {
		schemaVersion: designerXmlVersionToMdSparrowFlag(pick.format.version),
		platform: pick.format.platform,
	};
}
