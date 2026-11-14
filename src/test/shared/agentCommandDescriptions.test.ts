import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { AGENT_COMMAND_DESCRIPTIONS, agentCommandDescription } from '../../shared/agentCommandDescriptions';
import { isCommandExposedToMcp } from '../../shared/mcpCommandPolicy';

/** Команды расширения, объявленные в package.json. */
function declaredCommands(): Set<string> {
	const pkgPath = path.resolve(__dirname, '../../../package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
		contributes: { commands: Array<{ command: string }> };
	};
	return new Set(pkg.contributes.commands.map((command) => command.command));
}

/** Команды, которых нет в палитре: регистрируются в коде фич. */
const UNDECLARED = [
	'1c-platform-tools.env.status',
	'1c-platform-tools.epf.run',
	'1c-platform-tools.env.refreshVersion',
];

suite('agentCommandDescriptions', () => {
	test('описания заведены только для существующих команд', () => {
		const declared = declaredCommands();
		for (const id of Object.keys(AGENT_COMMAND_DESCRIPTIONS)) {
			assert.ok(
				declared.has(id) || UNDECLARED.includes(id),
				`команда ${id} не объявлена в package.json и не входит в список команд без палитры`
			);
		}
	});

	test('описания заведены только для команд, доступных агенту', () => {
		for (const id of Object.keys(AGENT_COMMAND_DESCRIPTIONS)) {
			assert.strictEqual(isCommandExposedToMcp(id), true, `команда ${id} скрыта от агента`);
		}
	});

	test('описание объясняет действие, а не повторяет имя команды', () => {
		for (const [id, description] of Object.entries(AGENT_COMMAND_DESCRIPTIONS)) {
			assert.ok(description.title.length > 10, `слишком короткое описание у ${id}`);
			assert.ok(description.category.startsWith('1С: '), `категория без префикса у ${id}`);
			assert.ok(!description.title.includes('1c-platform-tools'), `описание ${id} содержит идентификатор`);
		}
	});

	test('команды без описания обходятся заголовком из package.json', () => {
		assert.strictEqual(agentCommandDescription('1c-platform-tools.infobase.create'), undefined);
		assert.ok(agentCommandDescription('1c-platform-tools.test.xunit'));
	});

	test('у команд без палитры описание есть обязательно', () => {
		for (const id of UNDECLARED) {
			assert.ok(agentCommandDescription(id), `команда ${id} осталась бы у агента без описания`);
		}
	});

	test('у команд схемы компоновки описание обязательно: заголовок палитры не называет параметры', () => {
		for (const suffix of ['read', 'apply', 'validate', 'typeDictionary', 'query', 'templateAdd', 'templateRemove']) {
			const id = `1c-platform-tools.dcs.${suffix}`;
			const description = agentCommandDescription(id);
			assert.ok(description, `команда ${id} осталась бы у агента без описания`);
			assert.strictEqual(description.category, '1С: Схема компоновки данных', id);
		}
	});

	test('dcs.read называет составы typeCompositions, dcs.query — Границы, критерий отбора и «Константы» в модели разбора', () => {
		// Без описания агент не узнает, что ответ jar несёт эти ключи, и как читать источник
		// с параметрами без виртуальной таблицы
		const read = agentCommandDescription('1c-platform-tools.dcs.read')?.title ?? '';
		for (const word of ['typeCompositions', 'source', 'typeIds', 'cfg:Characteristic']) {
			assert.ok(read.includes(word), `описание dcs.read не называет ${word}`);
		}
		const query = agentCommandDescription('1c-platform-tools.dcs.query')?.title ?? '';
		for (const word of ['virtualTable', 'Последовательность.X.Границы', 'Sequence.X.Boundaries', 'КритерийОтбора.X(&Значение)', 'Константы']) {
			assert.ok(query.includes(word), `описание dcs.query не называет ${word}`);
		}
	});
});
