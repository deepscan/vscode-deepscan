# VS Code DeepScan extension

Extension to integrate [DeepScan](https://deepscan.io) into VS Code.

DeepScan is a JavaScript code inspection tool that helps you to find problems in your code.

**Note:**

To use this extension, you should confirm that your code is transferred to the DeepScan server for inspection when you save your changes.

You can confirm it by pressing the Confirm button that appears when you re-start VS Code after the installation.

Note that your code is completely deleted from the server right after the inspection.

## Settings Options

This extension contributes the following variables to the settings:

- `deepscan.enable`: enable/disable DeepScan. Disabled by default. Enabled on per workspace when you confirm.
- `deepscan.server`: set an url of DeepScan server. "https://deepscan.io" by default.

## Commands

This extension contributes the following commands to the Command palette.

- `Inspect Code`: inspect the current JavaScript file.
