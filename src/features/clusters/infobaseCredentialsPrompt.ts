/** Выбор или создание администратора ИБ при открытии её свойств. */

import * as vscode from 'vscode';
import type { ClusterCredentialStore } from './credentials';
import type { InfobaseNode } from './nodes';

/** Возвращает true, если для базы назначен набор и чтение можно повторить. */
export async function promptInfobaseCredentials(
	credentials: ClusterCredentialStore,
	node: InfobaseNode
): Promise<boolean> {
	const sets = credentials.list('infobase');
	const picked = await vscode.window.showQuickPick(
		[
			...sets.map((set) => ({ label: set.name, description: set.user, setId: set.id })),
			{ label: '$(add) Создать новый набор учётных данных', description: '', setId: '' },
		],
		{ title: `Учётные данные для базы «${node.infobase.name}»`, placeHolder: 'Выберите сохранённый набор или создайте новый' }
	);
	if (!picked) {
		return false;
	}

	let setId = picked.setId;
	if (!setId) {
		const name = await vscode.window.showInputBox({
			title: 'Новый набор: название',
			prompt: 'Название для списка учётных данных',
			validateInput: (value) => value.trim() ? undefined : 'Введите название',
		});
		if (name === undefined) {
			return false;
		}
		const user = await vscode.window.showInputBox({
			title: 'Новый набор: пользователь',
			prompt: 'Имя администратора информационной базы',
			validateInput: (value) => value.trim() ? undefined : 'Введите имя пользователя',
		});
		if (user === undefined) {
			return false;
		}
		const password = await vscode.window.showInputBox({
			title: 'Новый набор: пароль',
			prompt: 'Оставьте пустым, если у администратора нет пароля',
			password: true,
		});
		if (password === undefined) {
			return false;
		}
		setId = (await credentials.add({ name, user, kind: 'infobase' }, password)).id;
	}

	await credentials.bindInfobase({
		connectionId: node.connection.id,
		clusterId: node.clusterId,
		infobaseId: node.infobase.id,
		setId,
		connectionName: node.connection.name,
		infobaseName: node.infobase.name,
	});
	return true;
}
