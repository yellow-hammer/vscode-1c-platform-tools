/**
 * Особенности удалённых окружений: Codespaces, SSH, WSL, контейнер разработки.
 *
 * Локальный адрес там нужно пробрасывать наружу, а графической оболочки 1С нет.
 *
 * @module remoteEnv
 */

import * as vscode from 'vscode';
import * as net from 'node:net';

/**
 * Работает ли расширение в удалённом окружении.
 *
 * @returns true для Codespaces, SSH, WSL и контейнеров разработки
 */
export function isRemoteEnvironment(): boolean {
	return vscode.env.remoteName !== undefined || vscode.env.uiKind === vscode.UIKind.Web;
}

/**
 * Открывает локальный адрес в браузере пользователя.
 *
 * В удалённом окружении адрес сначала пробрасывается наружу: `localhost` внутри
 * контейнера для браузера на машине пользователя ничего не значит.
 *
 * @param url - Локальный адрес сервиса
 */
export async function openLocalUrl(url: string): Promise<void> {
	const target = await vscode.env.asExternalUri(vscode.Uri.parse(url));
	await vscode.env.openExternal(target);
}

/**
 * Предупреждает, что графической оболочки 1С в этом окружении нет.
 *
 * @param commandTitle - Название команды для текста предупреждения
 * @returns false, если пользователь отказался продолжать
 */
export async function confirmGuiCommandInRemote(commandTitle: string): Promise<boolean> {
	if (!isRemoteEnvironment()) {
		return true;
	}
	const answer = await vscode.window.showWarningMessage(
		`«${commandTitle}» запускает клиент 1С, а в удалённом окружении графической оболочки обычно нет. Пакетные команды (сборка, разбор, загрузка) работают.`,
		'Всё равно выполнить',
		'Отмена'
	);
	return answer === 'Всё равно выполнить';
}

/**
 * Ищет свободный порт, начиная с предпочтительного.
 *
 * @param preferred - Порт, с которого начинать перебор
 * @param attempts - Сколько портов проверить подряд
 * @returns Свободный порт или undefined, если ни один не подошёл
 */
export async function findFreePort(preferred: number, attempts = 20): Promise<number | undefined> {
	for (let port = preferred; port < preferred + attempts; port++) {
		const free = await new Promise<boolean>((resolve) => {
			const probe = net.createServer();
			probe.once('error', () => resolve(false));
			probe.once('listening', () => probe.close(() => resolve(true)));
			probe.listen(port, '127.0.0.1');
		});
		if (free) {
			return port;
		}
	}
	return undefined;
}
