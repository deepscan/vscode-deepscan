/* --------------------------------------------------------------------------------------------
 * Copyright (c) S-Core Co., Ltd. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';

export class DeepscanToken {
  private readonly _secretStorage: vscode.SecretStorage;
  private tokenName: string;
  private serverUrl: string;
  private tokenGuideUrl: string;
  private tokenRegenerateUrl: string;

  constructor(context: vscode.ExtensionContext, serverUrl: string) {
    this._secretStorage = context.secrets;
    this._registerCommands();
    context.subscriptions.push(context.secrets.onDidChange((e) => this._handleSecretChange(e)));
    this.tokenName = 'deepscan-token';
    this.serverUrl = serverUrl;
    this.tokenGuideUrl = `${serverUrl}/docs/deepscan/vscode#token`;
    this.tokenRegenerateUrl = `${serverUrl}/dashboard/#view=account-settings`;
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
    vscode.commands.executeCommand('deepscan.updateToken');
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
        await this.setToken(tokenInput);
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
          vscode.window.showInformationMessage(`Deepscan access token is successfully deleted.`);
        }
      } else {
        vscode.window.showInformationMessage(`Nothing to delete. DeepScan access token is currently not registered.`);
      }
    });
  }

  async showActivationNotification() {
    const token = await this.getToken();
    if (token) {
        return;
    }

    const generate = 'Generate Token';
    const neverShowAgain = 'Don\'t show again';
    const message =
      'An access token is required for using the DeepScan extension. ' +
      'DeepScan server uses the token to provide reliable and managed inspection of your code.';
    const selected = await vscode.window.showWarningMessage(message, generate, neverShowAgain);
    if (selected === generate) {
        vscode.env.openExternal(vscode.Uri.parse(this.tokenGuideUrl));
    }
    return selected;
  }

  async showExpiredTokenNotification() {
    const regenerate = 'Regenerate Token';
    const message = `Your DeepScan access token has expired. Regenerate it to continue inspecting your code with DeepScan.`;
    const selected = await vscode.window.showErrorMessage(message, regenerate);
    if (selected === regenerate) {
      vscode.env.openExternal(vscode.Uri.parse(this.tokenRegenerateUrl));
    }
  }

  async showInvalidTokenNotification() {
    const regenerate = 'Regenerate Token';
    const message = `Your DeepScan access token is not valid. Regenerate it and make sure to copy the currect token string.`;
    const selected = await vscode.window.showErrorMessage(message, regenerate);
    if (selected === regenerate) {
      vscode.env.openExternal(vscode.Uri.parse(this.tokenRegenerateUrl));
    }
  }
}