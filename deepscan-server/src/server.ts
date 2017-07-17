/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as fs from 'fs';
import * as _ from 'lodash';

import {
    createConnection, IConnection,
    ResponseError, NotificationType, InitializeResult, InitializeError,
    Diagnostic, DiagnosticSeverity, Files,
    TextDocuments, TextDocument, TextDocumentSyncKind, VersionedTextDocumentIdentifier,
    IPCMessageReader, IPCMessageWriter
} from 'vscode-languageserver';

var request = require('request');

enum Status {
    none = 0,
    ok = 1,
    warn = 2,
    fail = 3
}

interface StatusParams {
    state: Status
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

let workspaceRoot: string = undefined;

let deepscanServer: string = undefined;
let userAgent: string = undefined;

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

connection.onInitialize((params): Thenable<InitializeResult | ResponseError<InitializeError>>  | InitializeResult | ResponseError<InitializeError> => {
    let initOptions: {
        server: string;
        languageIds: string[];
        userAgent: string;
    } = params.initializationOptions;
    workspaceRoot = params.rootPath;
    deepscanServer = getServerUrl(initOptions.server);
    supportedLanguageIds = initOptions.languageIds;
    userAgent = initOptions.userAgent;
    connection.console.info(`Server: ${deepscanServer} (${userAgent})`);
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.None,
            executeCommandProvider: {
                commands: [CommandIds.inspectCode]
            }
        }
    };
});

connection.onDidChangeConfiguration((params) => {
    settings = params.settings || {};
    settings.deepscan = settings.deepscan || {};

    if (settings.deepscan.server) {
        let oldServer = deepscanServer;
        deepscanServer = getServerUrl(settings.deepscan.server);
        if (deepscanServer === oldServer) {
            return;
        }
        connection.console.info(`Configuration changed: ${deepscanServer}`);
        // Reinspect any open text documents
        documents.all().forEach(inspect);
    }
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

    if (docContent.trim() === '') {
        connection.sendNotification(StatusNotification.type, { state: Status.none });
        return;
    }

    request.post({
        url: URL,
        headers : {
            'content-type': 'application/octet-stream',
            'user-agent': userAgent
        },
        body: docContent
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            let diagnostics: Diagnostic[] = getResult(JSON.parse(body).data);
            // Publish the diagnostics
            connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
            connection.sendNotification(StatusNotification.type, { state: diagnostics.length > 0 ? Status.warn : Status.ok });
        } else {
            connection.console.error('Failed to inspect: ' + error.message);
            // Clear problems
            connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
            connection.sendNotification(StatusNotification.type, { state: Status.fail });
        }
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
        message: message,
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
