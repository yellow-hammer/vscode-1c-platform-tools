import * as assert from 'node:assert';
import * as path from 'node:path';
import { childrenOf } from '../../features/ibases/ibaseTree';
import {
	parseInfobaseList,
	readPlatformText,
	type InfobaseEntry,
} from '../../shared/infobaseList';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'infobases');

function entry(partial: Partial<InfobaseEntry> & Pick<InfobaseEntry, 'name' | 'connect'>): InfobaseEntry {
	return {
		folder: '/',
		orderInList: 0,
		orderInTree: 0,
		...partial,
	};
}

suite('дерево списка информационных баз', () => {
	test('из фикстуры: папка Демо и база в корне', () => {
		const entries = parseInfobaseList(readPlatformText(path.join(FIXTURES, 'ibases.v8i')) ?? '');
		const root = childrenOf('/', entries);

		assert.deepStrictEqual(
			root.map((node) => (node.kind === 'folder' ? `folder:${node.name}` : `base:${node.entry.name}`)),
			['folder:Демо', 'base:Рабочая'],
			'папка Демо раньше Рабочей: у детей Демо меньший OrderInTree'
		);

		const demo = root.find((node) => node.kind === 'folder' && node.path === '/Демо');
		assert.ok(demo && demo.kind === 'folder');
		assert.deepStrictEqual(
			childrenOf(demo.path, entries).map((node) => node.kind === 'base' && node.entry.name),
			['Песочница', 'Демонстрационная'],
			'без OrderInTree Песочница идёт первой'
		);
	});

	test('вложенная папка появляется промежуточным узлом', () => {
		const entries = [
			entry({ name: 'Корень', connect: 'File="a";', orderInTree: 10 }),
			entry({ name: 'Глубокая', connect: 'File="b";', folder: '/А/Б', orderInTree: 20 }),
		];

		const root = childrenOf('/', entries);
		assert.deepStrictEqual(
			root.map((node) => (node.kind === 'folder' ? node.path : node.entry.name)),
			['Корень', '/А']
		);
		assert.deepStrictEqual(
			childrenOf('/А', entries).map((node) => (node.kind === 'folder' ? node.path : node.entry.name)),
			['/А/Б']
		);
		assert.deepStrictEqual(
			childrenOf('/А/Б', entries).map((node) => node.kind === 'base' && node.entry.name),
			['Глубокая']
		);
	});
});
