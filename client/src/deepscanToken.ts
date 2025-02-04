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

  async showActivationNotification(serverUrl: string) {
    const token = await this.getToken();
    if (token) {
        return;
    }

    const generate = 'Generate Token';
    const neverShowAgain = 'Don\'t show again';
    const message = 'An access token is required for using the DeepScan extension.';
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

  async showSuspendedTokenNotification(serverUrl: string) {
    const goToSite = 'Go to Site';
    const message = `Your DeepScan access token was suspended. Visit DeepScan site to check your plan in the team settings page.`;
    const selected = await vscode.window.showErrorMessage(message, goToSite);
    if (selected === goToSite) {
      vscode.env.openExternal(vscode.Uri.parse(serverUrl));
    }
  }
}