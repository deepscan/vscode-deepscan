/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as _ from 'lodash';

import {
    createConnection, IConnection,
    NotificationType, Diagnostic, DiagnosticSeverity,
    TextDocuments, TextDocument, TextDocumentSyncKind, VersionedTextDocumentIdentifier,
    TextDocumentPositionParams, CompletionItem, CompletionItemKind,
    IPCMessageReader, IPCMessageWriter
} from 'vscode-languageserver';

var path = require('path');
var request = require('request');

enum Status {
    none = 0,
    ok = 1,
    warn = 2,
    fail = 3
}

interface StatusParams {
    state: Status,
    error: string
}

namespace StatusNotification {
    export const type = new NotificationType<StatusParams, void>('deepscan/status');
}

namespace CommandIds {
    export const inspectCode: string = 'deepscan.tryInspect';
}

interface Settings {
    deepscan: {
        enable?: boolean;
        server?: string;
        ignoreRules?: (string)[];
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
process.exit = (code?: number) => {
    let stack = new Error('stack');
    connection.sendNotification(exitCalled, [code ? code : 0, stack.stack]);
    setTimeout(() => {
        nodeExit(code);
    }, 1000);
}

let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
let settings: Settings = null;
let documents: TextDocuments = new TextDocuments();

let supportedLanguageIds: string[] = null;

let deepscanServer: string = undefined;
let userAgent: string = undefined;
let ignoreRules: string[] = null;

function supportsLanguage(document: TextDocument): boolean {
    return _.includes(supportedLanguageIds, document.languageId);
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

connection.onInitialize((params) => {
    let initOptions: {
        server: string;
        languageIds: string[];
        userAgent: string;
    } = params.initializationOptions;
    deepscanServer = getServerUrl(initOptions.server);
    supportedLanguageIds = initOptions.languageIds;
    userAgent = initOptions.userAgent;
    connection.console.info(`Server: ${deepscanServer} (${userAgent})`);
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.None,
            executeCommandProvider: {
                commands: [CommandIds.inspectCode]
            },
            // Tell the client that the server support code complete
            completionProvider: {
                resolveProvider: true
            }
        }
    };
});

connection.onDidChangeConfiguration((params) => {
    settings = params.settings || {};
    settings.deepscan = settings.deepscan || {};

    let changed = false;
    if (settings.deepscan.server) {
        let oldServer = deepscanServer;
        deepscanServer = getServerUrl(settings.deepscan.server);
        if (deepscanServer !== oldServer) {
            changed = true;
        }
    }
    if (settings.deepscan.ignoreRules) {
        let oldRules = ignoreRules;
        ignoreRules = settings.deepscan.ignoreRules;
        if (!_.isEqual(ignoreRules, oldRules)) {
            changed = true;
        }
    }

    if (changed) {
        connection.console.info(`Configuration changed: ${deepscanServer}`);
        // Reinspect any open text documents
        documents.all().forEach(inspect);
    }
});

connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    return [
        {
            label: 'deepscan-disable',
            kind: CompletionItemKind.Text,
            data: 1
        },
        {
            label: 'deepscan-enable',
            kind: CompletionItemKind.Text,
            data: 2
        },
        {
            label: 'deepscan-disable-line',
            kind: CompletionItemKind.Text,
            data: 3
        },
        {
            label: 'deepscan-enable-line',
            kind: CompletionItemKind.Text,
            data: 4
        }
    ]
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    switch (item.data) {
        case 1:
            item.detail = 'DeepScan directives',
            item.documentation = 'Disable rules from the position'
            break;
        case 2:
            item.detail = 'DeepScan directives',
            item.documentation = 'Enable rules from the position'
            break;
        case 3:
            item.detail = 'DeepScan directives',
            item.documentation = 'Disable rules in the current line'
            break;
        case 4:
            item.detail = 'DeepScan directives',
            item.documentation = 'Disable rules in the next line'
            break;
    }
    return item;
});

connection.onExecuteCommand((params) => {
    if (params.command === CommandIds.inspectCode) {
        let identifier: VersionedTextDocumentIdentifier = params.arguments[0];
        inspect(identifier);
    }
});
connection.listen();

function inspect(identifier: VersionedTextDocumentIdentifier) {
    let uri = identifier.uri;
    let textDocument = documents.get(uri);
    let docContent = textDocument.getText();

    const URL = deepscanServer + '/api/demo';
    const MAX_LINES = 30000;

    function sendDiagnostics(diagnostics) {
        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
    }

    if (docContent.trim() === '') {
        sendDiagnostics([]);
        connection.sendNotification(StatusNotification.type, { state: Status.none });
        return;
    }

    if (textDocument.lineCount >= MAX_LINES) {
        connection.console.info(`Sorry! We do not support above ${MAX_LINES} lines.`);
        sendDiagnostics([]);
        connection.sendNotification(StatusNotification.type, { state: Status.none });
        return;
    }

    // Send filename with extension to parse correctly in server
    let filename = `demo${path.extname(uri)}`;

    let req = request.post({
        url: URL,
        headers : {
            'user-agent': userAgent,
        }
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            let diagnostics: Diagnostic[] = getResult(JSON.parse(body).data);

            if (Array.isArray(settings.deepscan.ignoreRules)) {
                diagnostics = _.filter(diagnostics, (diagnostic) => !_.includes(settings.deepscan.ignoreRules, diagnostic.code));
            }

            // Publish the diagnostics
            sendDiagnostics(diagnostics);
            connection.sendNotification(StatusNotification.type, { state: diagnostics.length > 0 ? Status.warn : Status.ok });
        } else {
            let message = error ? error.message : parseSilently(body);
            connection.console.error(`Failed to inspect: ${message}`);
            // Clear problems
            sendDiagnostics([]);
            connection.sendNotification(StatusNotification.type, { state: Status.fail, error: message });
        }
    });
    var form = req.form();
    form.append('file', docContent, {
        filename,
        contentType: 'text/plain'
    });
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
    let message = alarm.message;
    let l = parseLocation(alarm.location);
    let startLine = Math.max(0, l.startLine - 1);
    let startChar = Math.max(0, l.startCh - 1);
    let endLine = l.endLine != null ? Math.max(0, l.endLine - 1) : startLine;
    let endChar = l.endCh != null ? Math.max(0, l.endCh - 1) : startChar;
    return {
        message: `${message} (${alarm.name})`,
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
    var startLocation = location.split('-')[0], endLocation = location.split('-')[1];
    var startLine = Number(startLocation.split(':')[0]), startCh = Number(startLocation.split(':')[1]);
    var endLine = Number(endLocation.split(':')[0]), endCh = Number(endLocation.split(':')[1]);
    return {
        startLine: startLine,
        startCh: startCh,
        endLine: endLine,
        endCh: endCh
    }
}

function detachSlash(path) {
    var len = path.length;
    if (path[len - 1] === '/') {
        return path.substr(0, len - 1);
    } else {
        return path;
    }
}

function parseSilently(body) {
    try {
        return JSON.parse(body).reason;
    } catch (e) {
        return null;
    }
}
