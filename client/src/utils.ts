/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';

import { LanguageClient, ExecuteCommandParams, ExecuteCommandRequest } from 'vscode-languageclient';

export function warn(client: LanguageClient, message: string, showMessage: boolean = false) {
    client && client.warn(message);

    showMessage && vscode.window.showWarningMessage(message);
}

export function sendRequest(client: LanguageClient, command: string, successCallback, args: any[] = []) {
    const params: ExecuteCommandParams = {
        command,
        arguments: args
    }

    client.sendRequest(ExecuteCommandRequest.type, params).then(successCallback, (error) => {
        console.error('Server failed', error);
        vscode.window.showErrorMessage('Failed to send a request. Please consider opening an issue with steps to reproduce.');
    });
}

export function updateTokenRequest(client: LanguageClient, newToken: string) {
    const params: ExecuteCommandParams = {
        command: 'deepscan.updateToken',
        arguments: [ newToken ]
    };

    client.sendRequest(ExecuteCommandRequest.type, params).then(null, (error) => {
        console.error('Server failed', error);
        vscode.window.showErrorMessage('Failed to send a request for updating DeepScan access token. Please consider opening an issue with steps to reproduce.');
    });
}

export function detachSlash(path) {
    let len = path.length;
    if (path && path[len - 1] === '/') {
        return path.substring(0, len - 1);
    } else {
        return path;
    }
}
