import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { activityKinds, activityRequest } from '../../features/clusters/activityRequest';
import {
	ClusterNode,
	ConnectionNode,
	GroupNode,
	InfobaseNode,
	GROUP_TABLE_CONTEXT,
	type GroupKind,
} from '../../features/clusters/nodes';
import type { ClusterConnection, ClusterInfo, InfobaseInfo } from '../../features/clusters/model';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

const CONNECTION: ClusterConnection = {
	id: 'conn',
	name: 'Рабочий сервер',
	host: 'localhost',
	port: 1545,
};

const CLUSTER: ClusterInfo = {
	id: 'cluster',
	name: 'Локальный кластер',
	host: 'legion',
	port: '1541',
	record: {},
};

const INFOBASE: InfobaseInfo = { id: 'ib', name: 'Бухгалтерия', descr: '', record: {} };

/**
 * Группа кластера.
 *
 * @param kind - Вид группы
 * @returns Узел группы уровня кластера
 */
function clusterGroup(kind: GroupKind): GroupNode {
	return new GroupNode(CONNECTION, CLUSTER.id, kind, { clusterName: CLUSTER.name });
}

/**
 * Группа информационной базы.
 *
 * @param kind - Вид группы
 * @returns Узел группы внутри базы
 */
function infobaseGroup(kind: GroupKind): GroupNode {
	return new GroupNode(CONNECTION, CLUSTER.id, kind, {
		infobaseId: INFOBASE.id,
		infobaseName: INFOBASE.name,
	});
}

suite('панель списков: что открывает узел', () => {
	test('кластер открывает список баз', () => {
		const request = activityRequest(new ClusterNode(CONNECTION, CLUSTER));

		assert.strictEqual(request?.kind, 'infobases');
		assert.strictEqual(request?.target.infobaseId, undefined);
		assert.strictEqual(request?.target.title, 'Локальный кластер');
	});

	test('база открывает свои сеансы', () => {
		const request = activityRequest(new InfobaseNode(CONNECTION, CLUSTER.id, INFOBASE));

		assert.strictEqual(request?.kind, 'sessions');
		assert.strictEqual(request?.target.infobaseId, 'ib');
		assert.strictEqual(request?.target.title, 'Бухгалтерия');
	});

	test('группа открывает свой список', () => {
		const kinds: Array<[GroupKind, string]> = [
			['infobases', 'infobases'],
			['sessions', 'sessions'],
			['connections', 'connections'],
			['locks', 'locks'],
		];

		for (const [group, expected] of kinds) {
			assert.strictEqual(activityRequest(clusterGroup(group))?.kind, expected, group);
		}
	});

	test('группа кластера и сам кластер открывают панель с тем же заголовком', () => {
		const fromCluster = activityRequest(new ClusterNode(CONNECTION, CLUSTER));
		const fromGroup = activityRequest(clusterGroup('sessions'));

		assert.strictEqual(fromGroup?.target.title, fromCluster?.target.title);
		assert.strictEqual(fromGroup?.target.clusterId, fromCluster?.target.clusterId);
	});

	test('группа базы отбирает по базе', () => {
		const request = activityRequest(infobaseGroup('locks'));

		assert.strictEqual(request?.kind, 'locks');
		assert.strictEqual(request?.target.infobaseId, 'ib');
		assert.strictEqual(request?.target.title, 'Бухгалтерия');
	});

	test('группы без таблицы не открываются', () => {
		// Соединения процесса таблица отобрать не умеет: отбор идёт по кластеру и
		// базе. Серверы, процессы, менеджеры и администраторы сравнивать нечем.
		const processConnections = new GroupNode(CONNECTION, CLUSTER.id, 'connections', {
			processId: 'process',
		});
		const serverProcesses = new GroupNode(CONNECTION, CLUSTER.id, 'processes', {
			serverId: 'server',
		});

		assert.strictEqual(activityRequest(processConnections), undefined);
		assert.strictEqual(activityRequest(serverProcesses), undefined);
		assert.strictEqual(activityRequest(clusterGroup('servers')), undefined);
		assert.strictEqual(activityRequest(clusterGroup('managers')), undefined);
		assert.strictEqual(activityRequest(clusterGroup('clusterAdmins')), undefined);
	});

	test('подключение таблицей не открывается', () => {
		assert.strictEqual(activityRequest(new ConnectionNode(CONNECTION)), undefined);
	});

	test('стартовая вкладка — первая вкладка области', () => {
		assert.strictEqual(
			activityKinds({ connection: CONNECTION, clusterId: 'cluster', title: 'Кластер' })[0],
			'infobases'
		);
		assert.strictEqual(
			activityKinds({
				connection: CONNECTION,
				clusterId: 'cluster',
				infobaseId: 'ib',
				title: 'База',
			})[0],
			'sessions'
		);
	});
});

suite('группы дерева: чем открываются списки', () => {
	test('клик по группе ничего не открывает', () => {
		// Единое поведение узлов дерева: клик выделяет и раскрывает, действия — на
		// кнопках и в контекстном меню.
		for (const kind of ['infobases', 'sessions', 'connections', 'locks'] as GroupKind[]) {
			assert.strictEqual(clusterGroup(kind).command, undefined, kind);
			assert.strictEqual(infobaseGroup(kind === 'infobases' ? 'sessions' : kind).command, undefined);
		}
	});

	test('признак таблицы стоит только у групп со списком', () => {
		assert.ok(clusterGroup('infobases').contextValue?.includes(GROUP_TABLE_CONTEXT));
		assert.ok(clusterGroup('sessions').contextValue?.includes(GROUP_TABLE_CONTEXT));
		assert.ok(clusterGroup('connections').contextValue?.includes(GROUP_TABLE_CONTEXT));
		assert.ok(clusterGroup('locks').contextValue?.includes(GROUP_TABLE_CONTEXT));
		assert.ok(infobaseGroup('sessions').contextValue?.includes(GROUP_TABLE_CONTEXT));

		assert.strictEqual(clusterGroup('servers').contextValue, 'clusterGroup.servers');
		assert.strictEqual(clusterGroup('clusterAdmins').contextValue, 'clusterGroup.clusterAdmins');
		assert.strictEqual(
			new GroupNode(CONNECTION, CLUSTER.id, 'connections', { processId: 'process' }).contextValue,
			'clusterGroup.connections'
		);
	});

	test('кнопка списков объявлена в манифесте для этого признака', () => {
		// Признак в contextValue и условие меню — одна договорённость: разъехавшись,
		// они молча убирают кнопку из дерева.
		const manifest = JSON.parse(
			fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')
		) as {
			contributes: { menus: Record<string, Array<{ command?: string; when?: string }>> };
		};
		const entries = manifest.contributes.menus['view/item/context'].filter(
			(entry) =>
				entry.command === '1c-platform-tools.clusters.showActivity' &&
				(entry.when ?? '').includes(GROUP_TABLE_CONTEXT)
		);

		assert.strictEqual(entries.length, 1);
	});
});
