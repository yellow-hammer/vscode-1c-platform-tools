/**
 * Загрузка ER-графа метаданных проекта через md-sparrow CLI ({@code cf-md-graph}) и его кэширование.
 *
 * Кэш — JSON-файл в workspace storage VS Code (не в дереве проекта). Ключ — SHA-256 от содержимого
 * списка xml-файлов src/cf, src/cfe и внешних артефактов; при изменении хотя бы одного файла кэш
 * инвалидируется.
 *
 * @module er/erGraphService
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../../shared/logger';
import { ensureMdSparrowRuntime } from '../mdSparrowBootstrap';
import { runMdSparrow } from '../mdSparrowRunner';
import type { ErGraph, ErNode, ErEdge } from './erTypes';

/** Версия формата кэша. Менять при несовместимых изменениях контракта. */
const CACHE_FORMAT_VERSION = 1;

interface CacheEntryDto {
	readonly version: number;
	readonly fingerprint: string;
	readonly graph: ErGraph;
}

export interface ErGraphLoadOptions {
	readonly progress?: vscode.Progress<{ message?: string; increment?: number }>;
	readonly token?: vscode.CancellationToken;
}

export interface ErGraphLoadResult {
	readonly graph: ErGraph;
	readonly fromCache: boolean;
	readonly fingerprint: string;
}

/** Возвращает путь к файлу кэша во workspace storage VS Code. */
function resolveCacheFile(context: vscode.ExtensionContext): string {
	const storageUri = context.storageUri ?? context.globalStorageUri;
	return path.join(storageUri.fsPath, 'er-cache', 'er-graph.json');
}

/** Список «интересных» каталогов: src/cf, src/cfe/*, src/erf/*, src/epf/*. */
async function collectGraphRoots(workspaceRoot: string): Promise<string[]> {
	const roots: string[] = [];
	const cfRoot = path.join(workspaceRoot, 'src', 'cf');
	if (fssync.existsSync(cfRoot)) {
		roots.push(cfRoot);
	}
	const subRoots = ['cfe', 'erf', 'epf'];
	for (const seg of subRoots) {
		const dir = path.join(workspaceRoot, 'src', seg);
		if (!fssync.existsSync(dir)) {
			continue;
		}
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					roots.push(path.join(dir, entry.name));
				}
			}
		} catch {
			/* skip */
		}
	}
	return roots;
}

/** Хэширует список xml-файлов, время их модификации и путь к JAR. */
async function computeFingerprint(workspaceRoot: string, jarIdentity: string): Promise<string> {
	const roots = await collectGraphRoots(workspaceRoot);
	const hash = createHash('sha256');
	hash.update(`v${CACHE_FORMAT_VERSION}`);
	hash.update(jarIdentity);
	for (const root of roots) {
		await walkXml(root, async (absPath) => {
			try {
				const stat = await fs.stat(absPath);
				const rel = path.relative(workspaceRoot, absPath).replaceAll('\\', '/');
				hash.update(rel);
				hash.update(String(stat.size));
				hash.update(stat.mtime.toISOString());
			} catch {
				/* skip */
			}
		});
	}
	return hash.digest('hex');
}

async function walkXml(dir: string, onFile: (abs: string) => Promise<void>): Promise<void> {
	let entries: fssync.Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	const sorted = entries.slice().sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of sorted) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await walkXml(abs, onFile);
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
			await onFile(abs);
		}
	}
}

async function readCache(file: string, fingerprint: string): Promise<ErGraph | undefined> {
	try {
		const raw = await fs.readFile(file, 'utf8');
		const parsed = JSON.parse(raw) as CacheEntryDto;
		if (
			parsed &&
			parsed.version === CACHE_FORMAT_VERSION &&
			parsed.fingerprint === fingerprint &&
			parsed.graph &&
			Array.isArray(parsed.graph.nodes) &&
			Array.isArray(parsed.graph.edges)
		) {
			return parsed.graph;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

async function writeCache(file: string, fingerprint: string, graph: ErGraph): Promise<void> {
	try {
		await fs.mkdir(path.dirname(file), { recursive: true });
		const payload: CacheEntryDto = {
			version: CACHE_FORMAT_VERSION,
			fingerprint,
			graph,
		};
		await fs.writeFile(file, JSON.stringify(payload), 'utf8');
	} catch (e) {
		logger.warn(`ER cache: не удалось записать ${file}: ${e instanceof Error ? e.message : String(e)}`);
	}
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((it): it is string => typeof it === 'string');
}

function parseGraph(raw: string): ErGraph {
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Ожидался JSON-объект графа.');
	}
	const nodes: ErNode[] = Array.isArray(parsed.nodes)
		? parsed.nodes.map((n) => {
				const o = (n ?? {}) as Record<string, unknown>;
				return {
					key: String(o.key ?? ''),
					objectType: String(o.objectType ?? ''),
					name: String(o.name ?? ''),
					synonymRu: String(o.synonymRu ?? ''),
					sourceId: String(o.sourceId ?? ''),
					relativePath: String(o.relativePath ?? ''),
					subsystemKeys: normalizeStringArray(o.subsystemKeys),
					partial: Boolean(o.partial),
				} satisfies ErNode;
			})
		: [];
	const edges: ErEdge[] = Array.isArray(parsed.edges)
		? parsed.edges.map((e) => {
				const o = (e ?? {}) as Record<string, unknown>;
				return {
					sourceKey: String(o.sourceKey ?? ''),
					targetKey: String(o.targetKey ?? ''),
					kind: String(o.kind ?? ''),
					cardinality: String(o.cardinality ?? '0..*'),
					via: normalizeStringArray(o.via),
				} satisfies ErEdge;
			})
		: [];
	const graph: ErGraph = {
		projectRoot: String(parsed.projectRoot ?? ''),
		mainSchemaVersion: String(parsed.mainSchemaVersion ?? ''),
		mainSchemaVersionFlag: String(parsed.mainSchemaVersionFlag ?? ''),
		nodeCount: typeof parsed.nodeCount === 'number' ? parsed.nodeCount : nodes.length,
		edgeCount: typeof parsed.edgeCount === 'number' ? parsed.edgeCount : edges.length,
		nodes,
		edges,
	};
	return graph;
}

/**
 * Загружает граф метаданных через md-sparrow с использованием кэша по контенту.
 */
export async function loadErGraph(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	options: ErGraphLoadOptions = {}
): Promise<ErGraphLoadResult> {
	const cacheFile = resolveCacheFile(context);
	const runtime = await ensureMdSparrowRuntime(context);
	const jarIdentity = runtime.releaseTag ?? runtime.jarPath;
	options.progress?.report({ message: 'ER: вычисление отпечатка проекта' });
	const fingerprint = await computeFingerprint(workspaceRoot, jarIdentity);
	const cached = await readCache(cacheFile, fingerprint);
	if (cached) {
		logger.debug(`ER cache hit: ${cacheFile}`);
		return { graph: cached, fromCache: true, fingerprint };
	}
	options.progress?.report({ message: 'ER: построение графа (md-sparrow cf-md-graph)' });
	const res = await runMdSparrow(runtime, ['cf-md-graph', workspaceRoot], {
		cwd: workspaceRoot,
		token: options.token,
	});
	if (res.exitCode !== 0) {
		const errText = res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`;
		throw new Error(`md-sparrow cf-md-graph: ${errText}`);
	}
	const stdout = res.stdout.trim();
	if (!stdout.startsWith('{')) {
		throw new Error(`Ожидался JSON-граф, получено: ${stdout.slice(0, 200)}`);
	}
	let graph: ErGraph;
	try {
		graph = parseGraph(stdout);
	} catch (e) {
		throw new Error(`Не удалось разобрать JSON графа: ${e instanceof Error ? e.message : String(e)}`);
	}
	await writeCache(cacheFile, fingerprint, graph);
	return { graph, fromCache: false, fingerprint };
}
