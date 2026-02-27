import * as vscode from 'vscode';

class DebugTargetItem {
	Id: string = '';
	User: string = '';
	Seance: string = '';
	Type: string = '';
}

interface DebugTargetsResponse {
	Items: DebugTargetItem[];
}

class DebugTargetsProvider implements vscode.TreeDataProvider<DebugTargetItem> {
	private items: DebugTargetItem[] = [];
	private data: vscode.TreeItem[] = [];
	private readonly changeEvent = new vscode.EventEmitter<void>();

	readonly onDidChangeTreeData: vscode.Event<void | DebugTargetItem | DebugTargetItem[] | null | undefined> =
		this.changeEvent.event;

	updateItems(items: DebugTargetItem[]): void {
		this.items = items;
		this.data = items.map<vscode.TreeItem>((value) => {
			const item = new vscode.TreeItem(`${value.Type} (${value.User}, ${value.Seance})`);
			item.id = value.Id;
			item.contextValue = value.Id;
			return item;
		});
		this.changeEvent.fire();
	}

	getTreeItem(element: DebugTargetItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		const index = this.items.indexOf(element);
		return this.data[index];
	}

	getChildren(element?: DebugTargetItem): vscode.ProviderResult<DebugTargetItem[]> {
		if (element === undefined) return this.items;
		return [];
	}
}

const debugTargetsProvider = new DebugTargetsProvider();

function attachDebugTarget(id: string): void {
	void vscode.debug.activeDebugSession?.customRequest('AttachDebugTargetRequest', { Id: id });
}

export function init(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('debug.debugTargets', debugTargetsProvider),
		vscode.commands.registerCommand('debug.debugTargets.connect', (item: DebugTargetItem) => {
			attachDebugTarget(item.Id);
		})
	);
}

export function updateDebugTargets(session: vscode.DebugSession): void {
	session
		.customRequest('DebugTargetsRequest')
		.then((targets: DebugTargetsResponse) => {
			debugTargetsProvider.updateItems(targets.Items ?? []);
		})
		.catch(() => {});
}
