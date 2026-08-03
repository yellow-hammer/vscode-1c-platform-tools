/**
 * Типовые цепочки шагов, поставляемые с расширением.
 *
 * Шаблон - обычный пайплайн из `resources/templates/pipelines.template.json`: он разворачивается
 * в `.1cpt/pipelines.json` проекта и дальше правится как своя цепочка. Узнаём цепочку шаблона по
 * идентификатору, поэтому повторная установка обновляет её, а соседние цепочки не трогает.
 * @module pipelineTemplates
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../logger';
import { normalizePipelines, Pipeline } from './pipelineTypes';

const log = logger.scope('pipelines');

/** Признак цепочки из шаблона: по нему её узнают при повторной установке и в дереве. */
export const PIPELINE_TEMPLATE_ID_PREFIX = 'template-';

/** Файл шаблонов в каталоге шаблонов расширения. */
const TEMPLATES_REL_PATH = 'resources/templates/pipelines.template.json';

/**
 * Читает типовые цепочки, поставляемые с расширением.
 *
 * @param extensionPath Корень установленного расширения.
 * @returns Список шаблонов; при нечитаемом файле - пустой список и запись в журнале.
 */
export async function readPipelineTemplates(extensionPath: string): Promise<Pipeline[]> {
	const fullPath = path.join(extensionPath, ...TEMPLATES_REL_PATH.split('/'));
	try {
		const text = await fs.readFile(fullPath, 'utf8');
		return normalizePipelines(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
	} catch (error) {
		log.warn(`Не удалось прочитать типовые пайплайны: ${error instanceof Error ? error.message : String(error)}`);
		return [];
	}
}

/** Что сделала установка шаблонов с цепочками проекта. */
export interface TemplateMergeResult {
	pipelines: Pipeline[];
	/** Идентификаторы добавленных цепочек. */
	added: string[];
	/** Идентификаторы обновлённых цепочек. */
	updated: string[];
}

/**
 * Добавляет шаблоны к цепочкам проекта: цепочка с тем же идентификатором заменяется на месте,
 * новая дописывается в конец. Цепочки проекта, которых нет среди шаблонов, остаются как были -
 * в том числе правленые руками.
 *
 * @param existing Цепочки проекта.
 * @param templates Устанавливаемые шаблоны.
 */
export function mergePipelineTemplates(
	existing: readonly Pipeline[],
	templates: readonly Pipeline[]
): TemplateMergeResult {
	const pipelines = [...existing];
	const added: string[] = [];
	const updated: string[] = [];

	for (const template of templates) {
		const index = pipelines.findIndex((pipeline) => pipeline.id === template.id);
		if (index === -1) {
			pipelines.push(template);
			added.push(template.id);
		} else {
			pipelines[index] = template;
			updated.push(template.id);
		}
	}

	return { pipelines, added, updated };
}

/** Сообщение об установке для журнала и уведомления. */
export function mergeSummary(result: TemplateMergeResult, byId: ReadonlyMap<string, string>): string {
	const names = (ids: readonly string[]): string => ids.map((id) => byId.get(id) ?? id).join(', ');
	if (result.updated.length === 0) {
		return `Добавлены цепочки: ${names(result.added)}`;
	}
	if (result.added.length === 0) {
		return `Обновлены цепочки: ${names(result.updated)}`;
	}
	return `Добавлены цепочки: ${names(result.added)}; обновлены: ${names(result.updated)}`;
}
