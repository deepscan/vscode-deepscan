/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as _ from 'lodash';
import ignore from 'ignore';

import {
    createConnection, IConnection,
    NotificationType, Diagnostic, DiagnosticSeverity,
    TextDocuments, TextDocument, TextDocumentSyncKind, VersionedTextDocumentIdentifier,
    TextDocumentPositionParams, CompletionItem, CompletionItemKind,
    IPCMessageReader, IPCMessageWriter, ExecuteCommandParams
} from 'vscode-languageserver';
import { URL } from 'url';

const path = require('path');
const axios = require('axios').default;
const FormData = require('form-data');

enum Status {
    none = 0,
    ok = 1,
    warn = 2,
    fail = 3,

    EMPTY_TOKEN = 10,
    INVALID_TOKEN = 11,
    EXPIRED_TOKEN = 12,
    SUSPENDED_TOKEN = 13
}

interface StatusParams {
    state: Status,
    message: string,
    uri: string
}

namespace StatusNotification {
    export const type = new NotificationType<StatusParams, void>('deepscan/status');
}

namespace CommandIds {
}

interface Settings {
    deepscan: {
        enable?: boolean;
        server?: string;
        proxy?: string;
        ignoreRules?: (string)[];
        ignorePatterns?: (string)[];
        fileSuffixes?: (string)[];
    }
}

function convertSeverity(impact: string): DiagnosticSeverity {
    switch (impact) {
        case 'Low':
            return DiagnosticSeverity.Warning;
        case 'Medium':
            return DiagnosticSeverity.Error;
        case 'High':
            return DiagnosticSeverity.Error;
        default:
            return DiagnosticSeverity.Information;
    }
}

const exitCalled = new NotificationType<[number, string], void>('deepscan/exitCalled');

const nodeExit = process.exit;
process.exit = ((code?: number) => {
    let stack = new Error('stack');
    connection.sendNotification(exitCalled, [code ? code : 0, stack.stack]);
    setTimeout(() => {
        nodeExit(code);
    }, 1000);
}) as any;

let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
let settings: Settings = null;
let documents: TextDocuments = new TextDocuments();

let supportedFileSuffixes: string[] = null;

// options
let enable: boolean = undefined;
let token:string = undefined;
let deepscanServer: string = undefined;
let proxyServer: string = undefined;
let userAgent: string = undefined;
let ignoreRules: string[] = null;
let ignorePatterns: string[] = null;
let DEFAULT_FILE_SUFFIXES: string[] = null;
let fileSuffixes: string[] = null;

function supportsLanguage(document: TextDocument): boolean {
    return _.includes(supportedFileSuffixes, path.extname(document.uri));
}

// The documents manager listen for text document create, change
// and close on the connection
documents.listen(connection);
documents.onDidOpen((event) => {
    if (!supportsLanguage(event.document)) {
        return;
    }

    inspect(event.document);
});

// A text document has been saved. Validate the document according the run setting.
documents.onDidSave((event) => {
    inspect(event.document);
});

documents.onDidClose((event) => {
    if (!supportsLanguage(event.document)) {
        return;
    }
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

function getServerUrl(url) {
    return detachSlash(url);
}

function initializeSupportedFileSuffixes() {
    supportedFileSuffixes = _.union(DEFAULT_FILE_SUFFIXES, fileSuffixes);
}

connection.onInitialize((params) => {
    let initOptions: {
        server: string;
        token: string;
        proxy: string;
        DEFAULT_FILE_SUFFIXES: string[];
        fileSuffixes: string[];
        userAgent: string;
    } = params.initializationOptions;
    deepscanServer = getServerUrl(initOptions.server);
    proxyServer = initOptions.proxy;
    token = initOptions.token;

    DEFAULT_FILE_SUFFIXES = initOptions.DEFAULT_FILE_SUFFIXES;
    fileSuffixes = initOptions.fileSuffixes;
    initializeSupportedFileSuffixes();

    userAgent = initOptions.userAgent;
    connection.console.info(`Server: ${deepscanServer} (${userAgent})`);
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.None,
            executeCommandProvider: {
                commands: []
            },
            // Tell the client that the server support code complete
            completionProvider: {
                resolveProvider: true
            }
        }
    };
});

// Note that it may not be triggered when the workspace in on Samba filesystem.
connection.onDidChangeConfiguration((params) => {
    settings = params.settings || {};

    let changed = false;

    if (!_.isEqual(deepscanServer, settings.deepscan.server)) {
        deepscanServer = getServerUrl(settings.deepscan.server);
        changed = true;
    }

    if (!_.isEqual(proxyServer, settings.deepscan.proxy)) {
        proxyServer = settings.deepscan.proxy;
        changed = true;
    }

    if (!_.isEqual(fileSuffixes, settings.deepscan.fileSuffixes)) {
        initializeSupportedFileSuffixes();
        changed = true;
    }

    if (changed) {
        connection.console.info(`Configuration changed: ${deepscanServer} (proxy: ${proxyServer}, fileSuffixes: ${fileSuffixes})`);
    }
});

connection.onExecuteCommand((e: ExecuteCommandParams) => {
    if (e.command === 'deepscan.updateToken') {
        token = e.arguments[0];
    }
});

connection.onRequest('deepscan.getTokenInfo', async () => {
    try {
        const apiPath = `${deepscanServer}/api/vscode/tokeninfo`;
        const response = await axios.post(apiPath,
            { date: Date.now() }, // Dummy payload for ensuring a "Content-Type" field
            {
                proxy: parseProxy(proxyServer),
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "user-agent": userAgent
                },
            }
        );
        return response.data.data;
    } catch (err) {
        let message = err?.response?.data?.reason || err.message;
        return { error: message };
    }
});

connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    return [{
        label: 'deepscan-disable',
        kind: CompletionItemKind.Text,
        data: 1
    }, {
        label: 'deepscan-enable',
        kind: CompletionItemKind.Text,
        data: 2
    }, {
        label: 'deepscan-disable-line',
        kind: CompletionItemKind.Text,
        data: 3
    }, {
        label: 'deepscan-disable-next-line',
        kind: CompletionItemKind.Text,
        data: 4
    }];
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    switch (item.data) {
        case 1:
            item.detail = 'DeepScan directives';
            item.documentation = 'Disable rules from the position';
            break;
        case 2:
            item.detail = 'DeepScan directives';
            item.documentation = 'Enable rules from the position';
            break;
        case 3:
            item.detail = 'DeepScan directives';
            item.documentation = 'Disable rules in the current line';
            break;
        case 4:
            item.detail = 'DeepScan directives';
            item.documentation = 'Disable rules in the next line';
            break;
    }
    return item;
});

connection.listen();

function parseProxy(proxyUrl) {
    if (!proxyUrl) return null;
    const url = new URL(proxyUrl);
    const proxySetting = {
        host: url.hostname,
        port: url.port,
        auth: null
    };
    if (url.username || url.password) {
        proxySetting.auth = {
            username: url.username,
            password: url.password
        }
    }
    return proxySetting;
}

async function inspect(identifier: VersionedTextDocumentIdentifier) {
    const guideUrl = `${deepscanServer}/docs/deepscan/vscode#token`;
    const generateUrl = `${deepscanServer}/dashboard/#view=account-settings`;

    let uri = identifier.uri;
    let textDocument = documents.get(uri);
    let docContent = textDocument.getText();

    const URL = `${deepscanServer}/api/vscode/analysis`;
    const MAX_LINES = 10000;
    const MAX_CHARS = 500000;

    function sendDiagnostics(diagnostics) {
        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
    }

    if (!token) {
        const message = `Failed to inspect: DeepScan access token not configured. Visit ${guideUrl} to generate a token.`;
        connection.console.error(message);
        sendDiagnostics([]);
        connection.sendNotification(StatusNotification.type, {
            state: Status.EMPTY_TOKEN,
            message,
            uri: null,
        });
        return;
    }

    if (docContent.trim() === '') {
        sendDiagnostics([]);
        return;
    }

    if (Array.isArray(settings.deepscan.ignorePatterns)) {
        const ig = ignore().add(settings.deepscan.ignorePatterns);
        if (ig.ignores(uri)) {
            sendDiagnostics([]);
            return;
        }
    }

    if (textDocument.lineCount > MAX_LINES) {
        connection.console.info(`Sorry! We do not support files exceeding ${MAX_LINES} lines.`);
        sendDiagnostics([]);
        return;
    }

    if (docContent.length > MAX_CHARS) {
        connection.console.info(`Sorry! We do not support files exceeding ${MAX_CHARS} characters.`);
        sendDiagnostics([]);
        return;
    }

    // Send filename with extension to parse correctly in server.
    let fileSuffix = path.extname(uri);
    // The file with a suffix in 'fileSuffixes' will be transmitted as a '.js' file.
    if (fileSuffixes.indexOf(fileSuffix) !== -1) {
        fileSuffix = ".js";
    }
    let filename = `demo${fileSuffix}`;

    try {
        const form = new FormData();
        form.append("file", docContent, {
            filename,
            contentType: "text/plain",
        });
        const response = await axios.post(URL, form, {
            proxy: parseProxy(proxyServer),
            headers: {
                "Authorization": `Bearer ${token}`,
                "user-agent": userAgent,
                ...form.getHeaders(),
            },
        });
        let diagnostics: Diagnostic[] = getResult(response.data.data);

        if (Array.isArray(settings.deepscan.ignoreRules)) {
            diagnostics = diagnostics.filter(diagnostic =>
                !settings.deepscan.ignoreRules.includes(diagnostic.code as string)
            );
        }

        // Publish the diagnostics
        sendDiagnostics(diagnostics);
        connection.sendNotification(StatusNotification.type, {
            state: diagnostics.length > 0 ? Status.warn : Status.ok,
            message: null,
            uri,
        });
    } catch (err) {
        let message = err?.response?.data?.reason || err.message;
        // Clear problems
        sendDiagnostics([]);
        let state: Status = Status.fail;
        const isTokenMessage = message.includes('token');
        if (isTokenMessage && message.includes('expired')) {
            state = Status.EXPIRED_TOKEN;
            message = `DeepScan access token has expired. Visit ${generateUrl} to regenerate the token.`;
        } else if (isTokenMessage && message.includes('Invalid')) {
            state = Status.INVALID_TOKEN;
            message = `invalid DeepScan access token. Visit ${generateUrl} to regenerate the token and make sure to copy the correct token string.`;
        } else if (isTokenMessage && message.includes('Suspended')) {
            state = Status.SUSPENDED_TOKEN;
            message = `DeepScan access token was suspended. Visit ${deepscanServer} to check your plan in the team settings page.`;
        }
        connection.console.error(`Failed to inspect: ${message}`);
        connection.sendNotification(StatusNotification.type, {
            state,
            message,
            uri: null,
        });
    }
}

function getResult(result): Diagnostic[] {
    let alarms = result.alarms;
    let diagnostics: Diagnostic[] = [];
    alarms.forEach((alarm) => {
        let diagnostic = makeDiagnostic(alarm);
        diagnostics.push(diagnostic);
    });
    return diagnostics;
}

function makeDiagnostic(alarm): Diagnostic {
    const message = alarm.message;
    const l = parseLocation(alarm.location);
    const startLine = Math.max(0, l.startLine - 1);
    const startChar = Math.max(0, l.startCh - 1);
    const endLine = l.endLine != null ? Math.max(0, l.endLine - 1) : startLine;
    const endChar = l.endCh != null ? Math.max(0, l.endCh - 1) : startChar;
    return {
        message: `${message}`, // VS Code displays 'code' like '<message> [<code>]'
        severity: convertSeverity(alarm.impact),
        source: 'deepscan',
        range: {
            start: { line: startLine, character: startChar },
            end: { line: endLine, character: endChar }
        },
        code: alarm.name
    };
}

function parseLocation(location) {
    const startLocation = location.split('-')[0], endLocation = location.split('-')[1];
    const startLine = Number(startLocation.split(':')[0]), startCh = Number(startLocation.split(':')[1]);
    const endLine = Number(endLocation.split(':')[0]), endCh = Number(endLocation.split(':')[1]);
    return {
        startLine: startLine,
        startCh: startCh,
        endLine: endLine,
        endCh: endCh
    }
}

function detachSlash(path) {
    let len = path.length;
    if (len && path[len - 1] === '/') {
        return path.substr(0, len - 1);
    } else {
        return path;
    }
}
