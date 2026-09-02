import * as assert from 'node:assert';
import { ClusterService } from '../../features/clusters/clusterService';
import { ClusterCredentialStore } from '../../features/clusters/credentials';
import type { MissingCredentialsEvent } from '../../features/clusters/credentialsNotify';
import type { ClusterConnection } from '../../features/clusters/model';
import type { RacClient, RacResult } from '../../features/clusters/racClient';
import { describeRacFailure } from '../../features/clusters/racOutput';

/** Память вместо глобального состояния VS Code. */
class FakeMemento {
	private data = new Map<string, unknown>();

	setKeysForSync(): void {}

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

/** Подставной rac: запоминает аргументы и отвечает заготовленным итогом. */
class FakeRacClient {
	readonly calls: string[][] = [];

	constructor(private readonly answer: (args: string[]) => RacResult) {}

	run(args: string[]): Promise<RacResult> {
		this.calls.push(args);
		return Promise.resolve(this.answer(args));
	}
}

const CONNECTION: ClusterConnection = { id: 'connection-1', name: 'Тест', host: 'srv-1c', port: 1545 };
const CLUSTER = '0e588a25-8354-4d1d-9dd3-f2fa2a1c6b8b';
const INFOBASE = 'ib-1';

function accepted(records: Record<string, string>[] = []): RacResult {
	return { ok: true, records, stdout: '' };
}

function refused(wording: string): RacResult {
	return { ok: false, failure: describeRacFailure(1, '', wording) };
}

interface Harness {
	service: ClusterService;
	client: FakeRacClient;
	credentials: ClusterCredentialStore;
	events: MissingCredentialsEvent[];
}

function harness(answer: (args: string[]) => RacResult): Harness {
	const client = new FakeRacClient(answer);
	const credentials = new ClusterCredentialStore(
		new FakeMemento() as unknown as ConstructorParameters<typeof ClusterCredentialStore>[0],
		new FakeSecrets() as unknown as ConstructorParameters<typeof ClusterCredentialStore>[1]
	);
	const events: MissingCredentialsEvent[] = [];
	const service = new ClusterService(client as unknown as RacClient, credentials, (event) =>
		events.push(event)
	);
	return { service, client, credentials, events };
}

suite('сервис кластера: учётные данные базы', () => {
	test('соединения базы читаются с привязанным набором базы', async () => {
		const { service, client, credentials } = harness(() => accepted());
		const set = await credentials.add({ name: 'База', user: 'Админ', kind: 'infobase' }, 'pwd');
		await credentials.bindInfobase({
			connectionId: CONNECTION.id,
			clusterId: CLUSTER,
			infobaseId: INFOBASE,
			setId: set.id,
			connectionName: CONNECTION.name,
			infobaseName: 'Учёт',
		});

		const result = await service.listConnections(CONNECTION, CLUSTER, {
			infobaseId: INFOBASE,
			infobaseName: 'Учёт',
		});

		assert.strictEqual(result.ok, true);
		const args = client.calls[0];
		assert.ok(args.includes('--infobase=ib-1'));
		assert.ok(args.includes('--infobase-user=Админ'));
		assert.ok(args.includes('--infobase-pwd=pwd'));
	});

	test('без привязки соединения базы идут без набора, а отказ ведёт к уведомлению о базе', async () => {
		const { service, client, events } = harness(() =>
			refused('Недостаточно прав пользователя на информационную базу')
		);

		const result = await service.listConnections(CONNECTION, CLUSTER, {
			infobaseId: INFOBASE,
			infobaseName: 'Учёт',
		});

		assert.ok(!client.calls[0].some((arg) => arg.startsWith('--infobase-user=')));
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.failure.role, 'infobase');
		}
		assert.deepStrictEqual(events, [{ kind: 'infobaseMissing', infobaseName: 'Учёт' }]);
	});

	test('соединения всего кластера набора базы не требуют', async () => {
		const { service, client } = harness(() => accepted());

		await service.listConnections(CONNECTION, CLUSTER);

		assert.ok(!client.calls[0].some((arg) => arg.startsWith('--infobase')));
	});

	test('отказ администратора кластера при чтении базы не приписывается базе', async () => {
		const { service, events } = harness(() => refused('Администратор кластера не аутентифицирован'));

		const result = await service.infobaseDetails(CONNECTION, CLUSTER, INFOBASE, 'Учёт');

		assert.strictEqual(result.ok, false);
		assert.deepStrictEqual(events, [{ kind: 'clusterMissing' }]);
	});
});

suite('сервис кластера: роли отказов', () => {
	test('список администраторов центрального сервера жалуется на его набор, а не на набор кластера', async () => {
		const { service, events } = harness(() => refused('Администратор кластера не аутентифицирован'));

		const result = await service.listAgentAdmins(CONNECTION);

		assert.deepStrictEqual(events, [{ kind: 'agentMissing' }]);
		assert.ok(!result.ok && result.failure.message.includes('центрального сервера'));
	});

	test('набор, привязанный к кластеру, считается заданным: отказ — «не принят», а не «нет»', async () => {
		const { service, credentials, events } = harness(() =>
			refused('Администратор кластера не аутентифицирован')
		);
		const set = await credentials.add({ name: 'Кластер', user: 'Админ', kind: 'cluster' }, 'pwd');
		await credentials.bindCluster({
			connectionId: CONNECTION.id,
			clusterId: CLUSTER,
			setId: set.id,
			connectionName: CONNECTION.name,
			clusterName: 'Кластер',
		});

		await service.listInfobases(CONNECTION, CLUSTER);

		assert.deepStrictEqual(events, [{ kind: 'clusterRejected' }]);
	});

	test('правка кластера без набора центрального сервера уходит без его опций', async () => {
		const { service, client } = harness(() => accepted());

		const result = await service.updateCluster(CONNECTION, CLUSTER, { name: 'Основной' });

		assert.strictEqual(result.ok, true);
		assert.ok(client.calls[0].includes('--name=Основной'));
		assert.ok(!client.calls[0].some((arg) => arg.startsWith('--agent-user=')));
	});

	test('отказ при правке кластера ведёт к уведомлению о центральном сервере', async () => {
		const { service, events } = harness(() =>
			refused('Администратор центрального сервера не аутентифицирован')
		);

		await service.updateCluster(CONNECTION, CLUSTER, { name: 'Основной' });

		assert.deepStrictEqual(events, [{ kind: 'agentMissing' }]);
	});
});
