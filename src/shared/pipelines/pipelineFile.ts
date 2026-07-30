/**
 * Чтение и запись `.1cpt/pipelines.json`.
 *
 * Файл - источник истины: и визуальный редактор, и правки руками работают с
 * одним и тем же JSON, поэтому запись идёт целиком и в том же формате, в каком
 * файл создаётся.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { logger } from '../logger';
import { PIPELINES_SCHEMA } from '../../features/serviceFiles/schemaUrls';
import {
	Pipeline,
	PipelineNode,
	PipelinesFile,
	PIPELINES_FILE_REL_PATH,
	PIPELINES_FILE_VERSION,
	normalizePipelines,
} from './pipelineTypes';

const log = logger.scope('pipelines');

/**
 * Путь к файлу пайплайнов проекта.
 *
 * @param workspaceRoot - Корень проекта
 * @returns Абсолютный путь к `.1cpt/pipelines.json`
 */
export function pipelinesFilePath(workspaceRoot: string): string {
	return path.join(workspaceRoot, ...PIPELINES_FILE_REL_PATH.split('/'));
}

/**
 * Читает пайплайны проекта.
 *
 * Отсутствие файла - штатная ситуация: пайплайнов просто нет. Битый JSON
 * попадает в журнал, дерево при этом остаётся рабочим.
 *
 * @param workspaceRoot - Корень проекта
 * @returns Список пайплайнов
 */
export async function readPipelines(workspaceRoot: string): Promise<Pipeline[]> {
	try {
		const text = await fs.readFile(pipelinesFilePath(workspaceRoot), 'utf8');
		return normalizePipelines(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			log.warn(`Не удалось прочитать ${PIPELINES_FILE_REL_PATH}: ${error instanceof Error ? error.message : String(error)}`);
		}
		return [];
	}
}

/**
 * Записывает пайплайны проекта, создавая каталог при необходимости.
 *
 * @param workspaceRoot - Корень проекта
 * @param pipelines - Список пайплайнов
 */
export async function writePipelines(workspaceRoot: string, pipelines: Pipeline[]): Promise<void> {
	const fullPath = pipelinesFilePath(workspaceRoot);
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, serializePipelines(pipelines), 'utf8');
}

/**
 * Сериализует пайплайны в текст файла.
 *
 * @param pipelines - Список пайплайнов
 * @returns Текст JSON с ссылкой на схему
 */
export function serializePipelines(pipelines: Pipeline[]): string {
	const content: PipelinesFile & { $schema: string } = {
		$schema: PIPELINES_SCHEMA,
		version: PIPELINES_FILE_VERSION,
		pipelines: pipelines.map((pipeline) => ({
			...pipeline,
			nodes: pipeline.nodes.map(dropEmptyAction),
		})),
	};
	return `${JSON.stringify(content, null, 4)}\n`;
}

/**
 * Убирает пустые команду и строку оболочки.
 *
 * Схема знает список команд, и пустая строка в него не входит: незаполненный
 * блок сохраняется без поля действия и при чтении снова становится пустым.
 *
 * @param node - Узел графа
 * @returns Узел без пустых полей действия
 */
function dropEmptyAction(node: PipelineNode): PipelineNode {
	const copy = { ...node };
	if (copy.command === '') {
		delete copy.command;
	}
	if ((copy.script ?? '').trim() === '') {
		delete copy.script;
	}
	return copy;
}
