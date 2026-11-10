/**
 * Пересоздание лежащего служебного файла.
 *
 * Новое содержимое берётся из тех же шаблонов и значений, из которых панель
 * создаёт отсутствующий файл. `packagedef` пересоздаёт инициализация проекта:
 * у неё свой шаблон для проекта 1С и для проекта OneScript. Пайплайны целиком
 * не перезаписываются: в файл вставляются отмеченные типовые цепочки.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { SettingsSchema } from '../../shared/envProfiles';
import { newEnvironmentText } from '../../shared/environments';
import { readPackageManifest } from '../../shared/oneScriptLayout';
import { autumnPropertiesOf } from '../../shared/packagedef';
import { projectEnvironmentVariables } from '../launch/projectEnvironmentVariables';
import { buildFileTemplate } from './buildFile';
import { classifyServiceFile } from './catalog';
import {
	HOOKS_DEFAULTS,
	VRUNNER_DEFAULTS,
	VRUNNER_DEFAULTS_V3,
	VRUNNER_INIT_DEFAULTS,
	VRUNNER_INIT_DEFAULTS_V3,
	vrunnerVariantDocument,
} from './envDefaults';
import { buildAutumnPropertiesWithSections, buildEnvJsonWithSections } from './envJsonBuilder';
import { getServiceFileSpec } from './registry';
import { readTemplate } from './templates';

/** Что нужно знать о проекте, чтобы собрать файл. */
export interface RecreateOptions {
	/** Схема настроек установленного vanessa-runner */
	schema: SettingsSchema;
	oneScript: boolean;
	extensionPath: string | undefined;
}

type Source =
	| { kind: 'packagedef' }
	| { kind: 'pipelineTemplates' }
	| { kind: 'profile' }
	| { kind: 'environment' }
	| { kind: 'json'; value: (schema: SettingsSchema) => object }
	| { kind: 'template'; template: string };

const VRUNNER_VARIANT = /^vrunner\.([A-Za-z0-9_.-]+)\.json$/i;

function sourceOf(relPath: string): Source | undefined {
	const kind = classifyServiceFile(relPath);
	const name = path.posix.basename(relPath.replace(/\\/g, '/'));
	switch (kind) {
		case undefined:
			return undefined;
		case 'packagedef':
			return { kind: 'packagedef' };
		case 'profile':
			return { kind: 'profile' };
		case 'environment':
			return { kind: 'environment' };
		case 'hooks':
			return { kind: 'json', value: () => HOOKS_DEFAULTS };
		case 'pipelines':
			return { kind: 'pipelineTemplates' };
		case 'gitignore':
		case 'gitattributes': {
			const template = getServiceFileSpec(kind)?.templateName;
			return template ? { kind: 'template', template } : undefined;
		}
		case 'vrunner': {
			const lower = name.toLowerCase();
			if (lower === 'vrunner.json') {
				return { kind: 'json', value: (schema) => (schema === 'v3' ? VRUNNER_DEFAULTS_V3 : VRUNNER_DEFAULTS) };
			}
			if (lower === 'vrunner.init.json') {
				return { kind: 'json', value: (schema) => (schema === 'v3' ? VRUNNER_INIT_DEFAULTS_V3 : VRUNNER_INIT_DEFAULTS) };
			}
			const id = VRUNNER_VARIANT.exec(name)?.[1];
			return id ? { kind: 'json', value: (schema) => vrunnerVariantDocument(schema, id) } : undefined;
		}
		case 'vanessa':
		case 'xunit':
		case 'yaxunit':
		case 'syntax': {
			const template = buildFileTemplate(name);
			return template ? { kind: 'template', template } : undefined;
		}
		default: {
			const unknown: never = kind;
			return unknown;
		}
	}
}

/**
 * Профиль приложения на Осени: имя и версия из `packagedef` проекта OneScript.
 *
 * @param root - Корень проекта
 */
export function oneScriptLaunchProfileText(root: string): string {
	const properties = autumnPropertiesOf(readPackageManifest(root) ?? {
		dependencies: [],
		classes: [],
		modules: [],
		executables: [],
		includes: [],
	});
	return `${JSON.stringify(properties, null, 4)}\n`;
}

/**
 * Есть ли у файла шаблон, из которого его можно пересоздать.
 *
 * @param relPath - Путь от корня проекта
 * @param oneScript - Проект OneScript: типовых пайплайнов у него нет
 */
export function canRecreateServiceFile(relPath: string, oneScript: boolean): boolean {
	const source = sourceOf(relPath);
	return source !== undefined && !(oneScript && source.kind === 'pipelineTemplates');
}

/**
 * Пересоздание само спрашивает, что вставить в файл, и чужое в нём не трогает:
 * отдельное подтверждение не нужно.
 *
 * @param relPath - Путь от корня проекта
 */
export function recreatePicksParts(relPath: string): boolean {
	return sourceOf(relPath)?.kind === 'pipelineTemplates';
}

/**
 * Записывает файл заново. Профиль спрашивает секции команд, как при создании.
 *
 * @param root - Корень проекта
 * @param relPath - Путь от корня проекта
 * @param options - Схема, вид проекта и каталог расширения
 * @returns true, если файл пересоздан здесь; false, если человек не выбрал секции профиля,
 * шаблона у файла нет или о вставке пайплайнов сообщила сама установка
 */
export async function recreateServiceFile(root: string, relPath: string, options: RecreateOptions): Promise<boolean> {
	const source = sourceOf(relPath);
	if (!source) {
		return false;
	}
	if (source.kind === 'packagedef') {
		await vscode.commands.executeCommand('1c-platform-tools.dependencies.initializePackagedef', root);
		return true;
	}
	if (source.kind === 'pipelineTemplates') {
		await vscode.commands.executeCommand('1c-platform-tools.pipelines.addTemplates');
		return false;
	}
	const text = await sourceText(source, root, relPath, options);
	if (text === undefined) {
		return false;
	}
	await fs.writeFile(path.join(root, relPath), text, 'utf8');
	return true;
}

async function sourceText(
	source: Exclude<Source, { kind: 'packagedef' | 'pipelineTemplates' }>,
	root: string,
	relPath: string,
	options: RecreateOptions
): Promise<string | undefined> {
	switch (source.kind) {
		case 'profile':
			if (options.oneScript) {
				return oneScriptLaunchProfileText(root);
			}
			return path.posix.basename(relPath).startsWith('autumn-properties')
				? buildAutumnPropertiesWithSections()
				: buildEnvJsonWithSections();
		case 'environment':
			return newEnvironmentText(await projectEnvironmentVariables(root));
		case 'json':
			return `${JSON.stringify(source.value(options.schema), null, 4)}\n`;
		case 'template':
			if (!options.extensionPath) {
				throw new Error('Расширение не активировано, шаблоны недоступны');
			}
			return readTemplate(options.extensionPath, source.template);
		default: {
			const unknown: never = source;
			return unknown;
		}
	}
}
