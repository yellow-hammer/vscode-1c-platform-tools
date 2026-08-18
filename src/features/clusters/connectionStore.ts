/**
 * Список подключений к серверам администрирования.
 *
 * Список живёт в глобальном состоянии расширения и помечен как синхронизируемый
 * (`setKeysForSync`), поэтому переезжает между машинами штатной синхронизацией
 * параметров VS Code — без файла в облачной папке и без отдельной настройки.
 *
 * Паролей в списке нет: они живут в защищённом хранилище (см. credentials) и не
 * синхронизируются — это и правильно, доступ к серверу не возят через облако.
 */

import type * as vscode from 'vscode';
import { DEFAULT_RAS_PORT } from './constants';
import type { ClusterConnection } from './model';

/** Ключ глобального состояния со списком подключений. */
export const CONNECTIONS_STATE_KEY = '1c-platform-tools.clusters.connections';

/** Глобальное состояние: у него, в отличие от рабочего, есть синхронизация. */
export type SyncedMemento = vscode.Memento & {
	setKeysForSync(keys: readonly string[]): void;
};

/** Данные подключения, вводимые пользователем. */
export interface ConnectionInput {
	name: string;
	host: string;
	port: number;
	clusterUser?: string;
	agentUser?: string;
	platformVersion?: string;
}

/**
 * Разбирает порт сервера администрирования.
 *
 * @param value - Введённое значение
 * @returns Порт или undefined, если значение не похоже на порт
 */
export function parseRasPort(value: string): number | undefined {
	const trimmed = value.trim();
	if (trimmed === '') {
		return DEFAULT_RAS_PORT;
	}
	if (!/^\d{1,5}$/.test(trimmed)) {
		return undefined;
	}
	const port = Number(trimmed);
	return port >= 1 && port <= 65535 ? port : undefined;
}

/**
 * Разбирает адрес сервера администрирования, введённый одной строкой.
 *
 * Администраторы пишут адрес привычным образом — `srv-1c:1545`, `srv-1c` или
 * с указанием протокола. Порт по умолчанию подставляется из платформы.
 *
 * @param value - Введённая строка
 * @returns Хост и порт либо undefined, если строку разобрать не удалось
 */
export function parseRasAddress(value: string): { host: string; port: number } | undefined {
	const trimmed = value.trim().replace(/^\w+:\/\//, '');
	if (trimmed === '') {
		return undefined;
	}
	const match = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(trimmed);
	if (!match) {
		return undefined;
	}
	const host = match[1];
	const port = match[2] === undefined ? DEFAULT_RAS_PORT : Number(match[2]);
	if (port < 1 || port > 65535) {
		return undefined;
	}
	return { host, port };
}

/**
 * Приводит сохранённую запись к подключению, подставляя умолчания.
 *
 * Состояние переживает обновления расширения и приезжает с другой машины,
 * поэтому неполные записи ожидаемы: запись без хоста пропускается, запись без
 * порта получает порт платформы.
 *
 * @param raw - Сохранённая запись
 * @param index - Номер записи (для имени по умолчанию)
 * @returns Подключение или undefined, если запись бесполезна
 */
export function normalizeStoredConnection(
	raw: Partial<ClusterConnection>,
	index: number
): ClusterConnection | undefined {
	const host = typeof raw.host === 'string' ? raw.host.trim() : '';
	if (host === '') {
		return undefined;
	}
	const port = typeof raw.port === 'number' && raw.port >= 1 && raw.port <= 65535 ? raw.port : DEFAULT_RAS_PORT;
	const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id : `connection-${index + 1}`;
	const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : `${host}:${port}`;
	return {
		id,
		name,
		host,
		port,
		clusterUser:
			typeof raw.clusterUser === 'string' && raw.clusterUser.trim() !== ''
				? raw.clusterUser.trim()
				: undefined,
		agentUser:
			typeof raw.agentUser === 'string' && raw.agentUser.trim() !== ''
				? raw.agentUser.trim()
				: undefined,
		platformVersion:
			typeof raw.platformVersion === 'string' && raw.platformVersion.trim() !== ''
				? raw.platformVersion.trim()
				: undefined,
	};
}

/** Хранилище подключений. */
export class ConnectionStore {
	private items: ClusterConnection[] = [];

	constructor(private readonly state: SyncedMemento) {
		// Список едет между машинами штатной синхронизацией параметров.
		this.state.setKeysForSync([CONNECTIONS_STATE_KEY]);
		this.load();
	}

	/** Перечитывает список из состояния. */
	load(): void {
		const raw = this.state.get<Array<Partial<ClusterConnection>>>(CONNECTIONS_STATE_KEY, []);
		this.items = (Array.isArray(raw) ? raw : [])
			.map((item, index) => normalizeStoredConnection(item ?? {}, index))
			.filter((item): item is ClusterConnection => item !== undefined);
	}

	/** Список подключений в порядке добавления. */
	list(): ClusterConnection[] {
		return [...this.items];
	}

	/** Подключение по идентификатору. */
	get(id: string): ClusterConnection | undefined {
		return this.items.find((item) => item.id === id);
	}

	/** Есть ли хотя бы одно подключение. */
	isEmpty(): boolean {
		return this.items.length === 0;
	}

	/**
	 * Добавляет подключение.
	 *
	 * @param input - Данные подключения
	 * @returns Созданное подключение
	 */
	async add(input: ConnectionInput): Promise<ClusterConnection> {
		const connection: ClusterConnection = {
			id: this.nextId(),
			name: input.name,
			host: input.host,
			port: input.port,
			clusterUser: input.clusterUser || undefined,
			agentUser: input.agentUser || undefined,
			platformVersion: input.platformVersion || undefined,
		};
		this.items.push(connection);
		await this.save();
		return connection;
	}

	/**
	 * Обновляет подключение.
	 *
	 * @param id - Идентификатор подключения
	 * @param input - Новые данные
	 * @returns Обновлённое подключение или undefined, если его нет
	 */
	async update(id: string, input: ConnectionInput): Promise<ClusterConnection | undefined> {
		const connection = this.get(id);
		if (!connection) {
			return undefined;
		}
		connection.name = input.name;
		connection.host = input.host;
		connection.port = input.port;
		connection.clusterUser = input.clusterUser || undefined;
		connection.agentUser = input.agentUser || undefined;
		connection.platformVersion = input.platformVersion || undefined;
		await this.save();
		return connection;
	}

	/**
	 * Удаляет подключение.
	 *
	 * @param id - Идентификатор подключения
	 * @returns Удалённое подключение или undefined
	 */
	async remove(id: string): Promise<ClusterConnection | undefined> {
		const index = this.items.findIndex((item) => item.id === id);
		if (index < 0) {
			return undefined;
		}
		const [removed] = this.items.splice(index, 1);
		await this.save();
		return removed;
	}

	/** Записывает список в состояние. */
	private async save(): Promise<void> {
		await this.state.update(CONNECTIONS_STATE_KEY, this.items);
	}

	/**
	 * Подбирает свободный идентификатор.
	 *
	 * Идентификатор попадает в ключ защищённого хранилища, поэтому он не должен
	 * повторяться даже после удаления подключений.
	 *
	 * @returns Идентификатор, которого нет в списке
	 */
	private nextId(): string {
		const used = new Set(this.items.map((item) => item.id));
		let index = this.items.length + 1;
		while (used.has(`connection-${index}`)) {
			index += 1;
		}
		return `connection-${index}`;
	}
}
