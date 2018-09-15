/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import deepscanCodeActionProvider from './deepscanCodeActionProvider';

export default class disableRulesCodeActionProvider extends deepscanCodeActionProvider {
    private command: vscode.Disposable;
    private provider: TextDocumentContentProvider;
    private comment: string = 'deepscan-disable-line';

    public constructor(context: vscode.ExtensionContext) {
        super('ignore-line');

        this.command = vscode.commands.registerCommand(this.getCommandId(), this.execute, this);
        context.subscriptions.push(this.command);

        this.provider = new TextDocumentContentProvider(context);
        vscode.workspace.registerTextDocumentContentProvider(this.getScheme(), this.provider);
    }

    public codeActions(document: vscode.TextDocument, range: vscode.Range, diagnostics: vscode.Diagnostic[], token: vscode.CancellationToken): vscode.Command[] {
        let commands: vscode.Command[] = [];
        if (diagnostics.length > 0) {
            let ruleKeys = diagnostics.map(diagnostic => diagnostic.code);
            commands.push({
                arguments: [document],
                command: this.getCommandId(),
                title: `Ignore this line`,
            });
            commands.push({
                arguments: [document, ruleKeys],
                command: this.getCommandId(),
                title: `Ignore this rule ${ruleKeys}`,
            });
        }
        return commands;
    }

    public execute(document, ruleKeys) {
        let editor = vscode.window.activeTextEditor;
        let textLine: vscode.TextLine = editor.document.lineAt(editor.selection.active.line);
        let edit = new vscode.WorkspaceEdit();
        if (ruleKeys) {
            edit.insert(document.uri, textLine.range.end, ` // ${this.comment} ${ruleKeys.join(',')}`);
        } else {
            edit.insert(document.uri, textLine.range.end, ` // ${this.comment}`);
        }
        return vscode.workspace.applyEdit(edit);
    }

    public dispose() {
        this.command.dispose();
    }
}

class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private context;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return 'TODO';
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }
}
