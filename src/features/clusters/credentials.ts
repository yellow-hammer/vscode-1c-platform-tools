/**
 * Наборы учётных данных консоли кластера.
 *
 * Один набор — название, пользователь и пароль — заводится под конкретную
 * роль: администратор кластера, центрального сервера или информационных баз.
 * Наборов у роли может быть сколько угодно; работает набор только там, куда
 * он привязан: к кластеру, к подключению или к базе.
 *
 * Пароли живут в защищённом хранилище VS Code и не попадают в настройки и git.
 * Имена и привязки — в глобальном состоянии, как список подключений.
 */

import type { RacCredentials } from './racArgs';
import type { SyncedMemento } from './connectionStore';
import type * as vscode from 'vscode';

/** Роль набора: она же его вид. */
export type CredentialRole = 'cluster' | 'agent' | 'infobase';

/** Набор учётных данных: без пароля. */
export interface CredentialSet {
	id: string;
	name: string;
	user: string;
	kind: CredentialRole;
}

/** Данные набора, которые вводит пользователь. */
export interface CredentialSetInput {
	name: string;
	user: string;
	kind: CredentialRole;
}

/** Явная привязка набора к информационной базе. */
export interface InfobaseBinding {
	connectionId: string;
	clusterId: string;
	infobaseId: string;
	setId: string;
	connectionName: string;
	infobaseName: string;
}

/** Роль набора на уровне подключения: администратор кластера или агента. */
export type ConnectionRole = Exclude<CredentialRole, 'infobase'>;

/** Привязка набора к подключению: выбор в карточке подключения. */
export interface ConnectionBinding {
	connectionId: string;
	role: ConnectionRole;
	setId: string;
}

/**
 * Привязка набора к кластеру.
 *
 * Кластеров у сервера может быть несколько, и администраторы у них разные:
 * привязка к кластеру точнее привязки к подключению и перекрывает её.
 */
export interface ClusterBinding {
	connectionId: string;
	clusterId: string;
	setId: string;
	connectionName: string;
	clusterName: string;
}

/** Ключ списка наборов. */
export const CREDENTIAL_SETS_STATE_KEY = '1c-platform-tools.clusters.credentialSets';

/** Ключ привязок наборов к базам. */
export const INFOBASE_BINDINGS_STATE_KEY = '1c-platform-tools.clusters.infobaseBindings';

/** Ключ привязок наборов к подключениям. */
export const CONNECTION_BINDINGS_STATE_KEY = '1c-platform-tools.clusters.connectionBindings';

/** Ключ привязок наборов к кластерам. */
export const CLUSTER_BINDINGS_STATE_KEY = '1c-platform-tools.clusters.clusterAdminBindings';

/** Префикс ключей защищённого хранилища. */
const SECRET_PREFIX = '1c-platform-tools.clusters.sets.';

/** Ключ пароля набора. */
function passwordKey(setId: string): string {
	return `${SECRET_PREFIX}${setId}.pwd`;
}

function isRole(value: unknown): value is CredentialRole {
	return value === 'cluster' || value === 'agent' || value === 'infobase';
}

function bindingKey(connectionId: string, infobaseId: string): string {
	return `${connectionId}:${infobaseId}`;
}

/**
 * Проверяет набор перед записью.
 *
 * @param input - Данные из формы
 * @returns Список замечаний; пустой — можно сохранять
 */
export function validateCredentialSetInput(
	input: Pick<CredentialSetInput, 'name' | 'user'>
): string[] {
	const problems: string[] = [];
	if (input.name.trim() === '') {
		problems.push('не задано название');
	}
	if (input.user.trim() === '') {
		problems.push('не задано имя пользователя');
	}
	return problems;
}

/**
 * Приводит сохранённую запись к набору.
 *
 * @param raw - Сохранённая запись
 * @param index - Номер записи
 * @returns Набор или undefined, если запись бесполезна
 */
export function normalizeStoredSet(
	raw: Partial<CredentialSet>,
	index: number
): CredentialSet | undefined {
	const name = typeof raw.name === 'string' ? raw.name.trim() : '';
	const user = typeof raw.user === 'string' ? raw.user.trim() : '';
	if (name === '' || user === '' || !isRole(raw.kind)) {
		return undefined;
	}
	const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id : `set-${index + 1}`;
	return { id, name, user, kind: raw.kind };
}

/**
 * Приводит сохранённую привязку к кластеру.
 *
 * @param raw - Сохранённая запись
 * @returns Привязка или undefined, если запись бесполезна
 */
export function normalizeStoredClusterBinding(
	raw: Partial<ClusterBinding>
): ClusterBinding | undefined {
	const connectionId = typeof raw.connectionId === 'string' ? raw.connectionId.trim() : '';
	const clusterId = typeof raw.clusterId === 'string' ? raw.clusterId.trim() : '';
	const setId = typeof raw.setId === 'string' ? raw.setId.trim() : '';
	if (connectionId === '' || clusterId === '' || setId === '') {
		return undefined;
	}
	return {
		connectionId,
		clusterId,
		setId,
		connectionName: typeof raw.connectionName === 'string' ? raw.connectionName : '',
		clusterName: typeof raw.clusterName === 'string' ? raw.clusterName : '',
	};
}

/**
 * Приводит сохранённую привязку к подключению.
 *
 * @param raw - Сохранённая запись
 * @returns Привязка или undefined, если запись бесполезна
 */
export function normalizeStoredConnectionBinding(
	raw: Partial<ConnectionBinding>
): ConnectionBinding | undefined {
	const connectionId = typeof raw.connectionId === 'string' ? raw.connectionId.trim() : '';
	const setId = typeof raw.setId === 'string' ? raw.setId.trim() : '';
	if (connectionId === '' || setId === '' || (raw.role !== 'cluster' && raw.role !== 'agent')) {
		return undefined;
	}
	return { connectionId, role: raw.role, setId };
}

/**
 * Приводит сохранённую привязку к записи.
 *
 * @param raw - Сохранённая запись
 * @returns Привязка или undefined
 */
export function normalizeStoredBinding(raw: Partial<InfobaseBinding>): InfobaseBinding | undefined {
	const connectionId = typeof raw.connectionId === 'string' ? raw.connectionId.trim() : '';
	const infobaseId = typeof raw.infobaseId === 'string' ? raw.infobaseId.trim() : '';
	const setId = typeof raw.setId === 'string' ? raw.setId.trim() : '';
	if (connectionId === '' || infobaseId === '' || setId === '') {
		return undefined;
	}
	return {
		connectionId,
		clusterId: typeof raw.clusterId === 'string' ? raw.clusterId : '',
		infobaseId,
		setId,
		connectionName: typeof raw.connectionName === 'string' ? raw.connectionName : '',
		infobaseName: typeof raw.infobaseName === 'string' ? raw.infobaseName : '',
	};
}

/** Хранилище наборов учётных данных. */
export class ClusterCredentialStore {
	private sets: CredentialSet[] = [];
	private bindings: InfobaseBinding[] = [];
	private connectionBindings: ConnectionBinding[] = [];
	private clusterAdminBindings: ClusterBinding[] = [];

	constructor(
		private readonly state: SyncedMemento,
		private readonly secrets: vscode.SecretStorage
	) {
		this.state.setKeysForSync([
			CREDENTIAL_SETS_STATE_KEY,
			INFOBASE_BINDINGS_STATE_KEY,
			CONNECTION_BINDINGS_STATE_KEY,
			CLUSTER_BINDINGS_STATE_KEY,
		]);
		this.load();
	}

	/** Перечитывает списки из состояния. */
	load(): void {
		const rawSets = this.state.get<Array<Partial<CredentialSet>>>(CREDENTIAL_SETS_STATE_KEY, []);
		this.sets = (Array.isArray(rawSets) ? rawSets : [])
			.map((item, index) => normalizeStoredSet(item ?? {}, index))
			.filter((item): item is CredentialSet => item !== undefined);
		const rawBindings = this.state.get<Array<Partial<InfobaseBinding>>>(
			INFOBASE_BINDINGS_STATE_KEY,
			[]
		);
		this.bindings = (Array.isArray(rawBindings) ? rawBindings : [])
			.map((item) => normalizeStoredBinding(item ?? {}))
			.filter((item): item is InfobaseBinding => item !== undefined);
		const rawConnectionBindings = this.state.get<Array<Partial<ConnectionBinding>>>(
			CONNECTION_BINDINGS_STATE_KEY,
			[]
		);
		this.connectionBindings = (Array.isArray(rawConnectionBindings) ? rawConnectionBindings : [])
			.map((item) => normalizeStoredConnectionBinding(item ?? {}))
			.filter((item): item is ConnectionBinding => item !== undefined);
		const rawClusterBindings = this.state.get<Array<Partial<ClusterBinding>>>(
			CLUSTER_BINDINGS_STATE_KEY,
			[]
		);
		this.clusterAdminBindings = (Array.isArray(rawClusterBindings) ? rawClusterBindings : [])
			.map((item) => normalizeStoredClusterBinding(item ?? {}))
			.filter((item): item is ClusterBinding => item !== undefined);
	}

	/** Наборы в порядке добавления; с ролью — только её наборы. */
	list(kind?: CredentialRole): CredentialSet[] {
		return this.sets
			.filter((set) => kind === undefined || set.kind === kind)
			.map((set) => ({ ...set }));
	}

	/** Набор по идентификатору. */
	get(id: string): CredentialSet | undefined {
		const set = this.sets.find((item) => item.id === id);
		return set ? { ...set } : undefined;
	}

	/**
	 * Добавляет набор.
	 *
	 * @param input - Данные набора
	 * @param password - Пароль
	 * @returns Созданный набор
	 */
	async add(input: CredentialSetInput, password: string): Promise<CredentialSet> {
		const set: CredentialSet = {
			id: this.nextId(),
			name: input.name.trim(),
			user: input.user.trim(),
			kind: input.kind,
		};
		this.sets.push(set);
		await this.setPassword(set.id, password);
		await this.saveSets();
		return { ...set };
	}

	/**
	 * Обновляет набор.
	 *
	 * @param id - Идентификатор
	 * @param input - Новые данные
	 * @param password - Новый пароль; undefined — не менять
	 * @returns Обновлённый набор или undefined
	 */
	async update(
		id: string,
		input: CredentialSetInput,
		password?: string
	): Promise<CredentialSet | undefined> {
		const set = this.sets.find((item) => item.id === id);
		if (!set) {
			return undefined;
		}
		set.name = input.name.trim();
		set.user = input.user.trim();
		set.kind = input.kind;
		if (password !== undefined && password !== '') {
			await this.setPassword(id, password);
		}
		await this.saveSets();
		return this.get(id);
	}

	/**
	 * Удаляет набор, пароль и привязки к нему.
	 *
	 * @param id - Идентификатор
	 */
	async remove(id: string): Promise<void> {
		this.sets = this.sets.filter((set) => set.id !== id);
		this.bindings = this.bindings.filter((binding) => binding.setId !== id);
		this.connectionBindings = this.connectionBindings.filter((binding) => binding.setId !== id);
		this.clusterAdminBindings = this.clusterAdminBindings.filter((binding) => binding.setId !== id);
		await this.secrets.delete(passwordKey(id));
		await this.saveSets();
		await this.saveBindings();
		await this.saveConnectionBindings();
		await this.saveClusterBindings();
	}

	/**
	 * Читает пароль набора.
	 *
	 * @param setId - Идентификатор набора
	 * @returns Пароль или undefined
	 */
	async password(setId: string): Promise<string | undefined> {
		return this.secrets.get(passwordKey(setId));
	}

	/**
	 * Сохраняет или удаляет пароль набора.
	 *
	 * Пустой пароль удаляет запись: администратор без пароля — рабочий вариант.
	 *
	 * @param setId - Идентификатор набора
	 * @param password - Пароль или пустая строка
	 */
	async setPassword(setId: string, password: string): Promise<void> {
		const key = passwordKey(setId);
		if (password === '') {
			await this.secrets.delete(key);
			return;
		}
		await this.secrets.store(key, password);
	}

	/**
	 * Учётные данные роли для подключения: только явная привязка.
	 *
	 * @param role - Роль
	 * @param connectionId - Идентификатор подключения
	 * @returns Имя и пароль или undefined, если набор не привязан
	 */
	async resolveRole(
		role: ConnectionRole,
		connectionId: string
	): Promise<RacCredentials | undefined> {
		const set = this.boundConnectionSet(connectionId, role);
		return set ? this.toCredentials(set) : undefined;
	}

	/** Набор, привязанный к подключению для роли. */
	boundConnectionSet(connectionId: string, role: ConnectionRole): CredentialSet | undefined {
		const binding = this.connectionBindings.find(
			(item) => item.connectionId === connectionId && item.role === role
		);
		return binding ? this.get(binding.setId) : undefined;
	}

	/** Есть ли у подключения набор для роли. */
	hasRoleFor(role: ConnectionRole, connectionId: string): boolean {
		return this.boundConnectionSet(connectionId, role) !== undefined;
	}

	/** Привязки всех подключений. */
	listConnectionBindings(): ConnectionBinding[] {
		return this.connectionBindings.map((item) => ({ ...item }));
	}

	/**
	 * Привязывает набор к подключению или снимает привязку.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param role - Роль на уровне подключения
	 * @param setId - Набор; пусто или неизвестный набор — снять привязку
	 */
	async bindConnectionRole(
		connectionId: string,
		role: ConnectionRole,
		setId?: string
	): Promise<void> {
		this.connectionBindings = this.connectionBindings.filter(
			(item) => !(item.connectionId === connectionId && item.role === role)
		);
		if (setId !== undefined && setId !== '' && this.get(setId)) {
			this.connectionBindings.push({ connectionId, role, setId });
		}
		await this.saveConnectionBindings();
	}

	/** Привязки всех кластеров. */
	listClusterBindings(): ClusterBinding[] {
		return this.clusterAdminBindings.map((item) => ({ ...item }));
	}

	/** Привязки набора к кластерам. */
	clusterBindingsForSet(setId: string): ClusterBinding[] {
		return this.clusterAdminBindings
			.filter((item) => item.setId === setId)
			.map((item) => ({ ...item }));
	}

	/** Набор, привязанный к кластеру. */
	boundClusterSet(connectionId: string, clusterId: string): CredentialSet | undefined {
		const binding = this.clusterAdminBindings.find(
			(item) => item.connectionId === connectionId && item.clusterId === clusterId
		);
		return binding ? this.get(binding.setId) : undefined;
	}

	/**
	 * Привязывает набор к кластеру.
	 *
	 * @param binding - Привязка
	 */
	async bindCluster(binding: ClusterBinding): Promise<void> {
		this.clusterAdminBindings = this.clusterAdminBindings.filter(
			(item) => !(item.connectionId === binding.connectionId && item.clusterId === binding.clusterId)
		);
		this.clusterAdminBindings.push({ ...binding });
		await this.saveClusterBindings();
	}

	/**
	 * Снимает привязку набора с кластера.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param clusterId - Идентификатор кластера
	 */
	async unbindCluster(connectionId: string, clusterId: string): Promise<void> {
		this.clusterAdminBindings = this.clusterAdminBindings.filter(
			(item) => !(item.connectionId === connectionId && item.clusterId === clusterId)
		);
		await this.saveClusterBindings();
	}

	/**
	 * Администратор кластера: привязка к кластеру, иначе к подключению.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param clusterId - Идентификатор кластера
	 * @returns Имя и пароль или undefined, если набор не привязан
	 */
	async resolveClusterAdmin(
		connectionId: string,
		clusterId: string
	): Promise<RacCredentials | undefined> {
		const exact = this.boundClusterSet(connectionId, clusterId);
		if (exact) {
			return this.toCredentials(exact);
		}
		return this.resolveRole('cluster', connectionId);
	}

	/**
	 * Учётные данные информационной базы: только явная привязка.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param infobaseId - Идентификатор базы
	 * @returns Имя и пароль или undefined
	 */
	async resolveInfobase(
		connectionId: string,
		infobaseId: string
	): Promise<RacCredentials | undefined> {
		const bound = this.boundSet(connectionId, infobaseId);
		return bound ? this.toCredentials(bound) : undefined;
	}

	/** Привязки всех баз. */
	listBindings(): InfobaseBinding[] {
		return this.bindings.map((item) => ({ ...item }));
	}

	/** Привязки выбранного набора. */
	bindingsForSet(setId: string): InfobaseBinding[] {
		return this.bindings.filter((item) => item.setId === setId).map((item) => ({ ...item }));
	}

	/** Набор, привязанный к базе. */
	boundSet(connectionId: string, infobaseId: string): CredentialSet | undefined {
		const key = bindingKey(connectionId, infobaseId);
		const binding = this.bindings.find((item) => bindingKey(item.connectionId, item.infobaseId) === key);
		return binding ? this.get(binding.setId) : undefined;
	}

	/** Название набора, привязанного к базе. */
	boundSetName(connectionId: string, infobaseId: string): string | undefined {
		return this.boundSet(connectionId, infobaseId)?.name;
	}

	/**
	 * Привязывает набор к информационной базе.
	 *
	 * @param binding - Привязка
	 */
	async bindInfobase(binding: InfobaseBinding): Promise<void> {
		const key = bindingKey(binding.connectionId, binding.infobaseId);
		this.bindings = this.bindings.filter(
			(item) => bindingKey(item.connectionId, item.infobaseId) !== key
		);
		this.bindings.push({ ...binding });
		await this.saveBindings();
	}

	/**
	 * Снимает привязку набора с информационной базы.
	 *
	 * @param connectionId - Идентификатор подключения
	 * @param infobaseId - Идентификатор базы
	 */
	async unbindInfobase(connectionId: string, infobaseId: string): Promise<void> {
		const key = bindingKey(connectionId, infobaseId);
		this.bindings = this.bindings.filter(
			(item) => bindingKey(item.connectionId, item.infobaseId) !== key
		);
		await this.saveBindings();
	}

	/**
	 * Удаляет привязки удалённого подключения.
	 *
	 * @param connectionId - Идентификатор подключения
	 */
	async forgetConnection(connectionId: string): Promise<void> {
		this.bindings = this.bindings.filter((item) => item.connectionId !== connectionId);
		this.connectionBindings = this.connectionBindings.filter(
			(item) => item.connectionId !== connectionId
		);
		this.clusterAdminBindings = this.clusterAdminBindings.filter(
			(item) => item.connectionId !== connectionId
		);
		await this.saveBindings();
		await this.saveConnectionBindings();
		await this.saveClusterBindings();
	}

	private async toCredentials(set: CredentialSet): Promise<RacCredentials> {
		return { user: set.user, password: (await this.password(set.id)) ?? '' };
	}

	private async saveSets(): Promise<void> {
		await this.state.update(CREDENTIAL_SETS_STATE_KEY, this.sets);
	}

	private async saveBindings(): Promise<void> {
		await this.state.update(INFOBASE_BINDINGS_STATE_KEY, this.bindings);
	}

	private async saveConnectionBindings(): Promise<void> {
		await this.state.update(CONNECTION_BINDINGS_STATE_KEY, this.connectionBindings);
	}

	private async saveClusterBindings(): Promise<void> {
		await this.state.update(CLUSTER_BINDINGS_STATE_KEY, this.clusterAdminBindings);
	}

	private nextId(): string {
		const used = new Set(this.sets.map((set) => set.id));
		let index = this.sets.length + 1;
		while (used.has(`set-${index}`)) {
			index += 1;
		}
		return `set-${index}`;
	}
}
