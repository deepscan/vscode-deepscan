/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as _ from 'lodash';
import * as showdown from 'showdown';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export default class showRuleCodeActionProvider implements vscode.CodeActionProvider {
    private static commandId: string = 'deepscan.show-rule';
    private static scheme: string = 'deepscan';
    private command: vscode.Disposable;
    private showRuleUri: vscode.Uri = vscode.Uri.parse(`${showRuleCodeActionProvider.scheme}://show-rule`);
    private provider: TextDocumentContentProvider;

    public constructor(context: vscode.ExtensionContext, rules) {
        this.command = vscode.commands.registerCommand(showRuleCodeActionProvider.commandId, this.showRule, this);
        context.subscriptions.push(this.command);

        this.provider = new TextDocumentContentProvider(context, rules);
        vscode.workspace.registerTextDocumentContentProvider(showRuleCodeActionProvider.scheme, this.provider);
    }

    public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.Command[] {
        let diagnostic: vscode.Diagnostic = context.diagnostics[0];

        if ("deepscan" !== diagnostic.source)
            return;

        //let text = document.getText(diagnostic.range);
        let commands: vscode.Command[] = [];
        commands.push({
            arguments: [document, diagnostic.code],
            command: showRuleCodeActionProvider.commandId,
            title: `Show rule ${diagnostic.code}`,
        });

        return commands;
    }

    public showRule(document, ruleKey: string) {
        this.provider.set(ruleKey);
        vscode.commands.executeCommand('vscode.previewHtml', this.showRuleUri, vscode.ViewColumn.Two, 'DeepScan Rule').then((success) => {
            this.provider.update(this.showRuleUri);
        }, (reason) => {
            vscode.window.showErrorMessage(reason);
        });
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
    private fbImg;
    private fcImg;
    private ftImg;

    constructor(context: vscode.ExtensionContext, rules) {
        this.context = context;
        this.rules = rules;

        showdown.setFlavor('github');
        this.converter = new showdown.Converter();

        this.fbImg = new Buffer(fs.readFileSync(path.resolve(this.context.extensionPath, "resources", "fa-bug.png"))).toString('base64');
        this.fcImg = new Buffer(fs.readFileSync(path.resolve(this.context.extensionPath, "resources", "fa-check.png"))).toString('base64');
        this.ftImg = new Buffer(fs.readFileSync(path.resolve(this.context.extensionPath, "resources", "fa-tags.png"))).toString('base64');
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
            let tags = rule.tag.length > 0 ? rule.tag : 'No tags';
            var sees = [];
            _.forEach(rule.cwe, (cwe) => {
                sees.push(`[CWE-${cwe}](https://cwe.mitre.org/data/definitions/${cwe}.html)`);
            });
            sees = sees.concat(rule.see);

            content = `<ul class="deepscan-rule-detail">
                           <li class="deepscan-rule-detail-property">`;
            _.forEach(rule.severity, (severity) => {
                content += `<span class="severity" data-severity="${severity}"><i class="circle"></i>${severity}</span>`;
            });
            content += `<li class="deepscan-rule-detail-property"><img src="data:image/png;base64,${rule.type === 'Error' ? this.fbImg : this.fcImg}"> ${rule.type}
                        <li class="deepscan-rule-detail-property"><img src="data:image/png;base64,${this.ftImg}"> ${tags}
                        <li class="deepscan-rule-detail-property link"><a href="https://deepscan.io/docs/rules/${slugify(rule.key)}">Show more</a>
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
        return `<style>
                    a {
                        color: rgb(91,163,255);
                        text-decoration: none;
                        outline: none;
                    }
                    a:active, a:focus {
                        outline: none;
                    }

                    .deepscan-rule-detail {
                        padding-left: 0;
                        list-style: none;
                        margin: 10px 0;
                    }
                    .deepscan-rule-detail-property {
                        display: inline-block;
                        vertical-align: middle;
                        margin-right: 20px;
                    }
                    .deepscan-rule-detail-property img {
                        vertical-align: middle;
                    }
                    .deepscan-rule-detail-property.link {
                        float: right;
                    }
                    .deepscan-rule-detail .severity {
                        padding: 0 3px;
                    }
                    .deepscan-rule-detail .severity .circle {
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        display: inline-block;
                        margin-right: 3px;
                    }
                    .deepscan-rule-detail .severity[data-severity="High"] .circle {
                        color: #ff4747;
                        background-color: #ff4747;
                    }
                    .deepscan-rule-detail .severity[data-severity="Medium"] .circle {
                        color: #ffcf4c;
                        background-color: #ffcf4c;
                    }
                    .deepscan-rule-detail .severity[data-severity="Low"] .circle {
                        color: #1fcc7d;
                        background-color: #1fcc7d;
                    }

                    .deepscan-rule-description pre {
                        border: 1px solid rgb(204,204,204);
                        padding: 10px;
                        overflow: auto;
                    }
                </style>
                <body>
                    ${content}
                </body>`;
    }
}
