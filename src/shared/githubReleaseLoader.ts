/**
 * Единый загрузчик внешних компонентов из GitHub Releases (md-sparrow JAR, onec-debug-adapter и др.).
 * Кэширует артефакт в globalStorage, отслеживает выход новых релизов и качает свежий.
 * @module githubReleaseLoader
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as vscode from 'vscode';
import extract from 'extract-zip';
import { logger } from './logger';

const log = logger.scope('releases');

const execFileAsync = promisify(execFile);
const NO_INDENTATION = 0;
/** Не опрашивать GitHub чаще, чем раз в это время (как в reference 1c-syntax/vsc-language-1c-bsl — 8 мин). */
const UPDATE_CHECK_THROTTLE_MS = 8 * 60 * 1000;

export interface GithubAsset {
	name: string;
	browser_download_url: string;
}

export interface GithubRelease {
	tag_name: string;
	prerelease: boolean;
	assets: GithubAsset[];
}

/** Описание компонента, загружаемого из GitHub Releases. */
export interface ReleaseComponentSpec {
	/** Репозиторий в форме `owner/repo`. */
	repoSlug: string;
	/** Подкаталог кэша в globalStorage (например `md-sparrow`, `onec-debug-adapter`). */
	cacheSubdir: string;
	/** Имя файла-штампа с информацией о загрузке. */
	stampName: string;
	/** Регэксп имени нужного asset'а релиза. */
	assetRegex: RegExp;
	/** Человекочитаемое имя для статус-бара/логов. */
	label: string;
	/** Распаковать архив (true) или сохранить файл как есть (false). */
	extract: boolean;
}

/** Результат загрузки: путь к файлу (extract=false) или к каталогу распаковки (extract=true). */
export interface EnsuredComponent {
	tag: string;
	assetPath: string;
}

interface StampInfo {
	tag?: string;
	assetPath?: string;
	/** Время последней проверки обновления (ms) — троттлинг фоновых опросов GitHub. */
	lastCheckMs?: number;
	/** Легаси-поле прежнего загрузчика md-sparrow. */
	jarPath?: string;
}

/**
 * Строго ли тег {@code candidate} новее {@code current} (теги стабильных релизов вида `v1.2.3`/`1.2.3`).
 * Сравнение посегментно по числам; нечисловые теги — по строковому неравенству (консервативно).
 */
export function isNewerTag(candidate: string, current: string): boolean {
	const parts = (t: string): number[] =>
		t
			.replace(/^[vV]/, '')
			.split(/[.\-+]/)
			.map((s) => Number.parseInt(s, 10))
			.filter((n) => !Number.isNaN(n));
	const a = parts(candidate);
	const b = parts(current);
	if (a.length === 0 && b.length === 0) {
		return candidate !== current;
	}
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x !== y) {
			return x > y;
		}
	}
	return false;
}

export function githubHeaders(token: string): Record<string, string> {
	const h: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'vscode-1c-platform-tools',
	};
	if (token) {
		h.Authorization = `Bearer ${token}`;
	}
	return h;
}

/**
 * Базовый каталог установки внешних компонентов (общий для md-sparrow, DAP и др.).
 */
export function installBaseDir(context: vscode.ExtensionContext): string {
	return context.globalStorageUri.fsPath;
}

/**
 * Единый источник GitHub-токена для всех загружаемых компонентов: сначала общий
 * {@code PLATFORM_TOOLS_GITHUB_TOKEN}, затем легаси {@code PLATFORM_TOOLS_MD_SPARROW_GITHUB_TOKEN};
 * иначе {@code ''} (анонимный доступ). Пустые/пробельные значения пропускаются.
 * Токен нужен лишь против лимита GitHub (60→5000 запросов/час) и для приватных репозиториев.
 */
export function resolveGithubToken(): string {
	const candidates = [
		process.env.PLATFORM_TOOLS_GITHUB_TOKEN,
		process.env.PLATFORM_TOOLS_MD_SPARROW_GITHUB_TOKEN,
	];
	for (const candidate of candidates) {
		const token = candidate?.trim();
		if (token) {
			return token;
		}
	}
	return '';
}

export function parseRepoSlug(slug: string): { owner: string; repo: string } {
	const parts = slug.split('/').filter(Boolean);
	if (parts.length !== 2) {
		throw new Error(`Ожидается owner/repo, получено: ${slug}`);
	}
	return { owner: parts[0], repo: parts[1] };
}

function rethrowNetworkError(url: string, err: unknown): never {
	const msg = err instanceof Error ? err.message : String(err);
	throw new Error(`Сеть: запрос не выполнен (${url}): ${msg}. Проверьте сеть и прокси.`);
}

export async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
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

export async function fetchLatestStableRelease(
	owner: string,
	repo: string,
	headers: Record<string, string>
): Promise<GithubRelease> {
	return (await fetchJson(
		`https://api.github.com/repos/${owner}/${repo}/releases/latest`,
		headers
	)) as GithubRelease;
}

export async function streamDownload(url: string, dest: string, headers: Record<string, string>): Promise<void> {
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
	const nodeReadable = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
	await pipeline(nodeReadable, createWriteStream(dest));
}

export async function extractArchive(archivePath: string, outDir: string): Promise<void> {
	await fs.mkdir(outDir, { recursive: true });
	const lower = archivePath.toLowerCase();
	if (lower.endsWith('.zip')) {
		await extract(archivePath, { dir: outDir });
		return;
	}
	if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
		try {
			await execFileAsync('tar', ['-xzf', archivePath, '-C', outDir], { windowsHide: true });
		} catch (e) {
			throw new Error(`Не удалось распаковать архив (tar): ${e instanceof Error ? e.message : String(e)}`);
		}
		return;
	}
	throw new Error(`Неподдерживаемый архив: ${archivePath}`);
}

export function showStatus(message: string): vscode.Disposable {
	return vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
}

function pickAsset(rel: GithubRelease, spec: ReleaseComponentSpec): GithubAsset {
	const asset = rel.assets?.find((a) => spec.assetRegex.test(a.name));
	if (!asset) {
		throw new Error(
			`В релизе ${rel.tag_name} (${spec.repoSlug}) нет артефакта ${spec.assetRegex}. Опубликуйте релиз с нужным asset'ом.`
		);
	}
	return asset;
}

function stampPathOf(baseDir: string, spec: ReleaseComponentSpec): string {
	return path.join(baseDir, spec.cacheSubdir, spec.stampName);
}

async function readStamp(baseDir: string, spec: ReleaseComponentSpec): Promise<StampInfo | undefined> {
	try {
		const raw = await fs.readFile(stampPathOf(baseDir, spec), 'utf8');
		return JSON.parse(raw) as StampInfo;
	} catch {
		return undefined;
	}
}

async function writeStamp(baseDir: string, spec: ReleaseComponentSpec, info: StampInfo): Promise<void> {
	const stampPath = stampPathOf(baseDir, spec);
	await fs.mkdir(path.dirname(stampPath), { recursive: true });
	await fs.writeFile(stampPath, JSON.stringify(info, undefined, NO_INDENTATION), 'utf8');
}

/**
 * Гарантирует наличие компонента из GitHub Releases: отдаёт кэш, иначе качает последний стабильный релиз.
 *
 * @param baseDir каталог globalStorage расширения
 * @param spec описание компонента
 * @param token GitHub-токен (может быть пустым)
 */
export async function ensureReleaseComponent(
	baseDir: string,
	spec: ReleaseComponentSpec,
	token: string
): Promise<EnsuredComponent> {
	const cached = await readStamp(baseDir, spec);
	const cachedPath = cached?.assetPath ?? cached?.jarPath;
	if (cached?.tag && cachedPath && fssync.existsSync(cachedPath)) {
		log.debug(`${spec.label} из кэша: ${cachedPath} (${cached.tag})`);
		return { tag: cached.tag, assetPath: cachedPath };
	}

	const { owner, repo } = parseRepoSlug(spec.repoSlug);
	const headers = githubHeaders(token);
	log.info(`Загрузка ${spec.label} с GitHub (${owner}/${repo})…`);
	const status = showStatus(`${spec.label}: загрузка…`);
	try {
		const rel = await fetchLatestStableRelease(owner, repo, headers);
		const asset = pickAsset(rel, spec);
		const destDir = path.join(baseDir, spec.cacheSubdir, rel.tag_name.replace(/[^\w.-]+/g, '_'));
		await fs.rm(destDir, { recursive: true, force: true }).catch(() => undefined);
		await fs.mkdir(destDir, { recursive: true });

		let assetPath: string;
		if (spec.extract) {
			const archivePath = path.join(destDir, asset.name);
			await streamDownload(asset.browser_download_url, archivePath, {
				...headers,
				Accept: 'application/octet-stream',
			});
			await extractArchive(archivePath, destDir);
			await fs.rm(archivePath, { force: true }).catch(() => undefined);
			assetPath = destDir;
		} else {
			assetPath = path.join(destDir, asset.name);
			await streamDownload(asset.browser_download_url, assetPath, {
				...headers,
				Accept: 'application/octet-stream',
			});
		}

		await writeStamp(baseDir, spec, { tag: rel.tag_name, assetPath, lastCheckMs: Date.now() });
		log.info(`${spec.label}: ${assetPath} (${rel.tag_name})`);
		return { tag: rel.tag_name, assetPath };
	} finally {
		status.dispose();
	}
}

/** Сброс кэша компонента — следующий {@link ensureReleaseComponent} скачает заново. */
export async function clearReleaseCache(baseDir: string, spec: ReleaseComponentSpec): Promise<void> {
	await fs.rm(path.join(baseDir, spec.cacheSubdir), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Фоновая проверка нового релиза (стабильного — endpoint `releases/latest`, без выбора prerelease).
 * Опрос троттлится ({@link UPDATE_CHECK_THROTTLE_MS}); обновление применяется только если тег СТРОГО новее
 * ({@link isNewerTag}) — чистит кэш и зовёт onUpdate. Молча завершается при недоступности сети/кэша.
 */
export function checkReleaseUpdateInBackground(
	baseDir: string,
	spec: ReleaseComponentSpec,
	token: string,
	onUpdate: () => void
): void {
	void (async () => {
		try {
			const cached = await readStamp(baseDir, spec);
			if (!cached?.tag) {
				return;
			}
			if (cached.lastCheckMs && Date.now() - cached.lastCheckMs < UPDATE_CHECK_THROTTLE_MS) {
				return;
			}
			const { owner, repo } = parseRepoSlug(spec.repoSlug);
			let latest: GithubRelease;
			try {
				latest = await fetchLatestStableRelease(owner, repo, githubHeaders(token));
			} catch {
				return;
			}
			if (!isNewerTag(latest.tag_name, cached.tag)) {
				await writeStamp(baseDir, spec, { ...cached, lastCheckMs: Date.now() });
				return;
			}
			log.info(`${spec.label}: доступна новая версия ${latest.tag_name} (было ${cached.tag}), обновляем кэш.`);
			await clearReleaseCache(baseDir, spec);
			onUpdate();
		} catch {
			/* фоновая проверка — ошибки не показываем */
		}
	})();
}
