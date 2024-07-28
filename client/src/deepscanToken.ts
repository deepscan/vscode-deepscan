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
  private tokenRegenerateUrl: string;

  constructor(context: vscode.ExtensionContext, serverUrl: string) {
    this._secretStorage = context.secrets;
    this._registerCommands();
    context.subscriptions.push(context.secrets.onDidChange((e) => this._handleSecretChange(e)));
    this.tokenName = 'deepscan-token';
    this.serverUrl = serverUrl;
    this.tokenRenerateUrl = `${serverUrl}/auth/git?redirect_uri=/dashboard/#view=account-settings`;
  }

  private _validateToken(token: string) {
   if (!token) {
      vscode.window.showWarningMessage(`Access token cannot be blank.`);
      return false;
   }
    return true;
  }

  setToken(token: string) {
    this._secretStorage.store(this.tokenName, token);
  }

  async getToken() {
    return await this._secretStorage.get(this.tokenName);
  }

  deleteToken() {
    this._secretStorage.delete(this.tokenName);
  }

  private async _handleSecretChange(e: vscode.SecretStorageChangeEvent) {
    vscode.commands.executeCommand('deepscan.updateToken');
  }

  private _registerCommands() {
    vscode.commands.registerCommand('deepscan.setToken', async () => {
      let tokenInput: string = await vscode.window.showInputBox({
          title: "Configure DeepScan Access Token"
      }) ?? '';
      tokenInput = tokenInput.trim();
      if (this._validateToken(tokenInput)) {
        this.setToken(tokenInput);
        vscode.window.showInformationMessage(`DeepScan access token has successfully configured.`);
      }
    });
    vscode.commands.registerCommand('deepscan.deleteToken', async () => {
      const token = await this.getToken();
      if (token) {
        const deleteAction = 'Delete';
        const cancel = 'Cancel';
        const message = `Are you sure you want to delete the DeepScan access token? DeepScan extension will no longer be able to inspect your code.`;
        const selected = await vscode.window.showWarningMessage(message, deleteAction, cancel);
        if (selected === deleteAction) {
          this.deleteToken();
          vscode.window.showInformationMessage(`Deepscan access token is successfully deleted.`);
        }
      } else {
        vscode.window.showInformationMessage(`Nothing to delete. DeepScan access token is currently not registered.`);
      }
    });
  }

  async showOneOffTokenNotification() {
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
        vscode.env.openExternal(vscode.Uri.parse(this.tokenRenerateUrl));
    }
    return selected;
  }

  async showEmptyTokenNotification() {
    const generate = 'Generate';
    const message = `Sorry, DeepScan access token is not configured.
    You can generate a new token by clicking on the button below to go to DeepScan Account Settings page.`;
    const selected = await vscode.window.showErrorMessage(message, generate);
    if (selected === generate) {
      vscode.env.openExternal(vscode.Uri.parse(this.tokenRenerateUrl));
    }
  }

  async showExpiredTokenNotification() {
    const regenerate = 'Regenerate Token';
    const message = `Your DeepScan access token has expired. Regenerate it to continue inspecting your code with DeepScan.`;
    const selected = await vscode.window.showErrorMessage(message, regenerate);
    if (selected === regenerate) {
      vscode.env.openExternal(vscode.Uri.parse(this.tokenRenerateUrl));
    }
  }

  async showInvalidTokenNotification() {
    const check = 'Go to DeepScan';
    const message = `Your DeepScan access token is not valid. Regenerate it and make sure to copy the currect token string.`;
    const selected = await vscode.window.showErrorMessage(message, check);
    if (selected === check) {
      vscode.env.openExternal(vscode.Uri.parse(this.serverUrl));
    }
  }
}