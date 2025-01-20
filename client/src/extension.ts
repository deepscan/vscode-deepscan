/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as child_process from 'child_process';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import {
    LanguageClient, LanguageClientOptions, SettingMonitor, TransportKind,
    NotificationType, ErrorHandler, DocumentSelector,
    ErrorAction, CloseAction, State as ClientState,
    RevealOutputChannelOn,
    StreamInfo
} from 'vscode-languageclient';

import { CommandIds, Status, StatusNotification, StatusParams, GetTokenInfoResponse } from './types';

import disableRuleCodeActionProvider from './actions/disableRulesCodeActionProvider';
import showRuleCodeActionProvider from './actions/showRuleCodeActionProvider';

import { activateDecorations } from './deepscanDecorators';
import { DeepscanToken } from './deepscanToken';

import { StatusBar } from './StatusBar';
import { sendRequest, updateTokenRequest, warn, detachSlash, formatDate } from './utils';

const packageJSON = vscode.extensions.getExtension('DeepScan.vscode-deepscan').packageJSON;

// Just use file extensions rather than languageIds because a languageId needs an installation of the language.
const DEFAULT_FILE_SUFFIXES = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs'];
const DIAGNOSTIC_SOURCE_NAME = 'deepscan';

let oldConfig;

const exitCalled = new NotificationType<[number, string], void>('deepscan/exitCalled');

let client: LanguageClient = null;

export function activate(context: vscode.ExtensionContext) {
    console.log(`Activating ${packageJSON.name}... (workspace: ${vscode.workspace.rootPath})`);

    activateClient(context);
    console.log(`Congratulations, your extension "${packageJSON.name} ${packageJSON.version}" is now active!`);
}

async function activateClient(context: vscode.ExtensionContext) {
    let statusBarMessage: vscode.Disposable = null;

    async function handleTokenNotification(params: StatusParams) {
        if (context.globalState.get('isExpiredOrInvalidTokenWarningDisabled') === true) {
            return;
        }
        context.globalState.update('isExpiredOrInvalidTokenWarningDisabled', true);
        switch (params.state) {
            case Status.EXPIRED_TOKEN:
                await deepscanToken.showExpiredTokenNotification(getServerUrl());
                break;
            case Status.INVALID_TOKEN:
                await deepscanToken.showInvalidTokenNotification(getServerUrl());
                break;
            case Status.SUSPENDED_TOKEN:
                await deepscanToken.showSuspendedTokenNotification(getServerUrl());
                break;
        }
    }

    function updateStatus(status: Status) {
        statusBar.update(status);
        updateStatusBar(vscode.window.activeTextEditor);
    }

    function clearNotification() {
        statusBarMessage && statusBarMessage.dispose();
    }

    function showNotificationIfNeeded(params: StatusParams) {
        clearNotification();

        if ([Status.fail, Status.EMPTY_TOKEN, Status.INVALID_TOKEN, Status.EXPIRED_TOKEN, Status.SUSPENDED_TOKEN].includes(params.state)) {
            let message = params.message;
            switch (params.state) {
                case Status.EMPTY_TOKEN:
                    message = 'access token not configured';
                    break;
                case Status.EXPIRED_TOKEN:
                    message = 'access token expired';
                    break;
                case Status.INVALID_TOKEN:
                    message = 'invalid access token';
                    break;
                case Status.SUSPENDED_TOKEN:
                    message = 'suspended access token';
                    break;
            }
            statusBarMessage = vscode.window.setStatusBarMessage(`A problem occurred communicating with DeepScan server. (${message})`);
        }
        else if (params.message) {
            statusBarMessage = vscode.window.setStatusBarMessage(`${params.message}`);
        }
    }

    function updateStatusBar(editor: vscode.TextEditor): void {
        const isValidSuffix = editor && _.includes(getSupportedFileSuffixes(getDeepScanConfiguration()), path.extname(editor.document.fileName));
        const status = statusBar.getStatus();
        const needToShowStatusbar = status === Status.fail || status === Status.EMPTY_TOKEN || status == Status.EXPIRED_TOKEN
            || status === Status.INVALID_TOKEN || status === Status.SUSPENDED_TOKEN;
        const show = serverRunning && (needToShowStatusbar || isValidSuffix);
        statusBar.show(show);
    }

    function isConfigurationChanged(key, oldConfig, newConfig) {
        return !_.isEqual(oldConfig.get(key), newConfig.get(key));
    }

    async function changeConfiguration(): Promise<void> {
        clearNotification();

        const newConfig = getDeepScanConfiguration();

        const isChanged = isConfigurationChanged('fileSuffixes', oldConfig, newConfig) ||
                          isConfigurationChanged('serverEmbedded.enable', oldConfig, newConfig) ||
                          isConfigurationChanged('serverEmbedded.serverJar', oldConfig, newConfig);
        const isChangedIgnoreConfig = isConfigurationChanged('ignoreRules', oldConfig, newConfig) ||
                          isConfigurationChanged('ignorePatterns', oldConfig, newConfig);

        // NOTE:
        // To apply changed file suffixes directly, documentSelector of LanguageClient should be changed.
        // But it seems to be impossible, so VS Code needs to restart.
        if (isChanged || (!isEmbedded() && isChangedIgnoreConfig)) {
            oldConfig = newConfig;
            const reload = 'Reload Now';
            const selected = await vscode.window.showInformationMessage('Restart VS Code before the new setting will take affect.', ...[reload]);
            if (selected === reload) {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
    }

    function getFileSuffixes(configuration: vscode.WorkspaceConfiguration): string[] {
        return configuration ? configuration.get('fileSuffixes', []) : [];
    }

    function getSupportedFileSuffixes(configuration: vscode.WorkspaceConfiguration): string[] {
        return _.union(DEFAULT_FILE_SUFFIXES, getFileSuffixes(configuration));
    }

    const statusBar = new StatusBar();
    let serverRunning: boolean = false;

    vscode.window.onDidChangeActiveTextEditor(updateStatusBar);
    updateStatusBar(vscode.window.activeTextEditor);

    const configuration = oldConfig = getDeepScanConfiguration();

    let serverOptions;
    if (isEmbedded()) {
        serverOptions = () => runServer();
    } else {
        const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
        const debugOptions = { execArgv: ['--nolazy', '--inspect=6004'] };
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

    const deepscanToken = new DeepscanToken(context);
    const token = await deepscanToken.getToken();
    let clientOptions: LanguageClientOptions = {
        documentSelector: staticDocuments,
        diagnosticCollectionName: DIAGNOSTIC_SOURCE_NAME,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        synchronize: {
            // Synchronize the setting section 'deepscan' to the server
            configurationSection: 'deepscan'
        },
        initializationOptions: () => {
            return {
                server: getServerUrl(),
                token,
                DEFAULT_FILE_SUFFIXES,
                fileSuffixes: getFileSuffixes(configuration),
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
            statusBar.setTooltip(running);
            serverRunning = true;
        } else {
            client.info(stopped);
            statusBar.setTooltip(stopped);
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
            if (state === Status.INVALID_TOKEN || state == Status.EXPIRED_TOKEN || state === Status.SUSPENDED_TOKEN) {
                handleTokenNotification(params);
            }
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
            const successCallback = () => {
            };

            // Hide decorations early when executing "Inspect Project"
            vscode.window.visibleTextEditors.forEach((editor) => activeDecorations.clearDecorations(editor.document.uri.toString()));

            sendRequest(client, command, successCallback, [diagnostics]);
        }),
        registerEmbeddedCommand('deepscan.clearProject', (command) => {
            const diagnostics = vscode.languages.getDiagnostics();
            sendRequest(client, command, null, [diagnostics]);
        }),
        vscode.commands.registerCommand('deepscan.setToken', async () => {
            if (isEmbedded()) {
                warn(client, 'Not suppored in the embedded mode.', true);
                return;
            }
            let tokenInput: string = await vscode.window.showInputBox({
                title: 'Configure DeepScan Access Token',
                placeHolder: 'Paste your token here',
                password: true,
                validateInput: input => {
                    if (!input.trim()) {
                        return `Access token cannot be blank.`;
                    }
                    return null;
                }
            });
            if (tokenInput) {
                await deepscanToken.setToken(tokenInput.trim());
            }
        }),
        vscode.commands.registerCommand('deepscan.deleteToken', async () => {
            if (isEmbedded()) {
                warn(client, 'Not suppored in the embedded mode.', true);
                return;
            }
            const token = await deepscanToken.getToken();
            if (token) {
              const deleteAction: vscode.MessageItem = { title: 'Delete' };
              const cancelAction: vscode.MessageItem = { title: 'Cancel', isCloseAffordance: true };
              const message = `Are you sure you want to delete the DeepScan access token? DeepScan extension will no longer be able to inspect your code.`;
              const selected = await vscode.window.showWarningMessage(message, { modal: true }, deleteAction, cancelAction);
              if (selected === deleteAction) {
                await deepscanToken.deleteToken();
              }
            } else {
              vscode.window.showInformationMessage(`Nothing to delete. DeepScan access token is currently not registered.`);
            }
        }),
        vscode.commands.registerCommand('deepscan.showTokenInfo', async () => {
            if (isEmbedded()) {
                warn(client, 'Not suppored in the embedded mode.', true);
                return;
            }
            const Regenerate = 'Regenerate Token';
            const GoToSite = 'Go to Site';
            const Close = 'Close';
            let message: string;
            let buttons: string[];

            const token = await deepscanToken.getToken();
            if (!token) {
                message = 'DeepScan access token is currently not registered.';
                buttons = [Close];
            } else {
                const { name, expirationDate, error } = await client.sendRequest<GetTokenInfoResponse>('deepscan.getTokenInfo');
                if (error && error.includes('token') && error.includes('Invalid')) {
                    message = 'Your DeepScan access token is not valid.';
                    buttons = [Regenerate, Close];
                } else if (error && error.includes('token') && error.includes('Suspended')) {
                    message = 'Your DeepScan access token was suspended. Visit DeepScan site to check your plan in the team settings page..';
                    buttons = [GoToSite, Close];
                } else if (error) {
                    message = `Failed to retrieve token information. (${error})`;
                    buttons = [Close];
                } else if (expirationDate === 0) {
                    message = `DeepScan access token '${name}' is in use. It has no expiration date.`;
                    buttons = [Close];
                } else if (expirationDate < Date.now()) {
                    message = `Your DeepScan access token '${name}' has been expired.`
                    buttons = [Regenerate, Close];
                } else {
                    message = `DeepScan access token '${name}' is in use. It will expire on ${formatDate(expirationDate)}.`
                    buttons = [Close];
                }
            }
            const selected = await vscode.window.showInformationMessage(message, ...buttons);
            if (selected === Regenerate) {
                const tokenRegenerateUrl = `${getServerUrl()}/dashboard/#view=account-settings`;
                vscode.env.openExternal(vscode.Uri.parse(tokenRegenerateUrl));
            } else if (selected === GoToSite) {
                vscode.env.openExternal(vscode.Uri.parse(getServerUrl()));
            }
        }),
        vscode.commands.registerCommand(CommandIds.updateToken, async () => {
            if (isEmbedded()) {
                return;
            }
            context.globalState.update('isExpiredOrInvalidTokenWarningDisabled', false);
            const token = await deepscanToken.getToken();
            updateTokenRequest(client, token);
        }),
        vscode.commands.registerCommand(CommandIds.showOutput, () => { client.outputChannel.show(); }),
        statusBar.getStatusBarItem()
    );

    vscode.workspace.onDidChangeConfiguration(changeConfiguration);

    await checkSetting();
    await checkDeepscanToken(context, deepscanToken);
}

function registerEmbeddedCommand(command: string, handler) {
    const embeddedCommand = vscode.commands.registerCommand(command, () => {
        if (!vscode.workspace.rootPath) {
            warn(client, 'Can only be enabled if VS Code is opened on a workspace folder.', true);
            return;
        }

        if (!isEmbedded()) {
            warn(client, 'Supported only in the embedded mode.', true);
            return;
        }

        handler(command);
    });
    return embeddedCommand;
}

async function checkDeepscanToken(context: vscode.ExtensionContext, deepscanToken: DeepscanToken) {
    if (isEmbedded()) {
        return;
    }

    const config = getDeepScanConfiguration();
    if (config.get('enable') === false) {
        return;
    }
    if (context.globalState.get('isEmptyTokenWarningDisabled') === true) {
        return;
    }
    const selected = await deepscanToken.showActivationNotification(getServerUrl());
    if (selected === 'Don\'t show again') {
        context.globalState.update('isEmptyTokenWarningDisabled', true);
    }
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

    const isOpenedOnWorkspace = !!vscode.workspace.rootPath;
    if (!isOpenedOnWorkspace) {
        // Don't want to force update in the user settings.
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

function isEmbedded(): boolean {
    return getDeepScanConfiguration().get('serverEmbedded.enable');
}

function getServerUrl(): string {
    const configuration = getDeepScanConfiguration();
    const defaultUrl = 'https://deepscan.io';
    return configuration ? detachSlash(configuration.get('server', defaultUrl)) : defaultUrl;
}

function runServer(): Thenable<StreamInfo> {
    return new Promise((resolve, reject) => {
        const serverJar: string = getDeepScanConfiguration().get('serverEmbedded.serverJar');
        if (!fs.existsSync(serverJar)) {
            const message = 'JAR file for the DeepScan embedded server does not exist. Please set the right path and restart VS Code.';
            warn(client, message, true);
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
