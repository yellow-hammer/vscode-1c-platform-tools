import * as assert from 'node:assert';
import {
	ConnectionStore,
	normalizeStoredConnection,
	parseRasAddress,
	parseRasPort,
} from '../../features/clusters/connectionStore';
import { CONNECTIONS_STATE_KEY, SYNCED_STATE_KEYS } from '../../features/clusters/constants';

suite('подключения к кластерам: разбор ввода', () => {
	test('адрес без порта получает порт платформы', () => {
		assert.deepStrictEqual(parseRasAddress('srv-1c'), { host: 'srv-1c', port: 1545 });
	});

	test('адрес с портом разбирается на части', () => {
		assert.deepStrictEqual(parseRasAddress('srv-1c:1745'), { host: 'srv-1c', port: 1745 });
	});

	test('лишние пробелы и схема отбрасываются', () => {
		assert.deepStrictEqual(parseRasAddress('  tcp://srv-1c:1545  '), {
			host: 'srv-1c',
			port: 1545,
		});
	});

	test('адрес IPv6 в скобках сохраняется целиком', () => {
		assert.deepStrictEqual(parseRasAddress('[fe80::1]:1545'), { host: '[fe80::1]', port: 1545 });
	});

	test('пустая строка и запредельный порт не принимаются', () => {
		assert.strictEqual(parseRasAddress(''), undefined);
		assert.strictEqual(parseRasAddress('   '), undefined);
		assert.strictEqual(parseRasAddress('srv-1c:99999'), undefined);
	});

	test('порт по умолчанию подставляется для пустого значения', () => {
		assert.strictEqual(parseRasPort(''), 1545);
		assert.strictEqual(parseRasPort('1745'), 1745);
		assert.strictEqual(parseRasPort('нет'), undefined);
		assert.strictEqual(parseRasPort('0'), undefined);
	});
});

suite('подключения к кластерам: записи файла', () => {
	test('запись без хоста бесполезна и отбрасывается', () => {
		assert.strictEqual(normalizeStoredConnection({ name: 'Без адреса' }, 0), undefined);
	});

	test('запись без порта получает порт платформы, без имени — адрес', () => {
		const connection = normalizeStoredConnection({ host: 'srv-1c' }, 0);

		assert.deepStrictEqual(connection, {
			id: 'connection-1',
			name: 'srv-1c:1545',
			host: 'srv-1c',
			port: 1545,
			platformVersion: undefined,
		});
	});

	test('пустая версия не превращается в пустую строку', () => {
		const connection = normalizeStoredConnection({ host: 'srv-1c', platformVersion: '' }, 0);

		assert.strictEqual(connection?.platformVersion, undefined);
	});
});

/** Память вместо глобального состояния VS Code: тому нужен живой воркбенч. */
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

/** Хранилище поверх подставного состояния. */
function storeOn(state: FakeMemento): ConnectionStore {
	return new ConnectionStore(state as unknown as ConstructorParameters<typeof ConnectionStore>[0]);
}

suite('подключения к кластерам: хранилище', () => {
	test('пустое состояние — не ошибка: подключений просто нет', () => {
		assert.strictEqual(storeOn(new FakeMemento()).isEmpty(), true);
	});

	test('список помечен для синхронизации вместе с наборами: VS Code берёт ключи одним списком', () => {
		const state = new FakeMemento();
		storeOn(state);

		assert.deepStrictEqual(state.synced, [...SYNCED_STATE_KEYS]);
		assert.ok(state.synced.includes(CONNECTIONS_STATE_KEY));
	});

	test('добавленное подключение читается новым хранилищем', async () => {
		const state = new FakeMemento();
		const store = storeOn(state);
		const added = await store.add({
			name: 'Локальный',
			host: 'localhost',
			port: 1545,
		});

		const restored = storeOn(state).get(added.id);

		assert.strictEqual(restored?.name, 'Локальный');
		assert.strictEqual(restored?.host, 'localhost');
	});

	test('пароля в сохранённом списке нет: он живёт в защищённом хранилище', async () => {
		const state = new FakeMemento();
		const store = storeOn(state);
		await store.add({ name: 'Локальный', host: 'localhost', port: 1545 });

		const raw = JSON.stringify(state.get(CONNECTIONS_STATE_KEY, []));

		assert.ok(!raw.toLowerCase().includes('pwd'));
		assert.ok(!raw.toLowerCase().includes('password'));
	});

	test('идентификатор не повторяется после удаления', async () => {
		const store = storeOn(new FakeMemento());
		const first = await store.add({ name: 'Первый', host: 'srv-1', port: 1545 });
		const second = await store.add({ name: 'Второй', host: 'srv-2', port: 1545 });
		await store.remove(first.id);

		const third = await store.add({ name: 'Третий', host: 'srv-3', port: 1545 });

		assert.notStrictEqual(third.id, first.id);
		assert.notStrictEqual(third.id, second.id);
	});

	test('изменение подключения сохраняется', async () => {
		const state = new FakeMemento();
		const store = storeOn(state);
		const added = await store.add({ name: 'Локальный', host: 'localhost', port: 1545 });

		await store.update(added.id, { name: 'Боевой', host: 'srv-1c', port: 1745 });

		const reopened = storeOn(state);
		assert.strictEqual(reopened.get(added.id)?.name, 'Боевой');
		assert.strictEqual(reopened.get(added.id)?.port, 1745);
	});

	test('битая запись пропускается, остальные читаются', async () => {
		const state = new FakeMemento();
		await state.update(CONNECTIONS_STATE_KEY, [
			{ name: 'Без адреса' },
			{ name: 'Рабочий', host: 'srv-1c', port: 1545 },
		]);

		const store = storeOn(state);

		assert.strictEqual(store.list().length, 1);
		assert.strictEqual(store.list()[0].name, 'Рабочий');
	});

	test('состояние не массивом не роняет расширение', async () => {
		const state = new FakeMemento();
		await state.update(CONNECTIONS_STATE_KEY, { сломано: true });

		assert.strictEqual(storeOn(state).isEmpty(), true);
	});
});
