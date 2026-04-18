/**
 * Репозиторий и артефакты md-sparrow для авто-загрузки.
 * @module mdSparrowConstants
 */

/** Репозиторий GitHub Releases, откуда тянется JAR (не настраивается). */
export const MD_SPARROW_DEFAULT_REPO = 'yellow-hammer/md-sparrow';

/** Паттерн имени fat-JAR в релизе GitHub */
export const MD_SPARROW_JAR_REGEX = /md-sparrow-.*-all\.jar$/i;

/** API Temurin JRE 21 (ga) — редирект на архив */
export function adoptiumBinaryUrl(): string {
	const { os, arch } = adoptiumOsArch();
	// https://api.adoptium.net/swagger
	return `https://api.adoptium.net/v3/binary/latest/21/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
}

function adoptiumOsArch(): { os: string; arch: string } {
	const platform = process.platform;
	const a = process.arch;
	if (platform === 'win32') {
		return { os: 'windows', arch: a === 'arm64' ? 'aarch64' : 'x64' };
	}
	if (platform === 'darwin') {
		return { os: 'mac', arch: a === 'arm64' ? 'aarch64' : 'x64' };
	}
	return { os: 'linux', arch: a === 'arm64' ? 'aarch64' : 'x64' };
}
