/**
 * Загрузка fat-JAR md-sparrow с GitHub Releases и portable JRE 21 (Eclipse Temurin).
 * @module mdSparrowBootstrap
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import extract from 'extract-zip';
import { globSync } from 'glob';
import { logger } from '../../shared/logger';
import {
	MD_SPARROW_DEFAULT_REPO,
	MD_SPARROW_JAR_REGEX,
	adoptiumBinaryUrl,
} from './mdSparrowConstants';

const execFileAsync = promisify(execFile);

export interface MdSparrowRuntime {
	/** Полный путь к исполняемому java */
	java: string;
	/** Полный путь к md-sparrow-*-all.jar */
	jarPath: string;
	/** Тег релиза (если скачан с GitHub) */
	releaseTag?: string;
}

interface GithubAsset {
	name: string;
	browser_download_url: string;
}

interface GithubRelease {
	tag_name: string;
	prerelease: boolean;
	assets: GithubAsset[];
}

function getInstallBase(context: vscode.ExtensionContext): string {
	return context.globalStorageUri.fsPath;
}

function githubHeaders(token: string): Record<string, string> {
	const h: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'vscode-1c-platform-tools-md-sparrow',
	};
	if (token) {
		h.Authorization = `Bearer ${token}`;
	}
	return h;
}

function rethrowNetworkError(url: string, err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	const hint =
		'Проверьте сеть и прокси. Либо выключите metadata.autoloadJar / metadata.autoloadJre и задайте metadata.jarFile (и при необходимости metadata.javaExecutable).';
	throw new Error(`Сеть: запрос не выполнен (${url}): ${msg}. ${hint}`);
}

function showMdSparrowStatus(message: string): vscode.Disposable {
	return vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
	let res: Response;
	try {
		res = await fetch(url, { headers });
	} catch (e) {
		rethrowNetworkError(url, e);
	}
	if (!res.ok) {
		const t = await res.text();
		throw new Error(`GitHub API ${res.status}: ${t.slice(0, 500)}`);
	}
	return res.json() as Promise<unknown>;
}

function parseMdSparrowRepo(): { owner: string; repo: string } {
	const parts = MD_SPARROW_DEFAULT_REPO.split('/').filter(Boolean);
	if (parts.length !== 2) {
		throw new Error(`MD_SPARROW_DEFAULT_REPO: ожидается owner/repo, получено: ${MD_SPARROW_DEFAULT_REPO}`);
	}
	return { owner: parts[0], repo: parts[1] };
}

/** Последний стабильный релиз GitHub (endpoint `releases/latest`). */
async function fetchLatestStableRelease(
	owner: string,
	repo: string,
	headers: Record<string, string>
): Promise<GithubRelease> {
	return (await fetchJson(
		`https://api.github.com/repos/${owner}/${repo}/releases/latest`,
		headers
	)) as GithubRelease;
}

function pickJarAsset(rel: GithubRelease): GithubAsset {
	const jar = rel.assets?.find((a) => MD_SPARROW_JAR_REGEX.test(a.name));
	if (!jar) {
		throw new Error(
			`В релизе ${rel.tag_name} нет артефакта md-sparrow-*-all.jar. Соберите shadowJar и опубликуйте релиз, либо укажите metadata.jarFile.`
		);
	}
	return jar;
}

/** Загрузка бинарника (GitHub / Adoptium) в файл */
async function streamDownload(url: string, dest: string, headers: Record<string, string>): Promise<void> {
	await fs.mkdir(path.dirname(dest), { recursive: true });
	let res: Response;
	try {
		res = await fetch(url, { headers, redirect: 'follow' });
	} catch (e) {
		rethrowNetworkError(url, e);
	}
	if (!res.ok || !res.body) {
		throw new Error(`Скачивание ${url}: HTTP ${res.status}`);
	}
	const nodeReadable = Readable.fromWeb(
		res.body as import('node:stream/web').ReadableStream
	);
	await pipeline(nodeReadable, createWriteStream(dest));
}

async function extractArchive(archivePath: string, outDir: string): Promise<void> {
	await fs.mkdir(outDir, { recursive: true });
	const lower = archivePath.toLowerCase();
	if (lower.endsWith('.zip')) {
		await extract(archivePath, { dir: outDir });
		return;
	}
	if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
		try {
			await execFileAsync('tar', ['-xzf', archivePath, '-C', outDir], {
				windowsHide: true,
			});
		} catch (e) {
			throw new Error(
				`Не удалось распаковать JRE (tar): ${e instanceof Error ? e.message : String(e)}`
			);
		}
		return;
	}
	throw new Error(`Неподдерживаемый архив JRE: ${archivePath}`);
}

function findJavaUnder(extractRoot: string): string | undefined {
	if (process.platform === 'win32') {
		const hits = globSync('**/bin/java.exe', {
			cwd: extractRoot,
			absolute: true,
			nocase: true,
		});
		return hits[0];
	}
	const hits = globSync('**/bin/java', { cwd: extractRoot, absolute: true });
	for (const p of hits) {
		try {
			if (fssync.statSync(p).isFile()) {
				return p;
			}
		} catch {
			/* skip */
		}
	}
	return undefined;
}

async function ensurePortableJre(
	baseDir: string,
	download: boolean,
	javaOverride: string
): Promise<string> {
	const trimmed = javaOverride.trim();
	if (trimmed) {
		return trimmed;
	}
	if (!download) {
		return 'java';
	}

	const jreRoot = path.join(baseDir, 'jre-temurin-21');
	const stamp = path.join(jreRoot, '.java-path');
	try {
		const prev = (await fs.readFile(stamp, 'utf8')).trim();
		if (prev && fssync.existsSync(prev)) {
			logger.debug(`md-sparrow JRE из кэша: ${prev}`);
			return prev;
		}
	} catch {
		/* fetch fresh */
	}

	logger.info('Загрузка portable JRE 21 (Eclipse Temurin) для md-sparrow…');
	const status = showMdSparrowStatus('md-sparrow: загружаем JRE 21...');
	try {
		await fs.rm(jreRoot, { recursive: true, force: true }).catch(() => undefined);
		await fs.mkdir(jreRoot, { recursive: true });

		const dlDir = path.join(jreRoot, '_dl');
		await fs.mkdir(dlDir, { recursive: true });
		const ext = process.platform === 'win32' ? '.zip' : '.tar.gz';
		const archivePath = path.join(dlDir, `temurin-jre-21${ext}`);

		const url = adoptiumBinaryUrl();
		await streamDownload(url, archivePath, { 'User-Agent': 'vscode-1c-platform-tools' });

		const unpackDir = path.join(jreRoot, 'unpack');
		await fs.mkdir(unpackDir, { recursive: true });
		await extractArchive(archivePath, unpackDir);
		await fs.rm(archivePath, { force: true }).catch(() => undefined);

		const javaExe = findJavaUnder(unpackDir);
		if (!javaExe) {
			throw new Error('После распаковки JRE не найден bin/java');
		}
		await fs.writeFile(stamp, javaExe, 'utf8');
		logger.info(`md-sparrow JRE готова: ${javaExe}`);
		return javaExe;
	} finally {
		status.dispose();
	}
}

async function ensureJar(
	baseDir: string,
	download: boolean,
	jarOverride: string,
	githubToken: string
): Promise<{ jarPath: string; tag?: string }> {
	const trimmed = jarOverride.trim();
	if (trimmed) {
		if (trimmed.includes('${')) {
			throw new Error('metadata.jarFile: укажите полный путь к md-sparrow-*-all.jar.');
		}
		if (!fssync.existsSync(trimmed)) {
			throw new Error(
				`metadata.jarFile не найден: ${trimmed}. Соберите артефакт: в каталоге md-sparrow выполните ./gradlew shadowJar (build/libs/md-sparrow-*-all.jar).`
			);
		}
		return { jarPath: trimmed };
	}
	if (!download) {
		throw new Error('Укажите metadata.jarFile или включите metadata.autoloadJar.');
	}

	const { owner, repo } = parseMdSparrowRepo();
	const jarDir = path.join(baseDir, 'md-sparrow');
	const stampPath = path.join(jarDir, '.jar-info.json');
	const headers = githubHeaders(githubToken);

	try {
		const raw = await fs.readFile(stampPath, 'utf8');
		const info = JSON.parse(raw) as { tag?: string; jarPath?: string };
		if (info.jarPath && fssync.existsSync(info.jarPath)) {
			logger.debug(`md-sparrow JAR из кэша: ${info.jarPath} (${info.tag})`);
			return { jarPath: info.jarPath, tag: info.tag };
		}
	} catch {
		/* download */
	}

	logger.info(`Загрузка md-sparrow с GitHub (${owner}/${repo})…`);
	const status = showMdSparrowStatus('md-sparrow: загружаем JAR...');
	try {
		const rel = await fetchLatestStableRelease(owner, repo, headers);
		const asset = pickJarAsset(rel);
		const destDir = path.join(jarDir, rel.tag_name.replace(/[^\w.-]+/g, '_'));
		await fs.mkdir(destDir, { recursive: true });
		const jarPath = path.join(destDir, asset.name);
		await streamDownload(asset.browser_download_url, jarPath, {
			...headers,
			Accept: 'application/octet-stream',
		});

		await fs.writeFile(
			stampPath,
			JSON.stringify({ tag: rel.tag_name, jarPath }, undefined, 0),
			'utf8'
		);
		logger.info(`md-sparrow JAR: ${jarPath} (${rel.tag_name})`);
		return { jarPath, tag: rel.tag_name };
	} finally {
		status.dispose();
	}
}

/**
 * Гарантирует наличие JRE и JAR согласно настройкам расширения.
 */
export async function ensureMdSparrowRuntime(context: vscode.ExtensionContext): Promise<MdSparrowRuntime> {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const download = cfg.get<boolean>('metadata.autoloadJar', true);
	const downloadJre = cfg.get<boolean>('metadata.autoloadJre', true);
	const token = process.env.PLATFORM_TOOLS_MD_SPARROW_GITHUB_TOKEN?.trim() ?? '';
	const jarPathSetting = cfg.get<string>('metadata.jarFile', '').trim();
	const javaPathSetting = cfg.get<string>('metadata.javaExecutable', '').trim();
	if (javaPathSetting.includes('${')) {
		throw new Error('metadata.javaExecutable: укажите полный путь к java или оставьте поле пустым.');
	}

	const base = getInstallBase(context);
	await fs.mkdir(base, { recursive: true });

	const java = await ensurePortableJre(base, downloadJre, javaPathSetting);
	const { jarPath, tag } = await ensureJar(base, download, jarPathSetting, token);

	return { java, jarPath, releaseTag: tag };
}

/**
 * Фоновая проверка наличия нового релиза md-sparrow.
 * При обнаружении более свежего тега тихо очищает кэш JAR и вызывает обратный вызов.
 * Молча завершается при недоступности сети или отсутствии кэшированного JAR.
 *
 * @param context Контекст расширения.
 * @param onUpdateApplied Вызывается после очистки кэша (например, для перезагрузки дерева).
 */
export function checkMdSparrowUpdateInBackground(
	context: vscode.ExtensionContext,
	onUpdateApplied: () => void
): void {
	void (async () => {
		try {
			const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
			if (cfg.get<string>('metadata.jarFile', '').trim()) {
				return;
			}
			if (!cfg.get<boolean>('metadata.autoloadJar', true)) {
				return;
			}

			const base = getInstallBase(context);
			const stampPath = path.join(base, 'md-sparrow', '.jar-info.json');
			let currentTag: string | undefined;
			try {
				const raw = await fs.readFile(stampPath, 'utf8');
				const info = JSON.parse(raw) as { tag?: string; jarPath?: string };
				currentTag = info.tag;
			} catch {
				return;
			}
			if (!currentTag) {
				return;
			}

			const token = process.env.PLATFORM_TOOLS_MD_SPARROW_GITHUB_TOKEN?.trim() ?? '';
			const { owner, repo } = parseMdSparrowRepo();
			let latest: GithubRelease;
			try {
				latest = await fetchLatestStableRelease(owner, repo, githubHeaders(token));
			} catch {
				return;
			}

			if (latest.tag_name === currentTag) {
				return;
			}

			logger.info(`md-sparrow: доступна новая версия ${latest.tag_name}, обновляем кэш.`);
			await clearMdSparrowDownloadCache(context, false);
			onUpdateApplied();
		} catch {
			/* фоновая проверка — ошибки не показываем */
		}
	})();
}

/**
 * Сброс кэша JAR (и при необходимости JRE) — следующий вызов ensure скачает заново.
 */
export async function clearMdSparrowDownloadCache(
	context: vscode.ExtensionContext,
	includeJre: boolean
): Promise<void> {
	const base = getInstallBase(context);
	const jarDir = path.join(base, 'md-sparrow');
	await fs.rm(jarDir, { recursive: true, force: true }).catch(() => undefined);
	if (includeJre) {
		await fs.rm(path.join(base, 'jre-temurin-21'), { recursive: true, force: true }).catch(() => undefined);
	}
}
