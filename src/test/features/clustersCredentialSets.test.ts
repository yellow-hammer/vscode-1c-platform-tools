import * as assert from 'node:assert';
import {
	CLUSTER_BINDINGS_STATE_KEY,
	CONNECTION_BINDINGS_STATE_KEY,
	CREDENTIAL_SETS_STATE_KEY,
	INFOBASE_BINDINGS_STATE_KEY,
	ClusterCredentialStore,
	normalizeStoredBinding,
	normalizeStoredClusterBinding,
	normalizeStoredConnectionBinding,
	normalizeStoredSet,
	validateCredentialSetInput,
	type CredentialSet,
} from '../../features/clusters/credentials';
import { missingCredentialsMessage } from '../../features/clusters/credentialsNotify';
import { toCredentialSetDraft } from '../../features/clusters/connectionsEditor';

/** Набор для проверок с заполненными полями. */
function set(overrides: Partial<CredentialSet> = {}): CredentialSet {
	return {
		id: 'set-1',
		name: 'Тест',
		user: 'Админ',
		kind: 'cluster',
		...overrides,
	};
}

suite('наборы учётных данных: разбор', () => {
	test('без названия или пользователя запись бесполезна', () => {
		assert.strictEqual(normalizeStoredSet({ user: 'admin' }, 0), undefined);
		assert.strictEqual(normalizeStoredSet({ name: 'Боевой' }, 0), undefined);
	});

	test('идентификатор подставляется, запись без роли отбрасывается', () => {
		assert.deepStrictEqual(
			normalizeStoredSet({ name: 'Тест', user: 'Админ', kind: 'infobase' }, 0),
			{ id: 'set-1', name: 'Тест', user: 'Админ', kind: 'infobase' }
		);
		assert.strictEqual(normalizeStoredSet({ name: 'Тест', user: 'Админ' }, 1), undefined);
	});

	test('привязка подключения без роли или набора отбрасывается', () => {
		assert.strictEqual(
			normalizeStoredConnectionBinding({ connectionId: 'c1', setId: 's1' }),
			undefined
		);
		assert.strictEqual(
			normalizeStoredConnectionBinding({ connectionId: 'c1', role: 'cluster' }),
			undefined
		);
		assert.deepStrictEqual(
			normalizeStoredConnectionBinding({ connectionId: 'c1', role: 'cluster', setId: 's1' }),
			{ connectionId: 'c1', role: 'cluster', setId: 's1' }
		);
	});

	test('привязка кластера без кластера или набора отбрасывается', () => {
		assert.strictEqual(
			normalizeStoredClusterBinding({ connectionId: 'c1', setId: 's1' }),
			undefined
		);
		assert.ok(
			normalizeStoredClusterBinding({
				connectionId: 'c1',
				clusterId: 'cl',
				setId: 's1',
				connectionName: 'Локальный',
				clusterName: 'Кластер',
			})
		);
	});

	test('привязка без базы или набора отбрасывается', () => {
		assert.strictEqual(normalizeStoredBinding({ connectionId: 'c1', setId: 's1' }), undefined);
		assert.ok(
			normalizeStoredBinding({
				connectionId: 'c1',
				clusterId: 'cl',
				infobaseId: 'ib',
				setId: 's1',
				connectionName: 'Локальный',
				infobaseName: 'ib',
			})
		);
	});

	test('без названия и пользователя сохранять нечего', () => {
		assert.deepStrictEqual(validateCredentialSetInput({ name: '   ', user: '' }), [
			'не задано название',
			'не задано имя пользователя',
		]);
		assert.deepStrictEqual(validateCredentialSetInput({ name: 'Тест', user: 'Тест' }), []);
	});
});

suite('наборы учётных данных: форма', () => {
	test('сохранённый набор разворачивается в поля формы', () => {
		const draft = toCredentialSetDraft(set({ kind: 'infobase' }), true);

		assert.strictEqual(draft.kind, 'infobase');
		assert.strictEqual(draft.hasPassword, true);
	});
});

suite('наборы учётных данных: уведомления', () => {
	test('текст называет базу, когда она известна', () => {
		assert.strictEqual(
			missingCredentialsMessage({ kind: 'infobaseMissing', infobaseName: 'ib' }),
			'Нет учётных данных для базы «ib»'
		);
		assert.strictEqual(
			missingCredentialsMessage({ kind: 'clusterMissing' }),
			'Нет учётных данных администратора кластера'
		);
	});
});

/** Память вместо глобального состояния VS Code. */
class FakeMemento {
	readonly synced: string[] = [];
	private data = new Map<string, unknown>();

	setKeysForSync(keys: readonly string[]): void {
		this.synced.push(...keys);
	}

	get<T>(key: string, fallback: T): T {
		return (this.data.get(key) as T) ?? fallback;
	}

	keys(): readonly string[] {
		return [...this.data.keys()];
	}

	update(key: string, value: unknown): Thenable<void> {
		this.data.set(key, JSON.parse(JSON.stringify(value)) as unknown);
		return Promise.resolve();
	}
}

/** Защищённое хранилище в памяти. */
class FakeSecrets {
	private data = new Map<string, string>();

	get(key: string): Thenable<string | undefined> {
		return Promise.resolve(this.data.get(key));
	}

	store(key: string, value: string): Thenable<void> {
		this.data.set(key, value);
		return Promise.resolve();
	}

	delete(key: string): Thenable<void> {
		this.data.delete(key);
		return Promise.resolve();
	}
}

function storeOn(state = new FakeMemento(), secrets = new FakeSecrets()): ClusterCredentialStore {
	return new ClusterCredentialStore(
		state as unknown as ConstructorParameters<typeof ClusterCredentialStore>[0],
		secrets as unknown as ConstructorParameters<typeof ClusterCredentialStore>[1]
	);
}

suite('наборы учётных данных: хранилище', () => {
	test('списки помечены для синхронизации, пароли — нет', async () => {
		const state = new FakeMemento();
		const store = storeOn(state);
		await store.add({ name: 'Тест', user: 'Тест', kind: 'infobase' }, '123');

		assert.deepStrictEqual(state.synced, [
			CREDENTIAL_SETS_STATE_KEY,
			INFOBASE_BINDINGS_STATE_KEY,
			CONNECTION_BINDINGS_STATE_KEY,
			CLUSTER_BINDINGS_STATE_KEY,
		]);
		const raw = JSON.stringify(state.get(CREDENTIAL_SETS_STATE_KEY, []));
		assert.ok(!raw.includes('123'));
		assert.ok(!raw.toLowerCase().includes('password'));
	});

	test('пароль переживает перезапуск, в списке его нет', async () => {
		const state = new FakeMemento();
		const secrets = new FakeSecrets();
		const store = storeOn(state, secrets);
		const added = await store.add({ name: 'Тест', user: 'Тест', kind: 'infobase' }, '123');

		const restored = storeOn(state, secrets);
		assert.strictEqual(await restored.password(added.id), '123');
		assert.strictEqual(restored.get(added.id)?.user, 'Тест');
		assert.strictEqual(restored.get(added.id)?.kind, 'infobase');
	});

	test('база получает данные только по явной привязке', async () => {
		const store = storeOn();
		const special = await store.add({ name: 'Особый', user: 'spec', kind: 'infobase' }, 'bbb');
		await store.bindInfobase({
			connectionId: 'c1',
			clusterId: 'cl',
			infobaseId: 'ib',
			setId: special.id,
			connectionName: 'Локальный',
			infobaseName: 'ib',
		});

		const bound = await store.resolveInfobase('c1', 'ib');

		assert.strictEqual(bound?.user, 'spec');
		assert.strictEqual(bound?.password, 'bbb');
		assert.strictEqual(await store.resolveInfobase('c1', 'other'), undefined);
		assert.strictEqual(store.boundSetName('c1', 'ib'), 'Особый');
	});

	test('подключение получает данные только по своей привязке', async () => {
		const store = storeOn();
		const added = await store.add({ name: 'Кластер', user: 'adm', kind: 'cluster' }, 'aaa');
		await store.bindConnectionRole('c1', 'cluster', added.id);

		assert.strictEqual((await store.resolveRole('cluster', 'c1'))?.user, 'adm');
		assert.strictEqual(await store.resolveRole('cluster', 'c2'), undefined);
		assert.ok(store.hasRoleFor('cluster', 'c1'));
		assert.ok(!store.hasRoleFor('cluster', 'c2'));
	});

	test('привязка к кластеру точнее привязки к подключению', async () => {
		const store = storeOn();
		const conn = await store.add({ name: 'Для сервера', user: 'conn', kind: 'cluster' }, '2');
		const exact = await store.add({ name: 'Для кластера', user: 'exact', kind: 'cluster' }, '3');
		await store.bindConnectionRole('c1', 'cluster', conn.id);
		await store.bindCluster({
			connectionId: 'c1',
			clusterId: 'cl-1',
			setId: exact.id,
			connectionName: 'А',
			clusterName: 'Кластер',
		});

		assert.strictEqual((await store.resolveClusterAdmin('c1', 'cl-1'))?.user, 'exact');
		assert.strictEqual((await store.resolveClusterAdmin('c1', 'cl-2'))?.user, 'conn');
		assert.strictEqual(await store.resolveClusterAdmin('c2', 'cl-1'), undefined);

		await store.unbindCluster('c1', 'cl-1');
		assert.strictEqual((await store.resolveClusterAdmin('c1', 'cl-1'))?.user, 'conn');
	});

	test('пустой выбор снимает привязку подключения, удаление набора — тоже', async () => {
		const store = storeOn();
		const added = await store.add({ name: 'Тест', user: 'Тест', kind: 'agent' }, '1');
		await store.bindConnectionRole('c1', 'agent', added.id);
		assert.strictEqual(store.boundConnectionSet('c1', 'agent')?.id, added.id);

		await store.bindConnectionRole('c1', 'agent', '');
		assert.strictEqual(store.boundConnectionSet('c1', 'agent'), undefined);

		await store.bindConnectionRole('c1', 'agent', added.id);
		await store.remove(added.id);
		assert.strictEqual(store.boundConnectionSet('c1', 'agent'), undefined);
	});

	test('удаление набора снимает привязки и пароль', async () => {
		const secrets = new FakeSecrets();
		const store = storeOn(new FakeMemento(), secrets);
		const added = await store.add({ name: 'Тест', user: 'Тест', kind: 'cluster' }, '123');
		await store.bindInfobase({
			connectionId: 'c1',
			clusterId: 'cl',
			infobaseId: 'ib',
			setId: added.id,
			connectionName: 'Локальный',
			infobaseName: 'ib',
		});
		await store.bindCluster({
			connectionId: 'c1',
			clusterId: 'cl',
			setId: added.id,
			connectionName: 'Локальный',
			clusterName: 'Кластер',
		});

		await store.remove(added.id);

		assert.strictEqual(store.list().length, 0);
		assert.strictEqual(store.listBindings().length, 0);
		assert.strictEqual(store.listClusterBindings().length, 0);
		assert.strictEqual(await store.password(added.id), undefined);
	});

	test('удаление подключения снимает только его привязки', async () => {
		const store = storeOn();
		const added = await store.add({ name: 'Тест', user: 'Тест', kind: 'infobase' }, '1');
		await store.bindInfobase({
			connectionId: 'c1',
			clusterId: 'cl',
			infobaseId: 'ib1',
			setId: added.id,
			connectionName: 'А',
			infobaseName: 'ib1',
		});
		await store.bindInfobase({
			connectionId: 'c2',
			clusterId: 'cl',
			infobaseId: 'ib2',
			setId: added.id,
			connectionName: 'Б',
			infobaseName: 'ib2',
		});
		await store.bindConnectionRole('c1', 'cluster', added.id);
		await store.bindCluster({
			connectionId: 'c1',
			clusterId: 'cl',
			setId: added.id,
			connectionName: 'А',
			clusterName: 'Кластер',
		});

		await store.forgetConnection('c1');

		assert.strictEqual(store.listBindings().length, 1);
		assert.strictEqual(store.listBindings()[0].connectionId, 'c2');
		assert.strictEqual(store.boundConnectionSet('c1', 'cluster'), undefined);
		assert.strictEqual(store.listClusterBindings().length, 0);
	});
});

suite('наборы учётных данных: отбор по роли', () => {
	test('список с ролью отдаёт только её наборы', async () => {
		const store = storeOn();
		await store.add({ name: 'Кластер', user: 'Админ', kind: 'cluster' }, '1');
		await store.add({ name: 'База', user: 'Админ', kind: 'infobase' }, '2');

		assert.deepStrictEqual(store.list('infobase').map((set) => set.name), ['База']);
		assert.strictEqual(store.list().length, 2);
	});
});
