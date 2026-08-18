import * as assert from 'node:assert';
import {
	buildClusterInfoArgs,
	buildClusterListArgs,
	buildConnectionDisconnectArgs,
	buildConnectionListArgs,
	buildInfobaseInfoArgs,
	buildInfobaseListArgs,
	buildInfobaseUpdateArgs,
	buildLockListArgs,
	buildProcessListArgs,
	buildServerListArgs,
	buildProcessTurnOffArgs,
	buildSessionInterruptArgs,
	buildSessionListArgs,
	buildSessionTerminateArgs,
	credentialOptions,
	formatRacDate,
	racAddress,
} from '../../features/clusters/racArgs';

const ADDRESS = 'srv-1c:1545';
const CLUSTER = '0e588a25-8354-4d1d-9dd3-f2fa2a1c6b8b';
const ADMIN = { user: 'Администратор', password: 'secret' };

suite('аргументы rac: общее', () => {
	test('адрес собирается из хоста и порта', () => {
		assert.strictEqual(racAddress('srv-1c', 1545), 'srv-1c:1545');
	});

	test('адрес идёт первым аргументом: у rac это позиционный параметр', () => {
		const args = buildSessionListArgs({ address: ADDRESS, clusterId: CLUSTER, cluster: ADMIN });

		assert.strictEqual(args[0], ADDRESS);
	});

	test('за адресом идут режим и команда', () => {
		const args = buildClusterListArgs({ address: ADDRESS });

		assert.deepStrictEqual(args, [ADDRESS, 'cluster', 'list']);
	});

	test('без имени администратора опции аутентификации не добавляются', () => {
		assert.deepStrictEqual(credentialOptions('cluster', undefined), []);
		assert.deepStrictEqual(credentialOptions('cluster', { user: '   ' }), []);
	});

	test('администратор без пароля даёт опцию с пустым значением', () => {
		assert.deepStrictEqual(credentialOptions('cluster', { user: 'admin' }), [
			'--cluster-user=admin',
			'--cluster-pwd=',
		]);
	});

	test('дата блокировки записывается местным временем без часового пояса', () => {
		const date = new Date(2024, 4, 1, 10, 15, 30);

		assert.strictEqual(formatRacDate(date), '2024-05-01T10:15:30');
	});
});

suite('аргументы rac: кластер и серверы', () => {
	test('информация о кластере идёт без администратора: у команды нет таких опций', () => {
		const args = buildClusterInfoArgs({ address: ADDRESS, clusterId: CLUSTER, cluster: ADMIN });

		assert.deepStrictEqual(args, [ADDRESS, 'cluster', 'info', `--cluster=${CLUSTER}`]);
	});

	test('список рабочих серверов', () => {
		const args = buildServerListArgs({ address: ADDRESS, clusterId: CLUSTER });

		assert.deepStrictEqual(args, [ADDRESS, 'server', 'list', `--cluster=${CLUSTER}`]);
	});

	test('список процессов сужается сервером, если он задан', () => {
		const all = buildProcessListArgs({ address: ADDRESS, clusterId: CLUSTER });
		const scoped = buildProcessListArgs({ address: ADDRESS, clusterId: CLUSTER, serverId: 'srv-id' });

		assert.ok(!all.some((arg) => arg.startsWith('--server=')));
		assert.ok(scoped.includes('--server=srv-id'));
	});
});

suite('аргументы rac: информационные базы', () => {
	test('дерево строится по краткому списку баз', () => {
		const args = buildInfobaseListArgs({ address: ADDRESS, clusterId: CLUSTER });

		assert.deepStrictEqual(args, [
			ADDRESS,
			'infobase',
			'summary',
			'list',
			`--cluster=${CLUSTER}`,
		]);
	});

	test('полная информация о базе принимает администратора базы', () => {
		const args = buildInfobaseInfoArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			cluster: ADMIN,
			infobaseId: 'ib-id',
			infobase: { user: 'ibadmin', password: 'ibpwd' },
		});

		assert.deepStrictEqual(args, [
			ADDRESS,
			'infobase',
			'info',
			`--cluster=${CLUSTER}`,
			'--cluster-user=Администратор',
			'--cluster-pwd=secret',
			'--infobase=ib-id',
			'--infobase-user=ibadmin',
			'--infobase-pwd=ibpwd',
		]);
	});

	test('обновление базы включает только заданные поля', () => {
		const args = buildInfobaseUpdateArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			infobaseId: 'ib-id',
			update: { sessionsDeny: true, deniedMessage: 'Идёт обслуживание', permissionCode: 'KeyCode' },
		});

		assert.deepStrictEqual(args, [
			ADDRESS,
			'infobase',
			'update',
			`--cluster=${CLUSTER}`,
			'--infobase=ib-id',
			'--sessions-deny=on',
			'--denied-message=Идёт обслуживание',
			'--permission-code=KeyCode',
		]);
	});

	test('снятие блокировки не трогает сообщение и код разрешения', () => {
		const args = buildInfobaseUpdateArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			infobaseId: 'ib-id',
			update: { sessionsDeny: false },
		});

		assert.ok(args.includes('--sessions-deny=off'));
		assert.ok(!args.some((arg) => arg.startsWith('--denied-message')));
		assert.ok(!args.some((arg) => arg.startsWith('--permission-code')));
	});

	test('блокировка регламентных заданий задаётся отдельно от сеансов', () => {
		const args = buildInfobaseUpdateArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			infobaseId: 'ib-id',
			update: { scheduledJobsDeny: true },
		});

		assert.ok(args.includes('--scheduled-jobs-deny=on'));
		assert.ok(!args.some((arg) => arg.startsWith('--sessions-deny')));
	});

	test('пустое сообщение блокировки передаётся, если задано явно', () => {
		const args = buildInfobaseUpdateArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			infobaseId: 'ib-id',
			update: { deniedMessage: '' },
		});

		assert.ok(args.includes('--denied-message='));
	});
});

suite('аргументы rac: сеансы, соединения, блокировки', () => {
	test('список сеансов сужается базой', () => {
		const args = buildSessionListArgs({ address: ADDRESS, clusterId: CLUSTER, infobaseId: 'ib-id' });

		assert.deepStrictEqual(args, [
			ADDRESS,
			'session',
			'list',
			`--cluster=${CLUSTER}`,
			'--infobase=ib-id',
		]);
	});

	test('завершение сеанса требует его идентификатор', () => {
		const args = buildSessionTerminateArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			sessionId: 'session-id',
		});

		assert.deepStrictEqual(args, [
			ADDRESS,
			'session',
			'terminate',
			`--cluster=${CLUSTER}`,
			'--session=session-id',
		]);
	});

	test('сообщение при завершении сеанса уходит только когда задано', () => {
		const silent = buildSessionTerminateArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			sessionId: 'session-id',
		});
		const spoken = buildSessionTerminateArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			sessionId: 'session-id',
			errorMessage: 'Идёт обслуживание',
		});

		// Опция появилась в платформе позже команды: на старой версии лишняя опция
		// завалила бы разбор параметров
		assert.ok(!silent.some((arg) => arg.startsWith('--error-message')));
		assert.ok(spoken.includes('--error-message=Идёт обслуживание'));
	});

	test('прерывание вызова адресуется сеансу, а не соединению', () => {
		const args = buildSessionInterruptArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			sessionId: 'session-id',
		});

		assert.deepStrictEqual(args, [
			ADDRESS,
			'session',
			'interrupt-current-server-call',
			`--cluster=${CLUSTER}`,
			'--session=session-id',
		]);
	});

	test('выключение рабочего процесса требует его идентификатор', () => {
		const args = buildProcessTurnOffArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			processId: 'proc-id',
		});

		assert.deepStrictEqual(args, [
			ADDRESS,
			'process',
			'turn-off',
			`--cluster=${CLUSTER}`,
			'--process=proc-id',
		]);
	});

	test('список соединений принимает отбор по процессу и базе', () => {
		const args = buildConnectionListArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			processId: 'proc-id',
			infobaseId: 'ib-id',
		});

		assert.ok(args.includes('--process=proc-id'));
		assert.ok(args.includes('--infobase=ib-id'));
	});

	test('разрыв соединения передаёт и процесс, и соединение', () => {
		const args = buildConnectionDisconnectArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			processId: 'proc-id',
			connectionId: 'conn-id',
		});

		assert.deepStrictEqual(args, [
			ADDRESS,
			'connection',
			'disconnect',
			`--cluster=${CLUSTER}`,
			'--process=proc-id',
			'--connection=conn-id',
		]);
	});

	test('список блокировок можно сузить базой', () => {
		const args = buildLockListArgs({ address: ADDRESS, clusterId: CLUSTER, infobaseId: 'ib-id' });

		assert.deepStrictEqual(args, [
			ADDRESS,
			'lock',
			'list',
			`--cluster=${CLUSTER}`,
			'--infobase=ib-id',
		]);
	});

	test('значения с пробелами уходят одним аргументом: оболочка не участвует', () => {
		const args = buildInfobaseUpdateArgs({
			address: ADDRESS,
			clusterId: CLUSTER,
			infobaseId: 'ib-id',
			update: { deniedMessage: 'Обновление до 3.0.155 «Бухгалтерия»' },
		});

		assert.ok(args.includes('--denied-message=Обновление до 3.0.155 «Бухгалтерия»'));
	});
});
