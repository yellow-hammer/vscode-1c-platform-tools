import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Картинки сайта берутся из ресурсов расширения, чтобы не хранить копии в docs/.
const sharedAssets: Record<string, string> = {
	'favicon.png': path.join(repoRoot, 'resources', '1c-icon.png'),
	'cat-hi.png': path.join(repoRoot, 'resources', 'brand', 'cat-hi.png'),
};

const contentTypes: Record<string, string> = {
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.gif': 'image/gif',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};

function sendFile(res: { setHeader(name: string, value: string): void; pipe?: unknown }, file: string) {
	res.setHeader('Content-Type', contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
	fs.createReadStream(file).pipe(res as NodeJS.WritableStream);
}

function sharedAssetsPlugin() {
	return {
		name: 'shared-assets-from-resources',
		configureServer(server: { middlewares: { use(fn: (req: any, res: any, next: () => void) => void): void } }) {
			server.middlewares.use((req, res, next) => {
				const pathname = decodeURIComponent((req.url ?? '').split('?')[0]);
				const name = Object.keys(sharedAssets).find(
					(asset) => pathname === `/${asset}` || pathname.endsWith(`/${asset}`)
				);
				if (name) {
					return sendFile(res, sharedAssets[name]);
				}
				// Страницы ссылаются на ../resources и ../walkthrough — на dev-сервере
				// эти пути выпадают из docs/, поэтому отдаём их из корня репозитория.
				const match = pathname.match(/^\/(resources|walkthrough)\/(.+)$/);
				if (match) {
					const file = path.join(repoRoot, match[1], match[2]);
					const insideRepo = path.resolve(file).startsWith(path.join(repoRoot, match[1]) + path.sep);
					if (insideRepo && fs.existsSync(file) && fs.statSync(file).isFile()) {
						return sendFile(res, file);
					}
				}
				next();
			});
		},
	};
}

// Руководства в порядке каталога docs/README.md.
const guides = [
	{ text: '1С: Инструменты', link: '/tools' },
	{ text: '1С: Проекты', link: '/projects' },
	{ text: '1С: Администрирование', link: '/admin' },
	{ text: '1С: Артефакты', link: '/artifacts' },
	{ text: '1С: Метаданные', link: '/metadata' },
	{ text: 'Служебные файлы', link: '/service-files' },
	{ text: 'Автоматизация', link: '/automation' },
	{ text: 'Профили запуска', link: '/launch-profiles' },
	{ text: 'Автономный сервер', link: '/autonomous-server' },
	{ text: 'ER-диаграммы', link: '/er-diagrams' },
	{ text: 'Тестирование', link: '/testing' },
	{ text: '1С: Список дел', link: '/todo' },
	{ text: 'Отладка 1С', link: '/debug' },
	{ text: 'AI и MCP', link: '/ai-mcp' },
	{ text: 'Docker и ibcmd', link: '/docker' },
	{ text: 'Внешние компоненты', link: '/components' },
	{ text: 'Сочетания клавиш', link: '/keyboard' },
];

export default defineConfig({
	lang: 'ru-RU',
	title: '1C: Platform Tools',
	description:
		'Расширение Visual Studio Code для разработки 1С: панели инструментов, метаданные, отладка, тестирование, автоматизация, AI и MCP.',
	base: '/vscode-1c-platform-tools/',
	srcExclude: ['README.md'],
	cleanUrls: true,
	lastUpdated: true,
	head: [['link', { rel: 'icon', type: 'image/png', href: '/vscode-1c-platform-tools/favicon.png' }]],
	vite: { plugins: [sharedAssetsPlugin()] },
	async buildEnd(siteConfig) {
		for (const [name, source] of Object.entries(sharedAssets)) {
			await fs.promises.copyFile(source, path.join(siteConfig.outDir, name));
		}
	},
	themeConfig: {
		logo: '/favicon.png',
		siteTitle: 'Platform Tools',
		nav: [
			{ text: 'Руководства', link: '/tools', activeMatch: '^/(?!$)' },
			{
				// Списком, а не одной ссылкой: у Cursor и VSCodium свой маркетплейс,
				// а на закрытой машине ставят файлом из релизов
				text: 'Установить',
				items: [
					{
						text: 'Visual Studio Code',
						link: 'https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools',
					},
					{
						text: 'Cursor, Windsurf, VSCodium',
						link: 'https://open-vsx.org/extension/yellow-hammer/1c-platform-tools',
					},
					{
						text: 'Файл .vsix из релизов',
						link: 'https://github.com/yellow-hammer/vscode-1c-platform-tools/releases',
					},
				],
			},
		],
		sidebar: [{ text: 'Руководства по функциям', items: guides }],
		socialLinks: [
			{
				icon: {
					svg: '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>VS Marketplace</title><path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>',
				},
				link: 'https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools',
				ariaLabel: 'Установить из VS Marketplace',
			},
			{
				icon: {
					svg: '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Open VSX</title><path d="M12 1.5 2.6 6.75v10.5L12 22.5l9.4-5.25V6.75L12 1.5zm0 2.3 7.4 4.14v8.12L12 20.2l-7.4-4.14V7.94L12 3.8zm0 3.05L7.3 9.5v5l4.7 2.65 4.7-2.65v-5L12 6.85zm0 2.3 2.7 1.52v2.86L12 15.15 9.3 13.63v-2.86L12 9.25z"/></svg>',
				},
				link: 'https://open-vsx.org/extension/yellow-hammer/1c-platform-tools',
				ariaLabel: 'Установить из Open VSX для Cursor и Windsurf',
			},
			{ icon: 'github', link: 'https://github.com/yellow-hammer/vscode-1c-platform-tools' },
		],
		search: {
			provider: 'local',
			options: {
				translations: {
					button: { buttonText: 'Поиск', buttonAriaLabel: 'Поиск по документации' },
					modal: {
						displayDetails: 'Показать подробности',
						resetButtonTitle: 'Сбросить запрос',
						backButtonTitle: 'Закрыть поиск',
						noResultsText: 'Ничего не найдено по запросу',
						footer: {
							selectText: 'выбрать',
							navigateText: 'перейти',
							closeText: 'закрыть',
						},
					},
				},
			},
		},
		outline: { label: 'На этой странице' },
		docFooter: { prev: 'Назад', next: 'Вперёд' },
		lastUpdated: { text: 'Обновлено' },
		darkModeSwitchLabel: 'Тема',
		lightModeSwitchTitle: 'Переключить на светлую тему',
		darkModeSwitchTitle: 'Переключить на тёмную тему',
		sidebarMenuLabel: 'Меню',
		returnToTopLabel: 'Наверх',
		langMenuLabel: 'Язык',
		editLink: {
			pattern: 'https://github.com/yellow-hammer/vscode-1c-platform-tools/edit/main/docs/:path',
			text: 'Предложить правку на GitHub',
		},
		footer: {
			message: 'Распространяется по лицензии MIT.',
			copyright: '© Ivan Karlo и участники проекта',
		},
	},
});
