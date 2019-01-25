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
