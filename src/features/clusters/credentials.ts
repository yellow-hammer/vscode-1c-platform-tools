/**
 * Пароли администраторов кластера и информационных баз.
 *
 * Пароль администратора кластера нужен при каждом обращении к кластеру, поэтому
 * он хранится в защищённом хранилище VS Code (SecretStorage) — не в файле
 * подключений и не в настройках, которые попадают в синхронизацию и в git.
 *
 * Пароль администратора центрального сервера нужен только правке самого
 * кластера, но хранится там же: заводят его один раз вместе с подключением.
 *
 * Пароль администратора информационной базы спрашивается по требованию и живёт
 * только в памяти до перезапуска окна: он нужен единичным операциям, и
 * долговременное хранение здесь не оправдано.
 */

import type * as vscode from 'vscode';
import type { RacCredentials } from './racArgs';

/** Префикс ключей защищённого хранилища. */
const SECRET_PREFIX = '1c-platform-tools.clusters.';

/** Ключ пароля администратора кластера. */
function clusterPasswordKey(connectionId: string): string {
	return `${SECRET_PREFIX}${connectionId}.clusterPwd`;
}

/** Ключ пароля администратора центрального сервера. */
function agentPasswordKey(connectionId: string): string {
	return `${SECRET_PREFIX}${connectionId}.agentPwd`;
}

/** Хранилище учётных данных администраторов. */
export class ClusterCredentialStore {
	/** Пароли администраторов информационных баз: подключение+база → данные. */
	private readonly infobaseCredentials = new Map<string, RacCredentials>();

	constructor(private readonly secrets: vscode.SecretStorage) {}

	/**
	 * Читает пароль администратора кластера.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @returns Пароль или undefined, если он не сохранён
	 */
	async clusterPassword(connectionId: string): Promise<string | undefined> {
		return this.secrets.get(clusterPasswordKey(connectionId));
	}

	/**
	 * Сохраняет или удаляет пароль администратора кластера.
	 *
	 * Пустой пароль удаляет запись: администратор без пароля — рабочий вариант, и
	 * хранить для него пустую строку незачем.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param password - Пароль или пустая строка
	 */
	async setClusterPassword(connectionId: string, password: string): Promise<void> {
		const key = clusterPasswordKey(connectionId);
		if (password === '') {
			await this.secrets.delete(key);
			return;
		}
		await this.secrets.store(key, password);
	}

	/**
	 * Читает пароль администратора центрального сервера.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @returns Пароль или undefined, если он не сохранён
	 */
	async agentPassword(connectionId: string): Promise<string | undefined> {
		return this.secrets.get(agentPasswordKey(connectionId));
	}

	/**
	 * Сохраняет или удаляет пароль администратора центрального сервера.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param password - Пароль или пустая строка
	 */
	async setAgentPassword(connectionId: string, password: string): Promise<void> {
		const key = agentPasswordKey(connectionId);
		if (password === '') {
			await this.secrets.delete(key);
			return;
		}
		await this.secrets.store(key, password);
	}

	/**
	 * Удаляет пароли удалённого подключения.
	 *
	 * @param connectionId - Идентификатор подключения
	 */
	async forgetConnection(connectionId: string): Promise<void> {
		await this.secrets.delete(clusterPasswordKey(connectionId));
		await this.secrets.delete(agentPasswordKey(connectionId));
		for (const key of [...this.infobaseCredentials.keys()]) {
			if (key.startsWith(`${connectionId}:`)) {
				this.infobaseCredentials.delete(key);
			}
		}
	}

	/**
	 * Возвращает запомненные в этом сеансе данные администратора базы.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param infobaseId - Идентификатор информационной базы
	 * @returns Данные или undefined
	 */
	infobase(connectionId: string, infobaseId: string): RacCredentials | undefined {
		return this.infobaseCredentials.get(`${connectionId}:${infobaseId}`);
	}

	/**
	 * Запоминает данные администратора базы до перезапуска окна.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param infobaseId - Идентификатор информационной базы
	 * @param credentials - Имя и пароль администратора базы
	 */
	rememberInfobase(connectionId: string, infobaseId: string, credentials: RacCredentials): void {
		this.infobaseCredentials.set(`${connectionId}:${infobaseId}`, credentials);
	}

	/** Забывает пароли администраторов баз, оставляя пароли кластеров. */
	clearInfobaseCredentials(): void {
		this.infobaseCredentials.clear();
	}
}
