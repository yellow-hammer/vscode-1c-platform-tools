import * as assert from 'node:assert';
import { gitConfigArgs } from '../../commands/dependenciesCommands';

suite('Аргументы git config', () => {
	test('флаг области идёт после подкоманды', () => {
		assert.deepStrictEqual(
			gitConfigArgs(['--global'], 'user.name', 'Иван'),
			['config', '--global', 'user.name', 'Иван'],
			'git config --global …; перед подкомандой git считает флаг своей опцией и падает'
		);
	});

	test('без области настройка пишется в текущий репозиторий', () => {
		assert.deepStrictEqual(gitConfigArgs([], 'core.autocrlf', 'true'), ['config', 'core.autocrlf', 'true']);
	});

	test('значение с пробелами остаётся одним аргументом', () => {
		assert.deepStrictEqual(
			gitConfigArgs(['--global'], 'mergetool.vscode.cmd', 'code --wait $MERGED'),
			['config', '--global', 'mergetool.vscode.cmd', 'code --wait $MERGED']
		);
	});
});
