# VS Code DeepScan extension

VS Code extension to detect bugs and quality issues in JavaScript code including React. Works with [DeepScan](https://deepscan.io).

DeepScan is a cutting-edge JavaScript code inspection tool that helps you to find bugs and quality issues more precisely by data-flow analysis. You can also use it for React because DeepScan delivers [React specific rules](https://deepscan.io/docs/rules/#react).

> **Note:**
> To use this extension, you should confirm that your code is transferred to the DeepScan server for inspection when you save your changes.
> You can confirm it by pressing the Confirm button that appears when restarting VS Code after the installation.
>
> Note that your code is completely deleted from the server right after the inspection.

![Navigation](deepscan/resources/preview.png)

## How it works

- Report issues in Problems panel when you open a JS or JSX file and save it.
- Highlight issues in the code.
- Show a rule description using a code action. When you click the light bulb of the issue, you can see the detailed description of the rule and grasp what's the problem.

## Settings Options

This extension contributes the following variables to the settings:

- `deepscan.enable`: enable/disable DeepScan. Disabled by default. Enabled on per workspace when you confirm.
- `deepscan.server`: set an url of DeepScan server. "https://deepscan.io" by default.
- `deepscan.ignoreRules`: set an array of rules to exclude.
  An example to exclude 'UNUSED_DECL' rule is:
```json
{
    "deepscan.ignoreRules": [
        "UNUSED_DECL"
    ]
}
```

## Commands

This extension contributes the following commands to the Command palette.

- `Inspect Code`: inspect the current JavaScript file.
