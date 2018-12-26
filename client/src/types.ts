/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { NotificationType } from 'vscode-languageclient';

export namespace CommandIds {
    export const showOutput: string = 'deepscan.showOutputView';
}

export enum Status {
    none = 0,
    ok = 1, // No alarm
    warn = 2, // Any alarm regardless of impact
    fail = 3 // Analysis failed
}

// "severity" of client.diagnostics. Seems not to comply with the DiagnosticSeverity of language-server.
export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2
}

export interface Suggestion {
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
    message: string,
    severity: number
}

export interface StatusParams {
    state: Status,
    message: string,
    uri: string,
    suggestions: Suggestion[]
}

export namespace StatusNotification {
    export const type = new NotificationType<StatusParams, void>('deepscan/status');
}
