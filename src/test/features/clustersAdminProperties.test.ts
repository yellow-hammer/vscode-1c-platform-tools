import * as assert from 'node:assert';
import {
	adminSections,
	toAdminForm,
	toAdminRegistration,
	validateAdminForm,
} from '../../features/clusters/adminProperties';

/** Администратор в том виде, в каком его отдаёт платформа. */
const ADMIN = {
	name: 'rac2',
	auth: 'pwd',
	osUser: '',
	descr: 'Администратор кластера',
	record: {},
};

suite('карточка администратора: поля', () => {
	test('при правке имя не редактируется: иначе платформа заведёт вторую запись', () => {
		const editing = adminSections(true)[0].fields[0];
		const creating = adminSections(false)[0].fields[0];

		assert.strictEqual(editing.kind, 'readonly');
		assert.strictEqual(creating.kind, 'text');
	});

	test('пароль в форму не подставляется: платформа его не отдаёт', () => {
		assert.strictEqual(toAdminForm(ADMIN).pwd, '');
	});

	test('способы входа читаются из строки аутентификации', () => {
		const both = toAdminForm({ ...ADMIN, auth: 'pwd,os', osUser: 'DOMAIN\\user' });

		assert.strictEqual(both['auth-pwd'], 'on');
		assert.strictEqual(both['auth-os'], 'on');
		assert.strictEqual(both['os-user'], 'DOMAIN\\user');
	});

	test('у нового администратора парольный вход включён по умолчанию', () => {
		const values = toAdminForm();

		assert.strictEqual(values['auth-pwd'], 'on');
		assert.strictEqual(values['auth-os'], 'off');
		assert.strictEqual(values.name, '');
	});
});

suite('карточка администратора: проверка ввода', () => {
	test('без имени сохранять нечего', () => {
		assert.ok(validateAdminForm({ ...toAdminForm(), name: '  ' })[0].includes('Имя'));
	});

	test('нужен хотя бы один способ входа', () => {
		const values = { ...toAdminForm(ADMIN), 'auth-pwd': 'off', 'auth-os': 'off' };

		assert.ok(validateAdminForm(values)[0].includes('способ входа'));
	});

	test('вход средствами ОС требует пользователя', () => {
		const values = { ...toAdminForm(ADMIN), 'auth-os': 'on', 'os-user': '' };

		assert.ok(validateAdminForm(values).some((item) => item.includes('Пользователь операционной системы')));
	});
});

suite('карточка администратора: отправка', () => {
	test('способ входа собирается из флажков', () => {
		const base = toAdminForm(ADMIN);

		assert.strictEqual(toAdminRegistration(base).auth, 'pwd');
		assert.strictEqual(
			toAdminRegistration({ ...base, 'auth-os': 'on', 'os-user': 'user' }).auth,
			'pwd,os'
		);
		assert.strictEqual(
			toAdminRegistration({ ...base, 'auth-pwd': 'off', 'auth-os': 'on', 'os-user': 'user' }).auth,
			'os'
		);
	});

	test('без парольного входа пароль не отправляется', () => {
		const values = { ...toAdminForm(ADMIN), 'auth-pwd': 'off', 'auth-os': 'on', 'os-user': 'user' };

		assert.strictEqual(toAdminRegistration(values).password, undefined);
	});

	test('пользователь ОС уходит только при входе средствами ОС', () => {
		const values = { ...toAdminForm(ADMIN), 'os-user': 'user' };

		assert.strictEqual(toAdminRegistration(values).osUser, undefined);
	});
});
