import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

/** Команда расширения из package.json. */
interface ContributedCommand {
	command: string;
	title: string;
	shortTitle?: string;
	category?: string;
}

/** Содержимое contributes из package.json. */
function contributes(): {
	commands: ContributedCommand[];
	menus: Record<string, Array<{ command?: string; when?: string }>>;
} {
	const pkgPath = path.resolve(__dirname, '../../../package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
		contributes: {
			commands: ContributedCommand[];
			menus: Record<string, Array<{ command?: string; when?: string }>>;
		};
	};
	return pkg.contributes;
}

/** Команды, видимые в палитре. */
function paletteCommands(): ContributedCommand[] {
	const { commands, menus } = contributes();
	const hidden = new Set(
		(menus.commandPalette ?? [])
			.filter((entry) => entry.when === 'false' && entry.command)
			.map((entry) => entry.command as string)
	);
	return commands.filter((command) => !hidden.has(command.command));
}

suite('заголовки команд', () => {
	test('в палитре нет двух команд с одинаковой подписью', () => {
		const seen = new Map<string, string>();
		const duplicates: string[] = [];
		for (const command of paletteCommands()) {
			const label = `${command.category ?? ''}: ${command.title}`;
			const previous = seen.get(label);
			if (previous) {
				duplicates.push(`«${label}» — ${previous} и ${command.command}`);
			}
			seen.set(label, command.command);
		}
		assert.deepStrictEqual(duplicates, [], `подписи повторяются:\n${duplicates.join('\n')}`);
	});

	test('у команды есть категория: без неё палитра теряет раздел', () => {
		const without = paletteCommands()
			.filter((command) => !command.category)
			.map((command) => command.command);
		assert.deepStrictEqual(without, [], `команды без категории: ${without.join(', ')}`);
	});

	test('короткое имя действительно короче полного', () => {
		for (const command of contributes().commands) {
			if (command.shortTitle) {
				assert.ok(
					command.shortTitle.length <= command.title.length,
					`shortTitle длиннее title у ${command.command}`
				);
			}
		}
	});

	test('категории записаны латинской «C» в префиксе', () => {
		for (const command of contributes().commands) {
			if (command.category) {
				assert.ok(
					command.category.startsWith('1C: '),
					`категория «${command.category}» у ${command.command} записана не латиницей`
				);
			}
		}
	});
});

suite('идентификаторы команд', () => {
	test('действие называется в домене объекта, без параллельных групп', () => {
		// build.configuration и configuration.build раньше вызывали один
		// обработчик: одно действие не должно иметь двух идентификаторов
		const stray = contributes()
			.commands.map((command) => command.command)
			.filter((id) => id.startsWith('1c-platform-tools.build.') || id.startsWith('1c-platform-tools.decompile.'));
		assert.deepStrictEqual(stray, [], `параллельные группы команд: ${stray.join(', ')}`);
	});

	test('сборка и разбор объявлены в домене объекта', () => {
		const declared = new Set(contributes().commands.map((command) => command.command));
		for (const id of [
			'1c-platform-tools.configuration.build',
			'1c-platform-tools.configuration.decompile',
			'1c-platform-tools.extensions.build',
			'1c-platform-tools.extensions.decompile',
			'1c-platform-tools.externalProcessors.build',
			'1c-platform-tools.externalProcessors.decompile',
			'1c-platform-tools.externalReports.build',
			'1c-platform-tools.externalReports.decompile',
		]) {
			assert.ok(declared.has(id), `команда ${id} потерялась`);
		}
	});
});
