/**
 * Загрузка fat-JAR md-sparrow с GitHub Releases (через общий {@link githubReleaseLoader})
 * и portable JRE 21 (Eclipse Temurin).
 * @module mdSparrowBootstrap
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import { globSync } from 'glob';
import { logger } from '../../shared/logger';
import {
	type ReleaseComponentSpec,
	cachedReleaseTag,
	checkReleaseUpdateInBackground,
	clearReleaseCache,
	ensureReleaseComponent,
	extractArchive,
	installBaseDir,
	resolveGithubToken,
	showStatus,
	streamDownload,
} from '../../shared/githubReleaseLoader';
import {
	MD_SPARROW_DEFAULT_REPO,
	MD_SPARROW_JAR_REGEX,
	adoptiumBinaryUrl,
} from './mdSparrowConstants';

const log = logger.scope('md-sparrow');

export interface MdSparrowRuntime {
	/** Полный путь к исполняемому java */
	java: string;
	/** Полный путь к md-sparrow-*-all.jar */
	jarPath: string;
	/** Тег релиза (если скачан с GitHub) */
	releaseTag?: string;
}

const MD_SPARROW_SPEC: ReleaseComponentSpec = {
	repoSlug: MD_SPARROW_DEFAULT_REPO,
	cacheSubdir: 'md-sparrow',
	stampName: '.jar-info.json',
	assetRegex: MD_SPARROW_JAR_REGEX,
	label: 'md-sparrow',
	extract: false,
};

function findJavaUnder(extractRoot: string): string | undefined {
	if (process.platform === 'win32') {
		const hits = globSync('**/bin/java.exe', { cwd: extractRoot, absolute: true, nocase: true });
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

async function ensurePortableJre(baseDir: string, download: boolean, javaOverride: string): Promise<string> {
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
			log.debug(`JRE из кэша: ${prev}`);
			return prev;
		}
	} catch {
		/* fetch fresh */
	}

	log.info('загрузка portable JRE 21 (Eclipse Temurin)…');
	const status = showStatus('md-sparrow: загружаем JRE 21...');
	try {
		await fs.rm(jreRoot, { recursive: true, force: true }).catch(() => undefined);
		await fs.mkdir(jreRoot, { recursive: true });

		const dlDir = path.join(jreRoot, '_dl');
		await fs.mkdir(dlDir, { recursive: true });
		const ext = process.platform === 'win32' ? '.zip' : '.tar.gz';
		const archivePath = path.join(dlDir, `temurin-jre-21${ext}`);

		await streamDownload(adoptiumBinaryUrl(), archivePath, { 'User-Agent': 'vscode-1c-platform-tools' });

		const unpackDir = path.join(jreRoot, 'unpack');
		await fs.mkdir(unpackDir, { recursive: true });
		await extractArchive(archivePath, unpackDir);
		await fs.rm(archivePath, { force: true }).catch(() => undefined);

		const javaExe = findJavaUnder(unpackDir);
		if (!javaExe) {
			throw new Error('После распаковки JRE не найден bin/java');
		}
		await fs.writeFile(stamp, javaExe, 'utf8');
		log.info(`JRE готова: ${javaExe}`);
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
			throw new Error('components.metadataJarFile: укажите полный путь к md-sparrow-*-all.jar.');
		}
		if (!fssync.existsSync(trimmed)) {
			throw new Error(
				`components.metadataJarFile не найден: ${trimmed}. Соберите артефакт: в каталоге md-sparrow выполните ./gradlew shadowJar (build/libs/md-sparrow-*-all.jar).`
			);
		}
		return { jarPath: trimmed };
	}
	if (!download) {
		throw new Error('Укажите components.metadataJarFile или включите components.metadataJarAutoload.');
	}

	const ensured = await ensureReleaseComponent(baseDir, MD_SPARROW_SPEC, githubToken);
	return { jarPath: ensured.assetPath, tag: ensured.tag };
}

/**
 * Гарантирует наличие JRE и JAR согласно настройкам расширения.
 */
export async function ensureMdSparrowRuntime(context: vscode.ExtensionContext): Promise<MdSparrowRuntime> {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const download = cfg.get<boolean>('components.metadataJarAutoload', true);
	const downloadJre = cfg.get<boolean>('components.jreAutoload', true);
	const jarPathSetting = cfg.get<string>('components.metadataJarFile', '').trim();
	const javaPathSetting = cfg.get<string>('components.javaExecutable', '').trim();
	if (javaPathSetting.includes('${')) {
		throw new Error('components.javaExecutable: укажите полный путь к java или оставьте поле пустым.');
	}

	const base = installBaseDir(context);
	await fs.mkdir(base, { recursive: true });

	const java = await ensurePortableJre(base, downloadJre, javaPathSetting);
	const { jarPath, tag } = await ensureJar(base, download, jarPathSetting, resolveGithubToken());

	return { java, jarPath, releaseTag: tag };
}

/**
 * Фоновая проверка наличия нового релиза md-sparrow; при обнаружении чистит кэш JAR и зовёт колбэк.
 */
export function checkMdSparrowUpdateInBackground(
	context: vscode.ExtensionContext,
	onUpdateApplied: () => void
): void {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	if (cfg.get<string>('components.metadataJarFile', '').trim()) {
		return;
	}
	if (!cfg.get<boolean>('components.metadataJarAutoload', true)) {
		return;
	}
	checkReleaseUpdateInBackground(installBaseDir(context), MD_SPARROW_SPEC, resolveGithubToken(), onUpdateApplied);
}

/** Тег релиза md-sparrow в кэше; undefined — не загружен. */
export async function cachedMdSparrowTag(context: vscode.ExtensionContext): Promise<string | undefined> {
	return cachedReleaseTag(installBaseDir(context), MD_SPARROW_SPEC);
}

/** Сброс кэша JAR — следующий вызов ensure скачает заново. */
export async function clearMdSparrowJarCache(context: vscode.ExtensionContext): Promise<void> {
	await clearReleaseCache(installBaseDir(context), MD_SPARROW_SPEC);
}

/** Есть ли в кэше portable JRE. */
export function portableJreCached(context: vscode.ExtensionContext): boolean {
	return fssync.existsSync(path.join(installBaseDir(context), 'jre-temurin-21', '.java-path'));
}

/** Сброс кэша portable JRE — скачается заново при следующем использовании дерева метаданных. */
export async function clearPortableJreCache(context: vscode.ExtensionContext): Promise<void> {
	await fs.rm(path.join(installBaseDir(context), 'jre-temurin-21'), { recursive: true, force: true }).catch(() => undefined);
}
