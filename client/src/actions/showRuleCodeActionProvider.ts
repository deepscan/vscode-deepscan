/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as _ from 'lodash';
import * as showdown from 'showdown';
import * as showdownHtmlEscape from 'showdown-htmlescape';

import * as vscode from 'vscode';
import deepscanCodeActionProvider from './deepscanCodeActionProvider';

export default class showRuleCodeActionProvider extends deepscanCodeActionProvider {
    private command: vscode.Disposable;
    private provider: TextDocumentContentProvider;

    private _panel: vscode.WebviewPanel;

    public constructor(context: vscode.ExtensionContext, {rules, style}) {
        super('show-rule');

        this.command = vscode.commands.registerCommand(this.getCommandId(), this.execute, this);
        context.subscriptions.push(this.command);

        this.provider = new TextDocumentContentProvider(context, {rules, style});
        vscode.workspace.registerTextDocumentContentProvider(this.getScheme(), this.provider);
    }

    public codeActions(document: vscode.TextDocument, range: vscode.Range, diagnostics: vscode.Diagnostic[], token: vscode.CancellationToken): vscode.Command[] {
        //let text = document.getText(diagnostic.range);
        let commands: vscode.Command[] = [];
        diagnostics.forEach(diagnostic => {
            commands.push({
                arguments: [document, diagnostic.code],
                command: this.getCommandId(),
                title: `Show rule ${diagnostic.code}`,
            });
        });
        return commands;
    }

    public execute(document, ruleKey: string) {
        const uri = this.getUri();
        const column = vscode.ViewColumn.Two;
        const options: vscode.WebviewOptions & vscode.WebviewPanelOptions = {
            enableScripts: true,
            enableCommandUris: true,
            enableFindWidget: false,
            retainContextWhenHidden: true
        };
        if (!this._panel) {
            const viewType = 'deepscan.show-rule';
            const tabTitle = 'DeepScan Rule';
            this._panel = vscode.window.createWebviewPanel(viewType, tabTitle, { viewColumn: column, preserveFocus: true }, options);
            this._panel.onDidDispose(() => {
                this._panel = null;
            });
        }
        this.provider.set(ruleKey);
        this._panel.webview.html = this.provider.provideTextDocumentContent(uri);
        this._panel.reveal();
    }

    public dispose() {
        this.command.dispose();
    }
}

class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private context;
    private rules;
    private ruleKey: string;
    private converter;
    private style: string;

    constructor(context: vscode.ExtensionContext, {rules, style}) {
        this.context = context;
        this.rules = rules;
        this.style = style;

        showdown.setFlavor('github');
        this.converter = new showdown.Converter({extensions: [showdownHtmlEscape]});

        //this.imgBug = new Buffer(fs.readFileSync(path.resolve(this.context.extensionPath, "resources", "fa-bug.png"))).toString('base64');
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.createSnippet();
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public set(ruleKey) {
        this.ruleKey = ruleKey;
    }

    public update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }

    private createSnippet() {
        function slugify(text) {
            return text.toString().toLowerCase()
                                  .replace(/\s+/g, '-')     // Replace spaces with -
                                  .replace(/[^\w\-]+/g, '') // Remove all non-word chars
                                  .replace(/\_/g, '-')      // Replace _ with -
                                  .replace(/\-\-+/g, '-')   // Replace multiple - with single -
                                  .replace(/^-+/, '')       // Trim - from start of text
                                  .replace(/-+$/, '');      // Trim - from end of text
        }

        const NO_RULE = 'No description is available';

        let content = NO_RULE;
        let rule;
        if (this.rules && (rule = _.find(this.rules, (rule) => rule.key === this.ruleKey))) {
            const tags = _.compact(rule.tag);
            let sees = [];
            _.forEach(rule.cwe, (cwe) => {
                sees.push(`[CWE-${cwe}](https://cwe.mitre.org/data/definitions/${cwe}.html)`);
            });
            sees = sees.concat(rule.see);

            content = `<ul class="deepscan-rule-detail">
                        <li class="deepscan-rule-detail-property">`;
            _.forEach(rule.severity, (severity) => {
                content += `<span class="severity" data-severity="${severity}"><i class="circle"></i>${severity}</span>`;
            });
            content += `<li class="deepscan-rule-detail-property"><span class="icon icon-${rule.type === 'Error' ? 'error' : 'code-quality'}"></span> ${rule.type}
                        <li class="deepscan-rule-detail-property"><span class="icon icon-tags"></span> ${tags.length > 0 ? tags.join(', ') : 'No tags'}
                        <li class="deepscan-rule-detail-property"><span class="icon icon-bookmark"></span> <a href="https://deepscan.io/docs/rules/${slugify(rule.key)}">${rule.key}</a>
                       </ul>

                       <div class="deepscan-rule-description">
                           <h2>${rule.name}</h2>
                           ${this.converter.makeHtml(rule.description)}
                           <h3>Code Example</h3>
                           <pre><code class="language-javascript">${_.escape(rule.examples)}</code></pre>
                           <h3>Revised Code Example</h3>
                           <pre><code class="language-javascript">${_.escape(rule.examplesRevised)}</code></pre>`;
            if (sees.length > 0) {
                content += `<h3>See</h3>
                            <ul>`;
                _.forEach(sees, (see) => {
                    content += `<li>${this.converter.makeHtml(see)}</li>`;
                });
                content += `</ul>`;
            }
            content += `</div>`;
        }

        return `<style>${this.style}</style><body><div class="deepscan-rule">${content}</div></body>`;
    }
}
