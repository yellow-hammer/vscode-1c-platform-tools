import type { SettingsSchema } from '../../shared/envProfiles';
import { environmentLabel } from '../../shared/environments';
import {
	formatMissingProfileFile,
	profileFileMissing,
	profileLinks,
	serviceFileClauses,
	type ProfileLink,
} from './profileLinks';

const REPORT_FRAMEWORKS = ['vanessa', 'xunit', 'yaxunit', 'syntax-check'] as const;

/** Откуда брать профиль, окружение и файл настроек для первой строки прогона. */
export interface LaunchPrefaceSource {
	launchSummary(): {
		profile: { label: string; settingsFiles: string[] };
		environment: { id?: string; files: string[]; variables: Record<string, string> };
	};
	readActiveSettings(): Promise<{ settings: Record<string, unknown>; schema: SettingsSchema }>;
	getActiveEnvFile(): string;
}

/**
 * Первая строка прогона: профиль, служебный файл фреймворка и окружение.
 * Нет файла профиля: красная пометка. Незаданная настройка: жёлтым, в той же строке.
 *
 * @param source - Активный профиль и окружение проекта
 * @param root - Корень проекта
 * @param ids - Фреймворки этого запуска
 * @returns Текст без завершающего перевода строки; пусто, если писать нечего
 */
export async function formatLaunchPreface(
	source: LaunchPrefaceSource,
	root: string,
	ids: readonly string[],
): Promise<string> {
	const watched = ids.filter((id) => (REPORT_FRAMEWORKS as readonly string[]).includes(id));
	const { profile, environment } = source.launchSummary();
	const file = source.getActiveEnvFile();
	const missing = watched.length > 0 && await profileFileMissing(root, file);
	let links: ProfileLink[] = [];
	if (watched.length > 0 && !missing) {
		const { settings, schema } = await source.readActiveSettings();
		links = await profileLinks(root, settings, schema);
	}
	const parts: string[] = [];
	if (missing) {
		parts.push(`Профиль запуска: ${profile.label} (${formatMissingProfileFile(file)})`);
	} else if (profile.settingsFiles.length > 0 && watched.length > 0) {
		parts.push(`Профиль запуска: ${profile.label} (${profile.settingsFiles.join(', ')})`);
	}
	parts.push(...serviceFileClauses(links, watched));
	if (environment.files.length > 0) {
		const names = Object.keys(environment.variables);
		const label = environmentLabel(environment.id, environment.files);
		const listed = environment.files.join(', ');
		parts.push(`окружение: ${label} (${listed}${names.length > 0 ? `: ${names.join(', ')}` : ''})`);
	}
	const text = parts.join('; ');
	return text === '' ? '' : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
