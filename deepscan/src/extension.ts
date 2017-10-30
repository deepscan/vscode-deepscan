/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import {
    LanguageClient, LanguageClientOptions, SettingMonitor, TransportKind,
    NotificationType, ErrorHandler,
    ErrorAction, CloseAction, State as ClientState,
    RevealOutputChannelOn, VersionedTextDocumentIdentifier, ExecuteCommandRequest, ExecuteCommandParams
} from 'vscode-languageclient';

import disableRuleCodeActionProvider from './actions/disableRulesCodeActionProvider';
import showRuleCodeActionProvider from './actions/showRuleCodeActionProvider';

const packageJSON = vscode.extensions.getExtension('DeepScan.vscode-deepscan').packageJSON;


namespace CommandIds {
    export const showOutput: string = 'deepscan.showOutputView';
}

enum Status {
    none = 0,
    ok = 1, // No alarm
    warn = 2, // Any alarm regardless of impact
    fail = 3 // Analysis failed
}

interface StatusParams {
    state: Status,
    error: string
}

namespace StatusNotification {
    export const type = new NotificationType<StatusParams, void>('deepscan/status');
}

const exitCalled = new NotificationType<[number, string], void>('deepscan/exitCalled');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    const workspaceRootPath = vscode.workspace.rootPath;
    if (!workspaceRootPath) {
        return;
    }

    activateClient(context);
    console.log(`Congratulations, your extension "${packageJSON.name} ${packageJSON.version}" is now active!`);
}

async function activateClient(context: vscode.ExtensionContext) {
    let languageIds = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'];
    let statusBarMessage: vscode.Disposable = null;

    function updateStatus(status: Status) {
        let tooltip = statusBarItem.tooltip;
        switch (status) {
            case Status.none:
                statusBarItem.color = undefined;
                break;
            case Status.ok:
                statusBarItem.color = 'lightgreen';
                tooltip = 'Issue-free!';
                break;
            case Status.warn:
                statusBarItem.color = 'yellow';
                tooltip = 'Issue(s) detected!';
                break;
            case Status.fail:
                statusBarItem.color = 'darkred';
                tooltip = 'Inspection failed!';
                break;
        }
        statusBarItem.tooltip = tooltip;
        deepscanStatus = status;
        updateStatusBar(vscode.window.activeTextEditor);
    }

    function showNotificationIfNeeded(params: StatusParams) {
        if (statusBarMessage) {
            statusBarMessage.dispose();
        }

        if (params.state === Status.fail) {
            statusBarMessage = vscode.window.setStatusBarMessage(`A problem occurred communicating with DeepScan server. (${params.error})`);
        }
    }

    function updateStatusBar(editor: vscode.TextEditor): void {
        showStatusBarItem(serverRunning && (deepscanStatus === Status.fail || (editor && _.includes(languageIds, editor.document.languageId))));
    }

    function showStatusBarItem(show: boolean): void {
        if (show) {
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    }

    let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    let deepscanStatus: Status = Status.ok;
    let serverRunning: boolean = false;

    statusBarItem.text = 'DeepScan';
    statusBarItem.command = CommandIds.showOutput;

    vscode.window.onDidChangeActiveTextEditor(updateStatusBar);
    updateStatusBar(vscode.window.activeTextEditor);

    // We need to go two levels up since an extension compile the js code into the output folder.
    let serverModule = path.join(__dirname, '..', '..', 'server', 'src', 'server.js');
    let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };
    let serverOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
    };

    let defaultErrorHandler: ErrorHandler;
    let serverCalledProcessExit: boolean = false;
    //let staticDocuments: DocumentSelector = [{ scheme: 'file', pattern: '**/*.js' }];
    let clientOptions: LanguageClientOptions = {
        documentSelector: languageIds,
        diagnosticCollectionName: 'deepscan',
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        synchronize: {
            // Synchronize the setting section 'deepscan' to the server
            configurationSection: 'deepscan'
        },
        initializationOptions: () => {
            let configuration = getDeepScanConfiguration();
            const defaultUrl = 'https://deepscan.io';
            return {
                server: configuration ? configuration.get('server', defaultUrl) : defaultUrl,
                languageIds,
                userAgent: `${packageJSON.name}/${packageJSON.version}`
            };
        },
        initializationFailedHandler: (error) => {
            client.error('Server initialization failed.', error);
            client.outputChannel.show(true);
            return false;
        },
        errorHandler: {
            error: (error, message, count): ErrorAction => {
                return defaultErrorHandler.error(error, message, count);
            },
            closed: (): CloseAction => {
                if (serverCalledProcessExit) {
                    return CloseAction.DoNotRestart;
                }
                return defaultErrorHandler.closed();
            }
        }
    };

    let client = new LanguageClient('DeepScan', serverOptions, clientOptions);
    defaultErrorHandler = client.createDefaultErrorHandler();
    const running = 'DeepScan server is running.';
    const stopped = 'DeepScan server stopped.';
    client.onDidChangeState((event) => {
        if (event.newState === ClientState.Running) {
            client.info(running);
            statusBarItem.tooltip = running;
            serverRunning = true;
        } else {
            client.info(stopped);
            statusBarItem.tooltip = stopped;
            serverRunning = false;
        }
        updateStatusBar(vscode.window.activeTextEditor);
    });
    client.onReady().then(() => {
        console.log('Client is ready.');

        client.onNotification(StatusNotification.type, (params) => {
            updateStatus(params.state);
            showNotificationIfNeeded(params);
        });

        client.onNotification(exitCalled, (params) => {
            serverCalledProcessExit = true;
            client.error(`Server process exited with code ${params[0]}. This usually indicates a misconfigured setup.`, params[1]);
            vscode.window.showErrorMessage(`DeepScan server shut down. See 'DeepScan' output channel for details.`);
        });
    });

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('deepscan.inspect', () => {
        let textEditor = vscode.window.activeTextEditor;
        if (!textEditor) {
            return;
        }
        let textDocument: VersionedTextDocumentIdentifier = {
            uri: textEditor.document.uri.toString(),
            version: textEditor.document.version
        };
        let params: ExecuteCommandParams = {
            command: 'deepscan.tryInspect',
            arguments: [textDocument]
        }

        client.sendRequest(ExecuteCommandRequest.type, params).then(undefined, (error) => {
            console.error('Server failed', error);
            vscode.window.showErrorMessage('Failed to inspect. Please consider opening an issue with steps to reproduce.');
        });
    });

    let fsPath = path.resolve(context.extensionPath, 'resources', 'deepscan-rules.json');
    let rules = [];
    try {
        let rulesObj = JSON.parse(fs.readFileSync(fsPath).toString());
        rules = rulesObj.rules;
    } catch (e) {
        vscode.window.showWarningMessage(`Can't read or parse rule definitions: ${e.message}`);
    }

    // Register code actions
    const showRuleAction = new showRuleCodeActionProvider(context, rules);
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(clientOptions.documentSelector, showRuleAction));
    const disableRulesAction = new disableRuleCodeActionProvider(context);
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(clientOptions.documentSelector, disableRulesAction));

    context.subscriptions.push(
        new SettingMonitor(client, 'deepscan.enable').start(),
        disposable,
        vscode.commands.registerCommand(CommandIds.showOutput, () => { client.outputChannel.show(); }),
        statusBarItem
    );

    await checkSetting();
}

async function checkSetting() {
    const config = getDeepScanConfiguration();
    const shouldIgnore = config.get('ignoreConfirmWarning') === true;

    if (shouldIgnore) {
        return;
    }

    if (config.get('enable') === true) {
        return;
    }

    const confirm = 'Confirm';
    const neverShowAgain = 'Don\'t show again';
    const choice = await vscode.window.showWarningMessage('Allow the DeepScan extension to transfer your code to the DeepScan server for inspection.', confirm, neverShowAgain);

    if (choice === confirm) {
        await config.update('enable', true, false);
    }
    else if (choice === neverShowAgain) {
        await config.update('ignoreConfirmWarning', true, false);
    }
}

function getDeepScanConfiguration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('deepscan');
}
