/**
 * Загрузка JSON-дерева метаданных из md-sparrow (`project-metadata-tree`).
 * @module metadataTreeService
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { clearMdSparrowJarCache, ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { isMdSparrowUnknownCommandError, MdSparrowOutdatedError } from './mdSparrowErrors';
import { logger } from '../../shared/logger';
import { runMdSparrow } from './mdSparrowRunner';

const log = logger.scope('metadata');

/** Контракт с md-sparrow {@link io.github.yellowhammer.designerxml.cf.ProjectMetadataTreeDto}. */
export interface ProjectMetadataTreeDto {
	readonly projectRoot: string;
	readonly mainSchemaVersion: string;
	readonly mainSchemaVersionFlag: string;
	readonly sources: MetadataSourceDto[];
}

export interface MetadataSourceDto {
	readonly kind: string;
	readonly id: string;
	readonly label: string;
	readonly configurationXmlRelativePath: string;
	readonly metadataRootRelativePath: string;
	readonly groups: MetadataGroupDto[];
}

export interface MetadataSubgroupDto {
	readonly id: string;
	readonly label: string;
	readonly iconHint: string;
	readonly items: MetadataItemDto[];
}

export interface MetadataGroupDto {
	readonly id: string;
	readonly label: string;
	readonly iconHint: string;
	readonly items: MetadataItemDto[];
	readonly subgroups?: MetadataSubgroupDto[];
}

export interface MetadataItemDto {
	readonly objectType: string;
	readonly name: string;
	readonly relativePath: string;
}

/**
 * Промис с деревом метаданных корня workspace (подпроцесс md-sparrow).
 */
export async function loadProjectMetadataTree(
	context: vscode.ExtensionContext,
	projectRoot: string
): Promise<ProjectMetadataTreeDto> {
	const abs = path.normalize(path.resolve(projectRoot));
	const res = await runProjectMetadataTreeWithRepair(context, abs);
	
	if (res.exitCode !== 0) {
		const errText = res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`;
		if (isMdSparrowUnknownCommandError(res.stderr, res.stdout)) {
			throw new MdSparrowOutdatedError();
		}
		throw new Error(errText);
	}
	const line = res.stdout.trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(line) as unknown;
	} catch {
		throw new Error(`Ожидался JSON, получено: ${line.slice(0, 200)}`);
	}
	if (!isProjectMetadataTreeDto(parsed)) {
		log.error('дерево: неожиданная форма JSON ответа md-sparrow');
		throw new Error('Не удалось разобрать ответ md-sparrow.');
	}
	return parsed;
}

async function runProjectMetadataTreeWithRepair(context: vscode.ExtensionContext, abs: string) {
	const initialRes = await runMdSparrow(await ensureMdSparrowRuntime(context), ['project-metadata-tree', abs], {
		cwd: abs,
	});
	if (initialRes.exitCode !== 0 && shouldRepairJarAndRetry(initialRes.stderr, initialRes.stdout)) {
		log.warn('ошибка загрузки классов md-sparrow — очищаем кэш JAR и повторяем запуск');
		await clearMdSparrowJarCache(context);
		const repairedRuntime = await ensureMdSparrowRuntime(context);
		return runMdSparrow(repairedRuntime, ['project-metadata-tree', abs], {
			cwd: abs,
		});
	}
	return initialRes;
}

function shouldRepairJarAndRetry(stderr: string, stdout: string): boolean {
	const text = `${stderr}\n${stdout}`;
	return /NoClassDefFoundError|ClassNotFoundException/i.test(text);
}

function isProjectMetadataTreeDto(v: unknown): v is ProjectMetadataTreeDto {
	if (v === null || typeof v !== 'object') {
		return false;
	}
	const o = v as Record<string, unknown>;
	return (
		typeof o.projectRoot === 'string' &&
		typeof o.mainSchemaVersion === 'string' &&
		typeof o.mainSchemaVersionFlag === 'string' &&
		Array.isArray(o.sources)
	);
}
