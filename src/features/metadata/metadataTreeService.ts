/**
 * Загрузка JSON-дерева метаданных из md-sparrow (`project-metadata-tree`).
 * @module metadataTreeService
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { clearMdSparrowJarCache, ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { isMdSparrowUnknownCommandError, MdSparrowOutdatedError } from './mdSparrowErrors';
import { logger } from '../../shared/logger';
import { detectedSourceDirs } from '../../shared/sourcePaths';
import { runMdSparrowParamsRead, supportEnabled, type MdSparrowParams } from './mdSparrowParams';
import { cacheFilePath, readCachedEntry, runtimeSalt, sourceFingerprint, writeCached } from './mdSparrowCache';

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
	/** Правило поддержки самого корня конфигурации: locked либо editable. */
	readonly support?: string;
	/** Возможность изменения включена конфигуратором: без неё правила не правятся. */
	readonly supportEditingEnabled?: boolean;
	/** Отпечаток правил поддержки на момент чтения дерева. */
	readonly supportGeneration?: string;
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

/** Что открывать по клику: контракт {@code MdObjectOpen.Target} из md-sparrow. */
export type MetadataOpenAction = 'form' | 'module' | 'properties';

export interface MetadataItemOpenDto {
	readonly action: MetadataOpenAction;
	readonly relativePath?: string;
	readonly moduleRelativePath?: string;
}

export interface MetadataItemDto {
	readonly objectType: string;
	readonly name: string;
	readonly relativePath: string;
	/** Принадлежность объекта расширения: `Adopted` у заимствованного; у конфигурации пусто. */
	readonly objectBelonging?: string;
	/** Поддержка поставщика: locked - изменение запрещено, editable - разрешено. */
	readonly support?: string;
	/** Необязательная цель открытия из md-sparrow; клик в IDE работает и без неё. */
	readonly open?: MetadataItemOpenDto;
}

/** Абсолютные пути цели открытия: relativePath из дерева склеивается с корнем проекта. */
export interface MetadataObjectOpen {
	readonly action: MetadataOpenAction;
	readonly fsPath?: string;
	readonly moduleFsPath?: string;
}

/**
 * Переводит цель открытия из JSON дерева в абсолютные пути.
 *
 * @param dto Поле {@code open} объекта из md-sparrow.
 * @param workspaceRoot Корень проекта.
 * @returns Цель с абсолютными путями или {@code undefined}, если открывать нечего.
 */
export function resolveMetadataOpen(
	dto: MetadataItemOpenDto | undefined,
	workspaceRoot: string
): MetadataObjectOpen | undefined {
	if (!dto) {
		return undefined;
	}
	if (dto.action === 'properties') {
		return { action: 'properties' };
	}
	if ((dto.action !== 'form' && dto.action !== 'module') || !dto.relativePath) {
		return undefined;
	}
	return {
		action: dto.action,
		fsPath: path.join(workspaceRoot, dto.relativePath),
		moduleFsPath: dto.moduleRelativePath ? path.join(workspaceRoot, dto.moduleRelativePath) : undefined,
	};
}

/**
 * Дерево метаданных корня рабочей области: из кэша, пока исходный код не менялся, иначе от md-sparrow.
 */
export async function loadProjectMetadataTree(
	context: vscode.ExtensionContext,
	projectRoot: string
): Promise<ProjectMetadataTreeDto> {
	const abs = path.normalize(path.resolve(projectRoot));
	const runtime = await ensureMdSparrowRuntime(context);
	const cacheFile = cacheFilePath(context, 'project-metadata-tree', abs);
	const salt = async () => [
		await runtimeSalt(runtime),
		`поддержка:${supportEnabled()}`,
		JSON.stringify(await projectMetadataTreeParams(abs)),
	];
	const entry = await readCachedEntry(cacheFile, isProjectMetadataTreeDto);
	if (entry) {
		if ((await sourceFingerprint(abs, await salt())) === entry.fingerprint) {
			log.debug('дерево метаданных из кэша');
			return entry.payload;
		}
	}
	// Отпечаток берётся одновременно с чтением: обход не задерживает первый ответ,
	// а правка во время чтения меняет отпечаток и кэш не переживёт её
	const [res, fingerprint] = await Promise.all([
		runProjectMetadataTreeWithRepair(context, abs),
		salt().then((items) => sourceFingerprint(abs, items)),
	]);
	
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
	await writeCached(cacheFile, fingerprint, parsed);
	return parsed;
}

/** Параметры project-metadata-tree с каталогами исходного кода из раскладки. */
export async function projectMetadataTreeParams(projectRootAbs: string): Promise<MdSparrowParams> {
	const dirs = await detectedSourceDirs(projectRootAbs);
	return {
		op: 'project-metadata-tree',
		projectRoot: projectRootAbs,
		cfDir: dirs.cf,
		cfeDir: dirs.cfe,
		epfDir: dirs.epf,
		erfDir: dirs.erf,
		cfeDirs: dirs.cfeDirs,
		epfDirs: dirs.epfDirs,
		erfDirs: dirs.erfDirs,
	};
}

async function runProjectMetadataTreeWithRepair(context: vscode.ExtensionContext, abs: string) {
	const initialRes = await runMdSparrowParamsRead(
		await ensureMdSparrowRuntime(context),
		await projectMetadataTreeParams(abs),
		{ cwd: abs }
	);
	if (initialRes.exitCode !== 0 && shouldRepairJarAndRetry(initialRes.stderr, initialRes.stdout)) {
		log.warn('ошибка загрузки классов md-sparrow: очищаем кэш JAR и повторяем запуск');
		await clearMdSparrowJarCache(context);
		const repairedRuntime = await ensureMdSparrowRuntime(context);
		return runMdSparrowParamsRead(repairedRuntime, await projectMetadataTreeParams(abs), {
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
