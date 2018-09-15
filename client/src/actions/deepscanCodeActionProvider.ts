/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';

export default abstract class deepscanCodeActionProvider implements vscode.CodeActionProvider {
    private scheme: string = 'deepscan';
    private commandId: string;
    private uri: vscode.Uri;

    constructor(id) {
        this.commandId = `${this.scheme}.${id}`;
        this.uri = vscode.Uri.parse(`${this.scheme}://${id}`);
    }

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Command[]> {
        let diagnostics: vscode.Diagnostic[] = context.diagnostics.filter(diagnostic => this.scheme === diagnostic.source);

        return this.codeActions(document, range, diagnostics, token);
    }

    abstract codeActions(document: vscode.TextDocument, range: vscode.Range, diagnostics: vscode.Diagnostic[], token: vscode.CancellationToken): vscode.ProviderResult<vscode.Command[]>;

    protected getScheme(): string {
        return this.scheme;
    }

    protected getCommandId(): string {
        return this.commandId;
    }

    protected getUri(): vscode.Uri {
        return this.uri;
    }
}
