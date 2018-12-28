/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as child_process from "child_process";
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
    RevealOutputChannelOn, ExecuteCommandRequest, ExecuteCommandParams,
    DocumentSelector,
    StreamInfo
} from 'vscode-languageclient';

import { CommandIds, Status, StatusNotification, StatusParams } from './types';

import disableRuleCodeActionProvider from './actions/disableRulesCodeActionProvider';
import showRuleCodeActionProvider from './actions/showRuleCodeActionProvider';

import { activateDecorations } from './deepscanDecorators';

const packageJSON = vscode.extensions.getExtension('DeepScan.vscode-deepscan').packageJSON;

// For the support of '.vue' support by languageIds, 'vue' language should be installed.
//const languageIds = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];
const DEFAULT_FILE_SUFFIXES = ['.js', '.jsx', '.ts', '.tsx', '.vue'];
const DIAGNOSTIC_SOURCE_NAME = 'deepscan';

let oldConfig;

const exitCalled = new NotificationType<[number, string], void>('deepscan/exitCalled');

let client: LanguageClient = null;

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
    let statusBarMessage: vscode.Disposable = null;

    function updateStatus(status: Status) {
        let tooltip = statusBarItem.tooltip;
        switch (status) {
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

    function clearNotification() {
        if (statusBarMessage) {
            statusBarMessage.dispose();
        }
    }

    function showNotificationIfNeeded(params: StatusParams) {
        clearNotification();

        if (params.state === Status.fail) {
            statusBarMessage = vscode.window.setStatusBarMessage(`A problem occurred communicating with DeepScan server. (${params.message})`);
        } else {
            statusBarMessage = vscode.window.setStatusBarMessage(`${params.message}`);
        }
    }

    function updateStatusBar(editor: vscode.TextEditor): void {
        let show = serverRunning &&
                   (deepscanStatus === Status.fail || (editor && _.includes(getFileSuffixes(getDeepScanConfiguration()), path.extname(editor.document.fileName))));
        showStatusBarItem(show);
    }

    function showStatusBarItem(show: boolean): void {
        if (show) {
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    }

    function isConfigurationChanged(key, oldConfig, newConfig) {
        return !_.isEqual(oldConfig.get(key), newConfig.get(key));
    }

    function changeConfiguration(): void {
        clearNotification();

        const newConfig = getDeepScanConfiguration();

        const isChanged = isConfigurationChanged('fileSuffixes', oldConfig, newConfig) ||
                          isConfigurationChanged('serverEmbedded.enable', oldConfig, newConfig) ||
                          isConfigurationChanged('serverEmbedded.serverJar', oldConfig, newConfig);

        // NOTE:
        // To apply changed file suffixes directly, documentSelector of LanguageClient should be changed.
        // But it seems to be impossible, so VS Code needs to restart.
        if (isChanged) {
            oldConfig = newConfig;
            const reload = 'Reload Now';
            vscode.window.showInformationMessage('Restart VS Code before the new setting will take affect.', ...[reload])
                         .then(selection => {
                             if (selection === reload) {
                                 vscode.commands.executeCommand('workbench.action.reloadWindow');
                             }
                         });
        }
    }

    function getFileSuffixes(configuration: vscode.WorkspaceConfiguration): string[] {
        return configuration ? configuration.get('fileSuffixes', []) : [];
    }

    function getSupportedFileSuffixes(configuration: vscode.WorkspaceConfiguration): string[] {
        return _.union(DEFAULT_FILE_SUFFIXES, getFileSuffixes(configuration));
    }

    let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    let deepscanStatus: Status = Status.ok;
    let serverRunning: boolean = false;

    statusBarItem.text = 'DeepScan';
    statusBarItem.command = CommandIds.showOutput;

    vscode.window.onDidChangeActiveTextEditor(updateStatusBar);
    updateStatusBar(vscode.window.activeTextEditor);

    const configuration = oldConfig = getDeepScanConfiguration();
    //const configuration = getDeepScanConfiguration();

    let serverOptions;
    if (isEmbedded()) {
        serverOptions = () => runServer();
    } else {
        let serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
        let debugOptions = { execArgv: ["--nolazy", "--inspect=6004"] };
        serverOptions = {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
        };
    }

    let defaultErrorHandler: ErrorHandler;
    let serverCalledProcessExit: boolean = false;
    let staticDocuments: DocumentSelector = _.map(getSupportedFileSuffixes(configuration), fileSuffix => ({ scheme: 'file', pattern: `**/*${fileSuffix}` }));
    let staticDocumentsForDisablingRules: DocumentSelector = _.filter(staticDocuments, ({ pattern }) => pattern !== '**/*.vue');

    let activeDecorations;

    let clientOptions: LanguageClientOptions = {
        documentSelector: staticDocuments,
        diagnosticCollectionName: DIAGNOSTIC_SOURCE_NAME,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        synchronize: {
            // Synchronize the setting section 'deepscan' to the server
            configurationSection: 'deepscan'
        },
        initializationOptions: () => {
            const defaultUrl = 'https://deepscan.io';
            return {
                server: configuration ? configuration.get('server', defaultUrl) : defaultUrl,
                DEFAULT_FILE_SUFFIXES,
                fileSuffixes: getFileSuffixes(configuration),
                userAgent: `${packageJSON.name}/${packageJSON.version}`,/*
                license: configuration ? configuration.get('serverEmbedded.license', '') : '',*/
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
        },
        middleware: {
            didChange: (event, next) => {
                // For less noise, hide inline decorators when typing
                if (event.document === vscode.window.activeTextEditor.document) {
                    activeDecorations.clearDecorations(event.document.uri.toString());
                    next(event);
                }
            }
        }
    };

    client = new LanguageClient('DeepScan', serverOptions, clientOptions);
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

        activeDecorations = activateDecorations(client);
        context.subscriptions.push(activeDecorations.disposables);

        client.onNotification(StatusNotification.type, (params) => {
            const { state, uri } = params;
            updateStatus(state);
            showNotificationIfNeeded(params);
            activeDecorations.updateDecorations(uri);
        });

        client.onNotification(exitCalled, (params) => {
            serverCalledProcessExit = true;
            client.error(`Server process exited with code ${params[0]}. This usually indicates a misconfigured setup.`, params[1]);
            vscode.window.showErrorMessage(`DeepScan server shut down. See 'DeepScan' output channel for details.`);
        });
    });
    const disposable = new SettingMonitor(client, 'deepscan.enable').start();
    context.subscriptions.push(disposable);

    let rules = [];
    try {
        const rulesObj = JSON.parse(fs.readFileSync(context.asAbsolutePath(path.join('client', 'resources', 'deepscan-rules.json'))).toString());
        rules = rulesObj.rules;
    } catch (e) {
        vscode.window.showWarningMessage(`Can't read or parse rule definitions: ${e.message}`);
    }

    let style: string = '';
    try {
        style = fs.readFileSync(context.asAbsolutePath(path.join('client', 'resources', 'style.css'))).toString();
    } catch (e) {
        vscode.window.showWarningMessage(`Can't read a style: ${e.message}`);
    }

    // Register code actions
    const showRuleAction = new showRuleCodeActionProvider(context, {rules, style});
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(clientOptions.documentSelector, showRuleAction));
    const disableRulesAction = new disableRuleCodeActionProvider(context);
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(staticDocumentsForDisablingRules, disableRulesAction));

    context.subscriptions.push(
        registerEmbeddedCommand('deepscan.inspectProject', (command) => {
            const diagnostics = vscode.languages.getDiagnostics();
            sendRequest(command, [diagnostics]);
        }),
        registerEmbeddedCommand('deepscan.clearProject', (command) => {
            const diagnostics = vscode.languages.getDiagnostics();
            sendRequest(command, [diagnostics]);
        }),
        vscode.commands.registerCommand(CommandIds.showOutput, () => { client.outputChannel.show(); }),
        statusBarItem
    );

    vscode.workspace.onDidChangeConfiguration(changeConfiguration);

    await checkSetting();
}

function sendRequest(command: string, args: any[] = []) {
    const params: ExecuteCommandParams = {
        command,
        arguments: args
    }

    client.sendRequest(ExecuteCommandRequest.type, params).then(undefined, (error) => {
        console.error('Server failed', error);
        vscode.window.showErrorMessage('Failed to inspect. Please consider opening an issue with steps to reproduce.');
    });
}

function registerEmbeddedCommand(command: string, handler) {
    const embeddedCommand = vscode.commands.registerCommand(command, () => {
        if (!isEmbedded()) {
            const message = `This command ${command} is supported only in the embedded mode.`;
            warn(message, true);
            return;
        }

        handler(command);
    });
    return embeddedCommand;
}

async function checkSetting() {
    const config = getDeepScanConfiguration();

    if (isEmbedded()) {
        await config.update('enable', true, false);
        return;
    }

    if (config.get('enable') === true) {
        return;
    }

    const shouldIgnore = config.get('ignoreConfirmWarning') === true;
    if (shouldIgnore) {
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

function warn(message: string, showMessage: boolean = false) {
    client.warn(message);
    if (showMessage) {
        vscode.window.showWarningMessage(message);
    }
}

function isEmbedded(): boolean {
    return getDeepScanConfiguration().get("serverEmbedded.enable");
}

function runServer(): Thenable<StreamInfo> {
    return new Promise((resolve, reject) => {
        const serverJar: string = getDeepScanConfiguration().get('serverEmbedded.serverJar');
        if (!fs.existsSync(serverJar)) {
            const message = 'JAR file for the DeepScan embedded server does not exist. Please set the right path and restart VS Code.';
            warn(message, true);
            // TODO: reject() is the right way?
            return resolve({
                reader: process.stdin,
                writer: process.stdout
            });
        }
        const options = { cwd: vscode.workspace.rootPath };
        const params = [];
        params.push('-jar', serverJar);
        const child = child_process.spawn('java', params, options);
        child.on('error', function (e) {
            client.error('Cannot start the DeepScan server.', e);
            vscode.window.showErrorMessage(`Cannot start the DeepScan server: ${e.message}`);
        });

        console.log('Server spawned: ' + serverJar);
        // Make a wire with the language server.
        resolve({
            reader: child.stdout,
            writer: child.stdin
        });

        child.stderr.on('data', function (data) {
            console.log(data.toString()); 
        });
    });
}
