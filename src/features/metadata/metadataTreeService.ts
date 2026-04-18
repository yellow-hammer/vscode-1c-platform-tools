/**
 * Загрузка JSON-дерева метаданных из md-sparrow (`project-metadata-tree`).
 * @module metadataTreeService
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { clearMdSparrowDownloadCache, ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { logger } from '../../shared/logger';
import { runMdSparrow } from './mdSparrowRunner';

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
	const runtime = await ensureMdSparrowRuntime(context);
	let res = await runMdSparrow(runtime, ['project-metadata-tree', abs], {
		cwd: abs,
	});
	if (res.exitCode !== 0 && shouldRepairJarAndRetry(res.stderr, res.stdout)) {
		logger.warn('md-sparrow: ошибка загрузки классов, очищаем кэш JAR и повторяем запуск.');
		await clearMdSparrowDownloadCache(context, false);
		const repairedRuntime = await ensureMdSparrowRuntime(context);
		res = await runMdSparrow(repairedRuntime, ['project-metadata-tree', abs], {
			cwd: abs,
		});
	}
	if (res.exitCode !== 0) {
		const errText = res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`;
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
		logger.error(`metadata tree JSON: неожиданная форма`);
		throw new Error('Не удалось разобрать ответ md-sparrow.');
	}
	return parsed;
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
