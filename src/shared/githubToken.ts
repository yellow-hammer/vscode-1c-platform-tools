/**
 * Токен GitHub для загрузки внешних компонентов.
 *
 * Токен нужен только против лимита анонимных запросов GitHub: с общего внешнего
 * адреса лимит выбирается чужими запросами, и загрузка компонентов падает с 403.
 *
 * Хранится в SecretStorage: в settings.json он лежал бы открытым текстом,
 * уезжал бы в Settings Sync, а из `.vscode/settings.json` мог бы уйти в коммит.
 * Переменные окружения продолжают работать как раньше.
 *
 * @module githubToken
 */

import * as vscode from 'vscode';
import { logger } from './logger';
import { notifyQuiet } from './notify';

const log = logger.scope('components');

/** Ключ секрета в SecretStorage. */
const SECRET_KEY = '1c-platform-tools.githubToken';

/** Хранилище секретов расширения, доступно после {@link initGithubToken}. */
let secretStorage: vscode.SecretStorage | undefined = undefined;

/** Прочитанный секрет: чтение SecretStorage асинхронное, а токен нужен синхронно. */
let storedToken = '';

/**
 * Читает сохранённый токен в память. Вызывается на активации, до первой загрузки компонентов.
 *
 * @param secrets - Хранилище секретов расширения
 */
export async function initGithubToken(secrets: vscode.SecretStorage): Promise<void> {
	secretStorage = secrets;
	try {
		storedToken = (await secrets.get(SECRET_KEY))?.trim() ?? '';
	} catch (error) {
		log.warn(`Не удалось прочитать токен GitHub: ${(error as Error).message}`);
		storedToken = '';
	}
}

/**
 * Сохранённый токен или пустая строка.
 *
 * @returns Токен из SecretStorage
 */
export function githubTokenFromStore(): string {
	return storedToken;
}

/**
 * Спрашивает токен и сохраняет его. Пустой ввод стирает сохранённый.
 */
export async function askGithubToken(): Promise<void> {
	if (!secretStorage) {
		return;
	}
	const entered = await vscode.window.showInputBox({
		title: 'Токен GitHub',
		prompt: 'Нужен только против лимита анонимных запросов. Достаточно classic token без единого scope.',
		placeHolder: storedToken ? 'Токен сохранён, новый заменит его. Пустая строка сотрёт' : 'ghp_…',
		password: true,
		ignoreFocusOut: true,
	});
	if (entered === undefined) {
		return;
	}

	const token = entered.trim();
	if (token === '') {
		await forgetGithubToken();
		return;
	}

	await secretStorage.store(SECRET_KEY, token);
	storedToken = token;
	notifyQuiet('Токен GitHub сохранён');
}

/**
 * Стирает сохранённый токен.
 */
export async function forgetGithubToken(): Promise<void> {
	if (!secretStorage) {
		return;
	}
	await secretStorage.delete(SECRET_KEY);
	storedToken = '';

	const fromEnv = process.env.PLATFORM_TOOLS_GITHUB_TOKEN?.trim() || process.env.PLATFORM_TOOLS_MD_SPARROW_GITHUB_TOKEN?.trim();
	notifyQuiet(fromEnv ? 'Токен GitHub забыт, остался токен из переменной окружения' : 'Токен GitHub забыт');
}

/**
 * Проверяет, что ошибка это лимит анонимных запросов GitHub.
 *
 * @param message - Текст ошибки загрузки компонента
 * @returns true, если помог бы токен
 */
export function isGithubRateLimit(message: string): boolean {
	return message.includes('403') && message.includes('rate limit');
}

/**
 * Показывает ошибку загрузки компонента, добавляя кнопку ввода токена при лимите.
 *
 * @param message - Текст ошибки для показа
 */
export async function showComponentError(message: string): Promise<void> {
	log.error(message);
	const buttons = isGithubRateLimit(message) ? ['Указать токен', 'Подробнее'] : ['Подробнее'];
	const text = isGithubRateLimit(message)
		? 'Лимит анонимных запросов GitHub исчерпан. С токеном лимит выше.'
		: message;

	const action = await vscode.window.showErrorMessage(text, ...buttons);
	if (action === 'Указать токен') {
		await askGithubToken();
	} else if (action === 'Подробнее') {
		logger.show();
	}
}
