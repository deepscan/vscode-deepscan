/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';

export class DeepscanToken {
  private readonly _secretStorage: vscode.SecretStorage;
  private tokenName: string;

  constructor(context: vscode.ExtensionContext) {
    this._secretStorage = context.secrets;
    this._registerCommands();
    context.subscriptions.push(context.secrets.onDidChange((e) => this._handleSecretChange(e)));
    this.tokenName = 'deepscan-token';
  }

  setToken(token: string): Thenable<void> {
    return this._secretStorage.store(this.tokenName, token);
  }

  async getToken(): Promise<string> {
    return await this._secretStorage.get(this.tokenName);
  }

  deleteToken(): Thenable<void>{
    return this._secretStorage.delete(this.tokenName);
  }

  private async _handleSecretChange(e: vscode.SecretStorageChangeEvent) {
    if (e.key === this.tokenName) {
      vscode.commands.executeCommand('deepscan.updateToken');
    }
  }

  private _registerCommands() {
    vscode.commands.registerCommand('deepscan.setToken', async () => {
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
        await this.setToken(tokenInput.trim());
      }
    });

    vscode.commands.registerCommand('deepscan.deleteToken', async () => {
      const token = await this.getToken();
      if (token) {
        const deleteAction: vscode.MessageItem = { title: 'Delete' };
        const cancelAction: vscode.MessageItem = { title: 'Cancel', isCloseAffordance: true };
        const message = `Are you sure you want to delete the DeepScan access token? DeepScan extension will no longer be able to inspect your code.`;
        const selected = await vscode.window.showWarningMessage(message, { modal: true }, deleteAction, cancelAction);
        if (selected === deleteAction) {
          await this.deleteToken();
        }
      } else {
        vscode.window.showInformationMessage(`Nothing to delete. DeepScan access token is currently not registered.`);
      }
    });
  }

  async showActivationNotification(serverUrl: string) {
    const token = await this.getToken();
    if (token) {
        return;
    }

    const generate = 'Generate Token';
    const neverShowAgain = 'Don\'t show again';
    const message =
      'An access token is required for using the DeepScan extension. ' +
      'DeepScan server uses the token to provide reliable and prompt inspection of your code.';
    const selected = await vscode.window.showWarningMessage(message, generate, neverShowAgain);
    if (selected === generate) {
      const tokenGuideUrl = `${serverUrl}/docs/deepscan/vscode#token`;
      vscode.env.openExternal(vscode.Uri.parse(tokenGuideUrl));
    }
    return selected;
  }

  async showExpiredTokenNotification(serverUrl: string) {
    const regenerate = 'Regenerate Token';
    const message = `Your DeepScan access token has expired. Regenerate it to continue inspecting your code with DeepScan.`;
    const selected = await vscode.window.showErrorMessage(message, regenerate);
    if (selected === regenerate) {
      const tokenRegenerateUrl = `${serverUrl}/dashboard/#view=account-settings`;
      vscode.env.openExternal(vscode.Uri.parse(tokenRegenerateUrl));
    }
  }

  async showInvalidTokenNotification(serverUrl: string) {
    const regenerate = 'Regenerate Token';
    const message = `Your DeepScan access token is not valid. Regenerate it and make sure to copy the currect token string.`;
    const selected = await vscode.window.showErrorMessage(message, regenerate);
    if (selected === regenerate) {
      const tokenRegenerateUrl = `${serverUrl}/dashboard/#view=account-settings`;
      vscode.env.openExternal(vscode.Uri.parse(tokenRegenerateUrl));
    }
  }
}